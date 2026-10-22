import { sql, type Selectable } from 'kysely';
import { db } from '../../database/connection.js';
import type { LogLevel, MetadataFilter } from '@logtide/shared';
import type {
  AlertRulesTable,
  AlertType,
  AlertRuleState,
  BaselineType,
  BaselineMetadata,
} from '../../database/types.js';
import { baselineCalculator } from './baseline-calculator.js';
import {
  compileAlertQuery,
  filterToReservoirParams,
  normalizeAlertQuery,
  type AlertLogFilter,
} from './alert-query.js';
import { AlertRuleInputError } from './validation.js';
import {
  decideRateOfChange,
  decideThreshold,
  type LifecycleDecision,
  type LifecycleSnapshot,
  type RateOfChangeSignal,
} from './lifecycle.js';
import { openAlertIncident, resolveAlertIncident } from './incident-sync.js';
import type { AlertEvaluationResult, AlertNotificationKind } from './types.js';
import { reservoir } from '../../database/reservoir.js';
import { hooks, HookRejectionError } from '../../hooks/index.js';

// Preview types
export type { LogLevel } from '@logtide/shared';
export type PreviewRange = '1d' | '7d' | '14d' | '30d';

export interface PreviewAlertRuleInput {
  organizationId: string;
  projectId?: string | null;
  service?: string | null;
  level: LogLevel[];
  threshold: number;
  timeWindow: number; // minutes
  previewRange: PreviewRange;
  /** Logs query (threshold rules); blank means none. */
  query?: string | null;
  metadataFilters?: MetadataFilter[];
}

export interface PreviewIncident {
  id: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  triggerCount: number;
  peakValue: number;
  averageValue: number;
  sampleLogs: Array<{
    time: Date;
    service: string;
    level: string;
    message: string;
    traceId?: string;
  }>;
}

export interface PreviewStatistics {
  incidents: {
    averageDuration: number;
    maxDuration: number;
    minDuration: number;
  };
  temporalPatterns: {
    byDayOfWeek: Array<{ day: string; count: number }>;
    byHourOfDay: Array<{ hour: number; count: number }>;
  };
  thresholdAnalysis: {
    percentAboveThreshold: number;
    p50Value: number;
    p95Value: number;
    p99Value: number;
  };
}

export interface PreviewSuggestion {
  type: 'threshold_too_low' | 'threshold_too_high' | 'time_based_pattern' | 'no_data';
  severity: 'info' | 'warning';
  message: string;
  detail?: string;
  recommendedValue?: number;
}

export interface PreviewAlertRuleOutput {
  summary: {
    totalTriggers: number;
    totalIncidents: number;
    affectedServices: string[];
    timeRange: {
      from: Date;
      to: Date;
    };
  };
  incidents: PreviewIncident[];
  statistics: PreviewStatistics;
  suggestions: PreviewSuggestion[];
}

export interface AlertRule {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  enabled: boolean;
  service: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold: number;
  timeWindow: number;
  alertType: AlertType;
  baselineType: BaselineType | null;
  deviationMultiplier: number | null;
  minBaselineValue: number | null;
  cooldownMinutes: number | null;
  sustainedMinutes: number | null;
  emailRecipients: string[];
  webhookUrl: string | null;
  metadataFilters: MetadataFilter[];
  // 1.6 lifecycle (migration 065)
  query: string | null;
  state: AlertRuleState;
  lastTriggeredAt: Date | null;
  lastEvaluatedAt: Date | null;
  lastNotifiedAt: Date | null;
  snoozedUntil: Date | null;
  renotifyMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAlertRuleInput {
  organizationId: string;
  projectId?: string | null;
  name: string;
  enabled?: boolean;
  service?: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold: number;
  timeWindow: number;
  alertType?: AlertType;
  baselineType?: BaselineType | null;
  deviationMultiplier?: number | null;
  minBaselineValue?: number | null;
  cooldownMinutes?: number | null;
  sustainedMinutes?: number | null;
  emailRecipients: string[];
  webhookUrl?: string | null;
  metadataFilters?: MetadataFilter[] | null;
  /** Grammar query (threshold rules only); blank is stored as null. */
  query?: string | null;
  /** Threshold rules only, 5 to 1440. */
  renotifyMinutes?: number | null;
}

export interface UpdateAlertRuleInput {
  name?: string;
  enabled?: boolean;
  service?: string | null;
  level?: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold?: number;
  timeWindow?: number;
  alertType?: AlertType;
  baselineType?: BaselineType | null;
  deviationMultiplier?: number | null;
  minBaselineValue?: number | null;
  cooldownMinutes?: number | null;
  sustainedMinutes?: number | null;
  emailRecipients?: string[];
  webhookUrl?: string | null;
  metadataFilters?: MetadataFilter[] | null;
  query?: string | null;
  renotifyMinutes?: number | null;
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

/** The lifecycle columns of a stored rule, as the state machine reads them. */
function lifecycleSnapshot(rule: Selectable<AlertRulesTable>): LifecycleSnapshot {
  return {
    state: rule.state ?? 'ok',
    lastTriggeredAt: toDateOrNull(rule.last_triggered_at),
    lastNotifiedAt: toDateOrNull(rule.last_notified_at),
    snoozedUntil: toDateOrNull(rule.snoozed_until),
    renotifyMinutes: rule.renotify_minutes != null ? Number(rule.renotify_minutes) : null,
  };
}

export class AlertsService {
  // In-memory state for sustained check tracking (resets on worker restart - acceptable)
  private sustainedState = new Map<string, { count: number; lastCheck: number }>();

  /**
   * Create a new alert rule
   */
  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule> {
    const alertRule = await db
      .insertInto('alert_rules')
      .values({
        organization_id: input.organizationId,
        project_id: input.projectId || null,
        name: input.name,
        enabled: input.enabled ?? true,
        service: input.service || null,
        level: input.level,
        threshold: input.threshold,
        time_window: input.timeWindow,
        alert_type: input.alertType || 'threshold',
        baseline_type: input.baselineType || null,
        deviation_multiplier: input.deviationMultiplier || null,
        min_baseline_value: input.minBaselineValue ?? null,
        cooldown_minutes: input.cooldownMinutes || null,
        sustained_minutes: input.sustainedMinutes || null,
        email_recipients: input.emailRecipients,
        webhook_url: input.webhookUrl || null,
        metadata_filters: sql`${JSON.stringify(input.metadataFilters ?? [])}::jsonb`,
        query: normalizeAlertQuery(input.query),
        renotify_minutes: input.renotifyMinutes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapAlertRule(alertRule);
  }

  /**
   * Count alert rules for an org (used for the alerts.max_rules capability check).
   * Counts ALL rules, including disabled ones: the cap is on configured rules.
   */
  async countAlertRules(organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('alert_rules')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Get all alert rules for an organization
   */
  async getAlertRules(
    organizationId: string,
    options?: { projectId?: string | null; enabledOnly?: boolean }
  ): Promise<AlertRule[]> {
    let query = db
      .selectFrom('alert_rules')
      .selectAll()
      .where('organization_id', '=', organizationId);

    if (options?.projectId !== undefined) {
      if (options.projectId === null) {
        // Get only org-level alerts (projectId is null)
        query = query.where('project_id', 'is', null);
      } else {
        // Get alerts for specific project OR org-level alerts
        query = query.where((eb) =>
          eb.or([
            eb('project_id', '=', options.projectId!),
            eb('project_id', 'is', null),
          ])
        );
      }
    }

    if (options?.enabledOnly) {
      query = query.where('enabled', '=', true);
    }

    const rules = await query.orderBy('created_at', 'desc').execute();

    return rules.map(this.mapAlertRule);
  }

  /**
   * Get alert rule by ID
   */
  async getAlertRule(id: string, organizationId: string): Promise<AlertRule | null> {
    const rule = await db
      .selectFrom('alert_rules')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return rule ? this.mapAlertRule(rule) : null;
  }

  /**
   * Update alert rule
   */
  async updateAlertRule(
    id: string,
    organizationId: string,
    input: UpdateAlertRuleInput
  ): Promise<AlertRule | null> {
    const updateData: any = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;
    if (input.service !== undefined) updateData.service = input.service;
    if (input.level !== undefined) updateData.level = input.level;
    if (input.threshold !== undefined) updateData.threshold = input.threshold;
    if (input.timeWindow !== undefined) updateData.time_window = input.timeWindow;
    if (input.alertType !== undefined) updateData.alert_type = input.alertType;
    if (input.baselineType !== undefined) updateData.baseline_type = input.baselineType;
    if (input.deviationMultiplier !== undefined) updateData.deviation_multiplier = input.deviationMultiplier;
    if (input.minBaselineValue !== undefined) updateData.min_baseline_value = input.minBaselineValue;
    if (input.cooldownMinutes !== undefined) updateData.cooldown_minutes = input.cooldownMinutes;
    if (input.sustainedMinutes !== undefined) updateData.sustained_minutes = input.sustainedMinutes;
    if (input.emailRecipients !== undefined) updateData.email_recipients = input.emailRecipients;
    if (input.webhookUrl !== undefined) updateData.webhook_url = input.webhookUrl;
    if (input.metadataFilters !== undefined) updateData.metadata_filters = sql`${JSON.stringify(input.metadataFilters ?? [])}::jsonb`;
    if (input.query !== undefined) updateData.query = normalizeAlertQuery(input.query);
    if (input.renotifyMinutes !== undefined) updateData.renotify_minutes = input.renotifyMinutes;

    if (input.enabled === false) {
      // A disabled rule is no longer evaluated: it leaves the firing state in
      // the same UPDATE (no alert.resolved is sent), and its incident is
      // resolved as manual first (row A1).
      const current = await this.getLifecycleState(id, organizationId);
      if (!current) return null;
      if (current.state === 'firing') {
        await resolveAlertIncident(current, 'manual', new Date());
      }
      updateData.state = 'ok';
    }

    const rule = await db
      .updateTable('alert_rules')
      .set(updateData)
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirst();

    return rule ? this.mapAlertRule(rule) : null;
  }

  /**
   * Delete alert rule. A firing rule's incident is resolved as manual BEFORE
   * the delete (row A2): incidents.alert_rule_id is ON DELETE SET NULL, so
   * afterwards the incident could no longer be found by its rule.
   */
  async deleteAlertRule(id: string, organizationId: string): Promise<boolean> {
    const current = await this.getLifecycleState(id, organizationId);
    if (!current) return false;
    if (current.state === 'firing') {
      await resolveAlertIncident(current, 'manual', new Date());
    }

    const result = await db
      .deleteFrom('alert_rules')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0) > 0;
  }

  /**
   * Set (or clear, with null) the snooze end of a rule. The lifecycle state
   * is not touched: the next evaluation applies T3/T6/T7/T10.
   */
  async snoozeAlertRule(id: string, organizationId: string, until: Date | null): Promise<AlertRule | null> {
    const rule = await db
      .updateTable('alert_rules')
      .set({ snoozed_until: until, updated_at: new Date() })
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirst();

    return rule ? this.mapAlertRule(rule) : null;
  }

  private async getLifecycleState(
    id: string,
    organizationId: string
  ): Promise<{ id: string; organization_id: string; state: AlertRuleState } | undefined> {
    return db
      .selectFrom('alert_rules')
      .select(['id', 'organization_id', 'state'])
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
  }

  /**
   * Evaluate every enabled rule once and apply the lifecycle state machine
   * (`lifecycle.ts`). Returns the notifications to enqueue: `triggered` and
   * `renotify` (one alert_history row each) and `resolved`. Steady firing,
   * snoozed transitions and lost compare-and-sets return nothing.
   *
   * `now` is the run's clock: every window, comparison and lifecycle write of
   * the run uses it (tests pass it explicitly).
   *
   * A rule whose evaluation fails (stored query no longer parses, engine
   * error) is skipped with its state and `last_evaluated_at` untouched and
   * never blocks the other rules of the run.
   *
   * PERFORMANCE: Pre-fetches all org->projects mappings in one query
   * instead of querying per rule (N+1 fix).
   */
  async checkAlertRules(options: { now?: Date } = {}): Promise<AlertEvaluationResult[]> {
    const now = options.now ?? new Date();
    const rules = await db
      .selectFrom('alert_rules')
      .selectAll()
      .where('enabled', '=', true)
      .execute();

    if (rules.length === 0) {
      return [];
    }

    // PERFORMANCE: Pre-fetch all org->projects mappings in one query
    // instead of querying per rule (N+1 fix)
    const orgIds = [...new Set(rules.filter(r => !r.project_id).map(r => r.organization_id))];
    const orgProjectsMap = new Map<string, string[]>();

    if (orgIds.length > 0) {
      const allProjects = await db
        .selectFrom('projects')
        .select(['id', 'organization_id'])
        .where('organization_id', 'in', orgIds)
        .execute();

      for (const orgId of orgIds) {
        orgProjectsMap.set(orgId, allProjects.filter(p => p.organization_id === orgId).map(p => p.id));
      }
    }

    const results: AlertEvaluationResult[] = [];
    const evaluated: Array<{ id: string; organization_id: string }> = [];

    for (const rule of rules) {
      // Lifecycle hook (#216): rejection (or a broken hook) skips THIS rule
      // and the batch continues - a hook must never kill the whole cron run.
      if (hooks.hasHandlers('beforeAlertEvaluation')) {
        try {
          await hooks.run('beforeAlertEvaluation', {
            organizationId: rule.organization_id,
            ruleId: rule.id,
            ruleType: rule.alert_type === 'rate_of_change' ? 'rate_of_change' : 'threshold',
          });
        } catch (err) {
          if (err instanceof HookRejectionError) {
            console.log(`[Alerts] Rule ${rule.id} skipped by hook: ${err.code}`);
          } else {
            console.error(`[Alerts] Rule ${rule.id} skipped, hook failed:`, err);
          }
          continue;
        }
      }

      try {
        const result = await this.checkRule(rule, orgProjectsMap, now);
        evaluated.push(rule);
        if (result) results.push(result);
      } catch (err) {
        console.error(`[Alerts] Rule ${rule.id} skipped, evaluation failed:`, err);
      }
    }

    await this.markEvaluated(evaluated, now);

    return results;
  }

  /**
   * `last_evaluated_at = now` for the rules evaluated in this run, in
   * batches. A failure is logged and never drops the run's notifications
   * (their transitions are already committed).
   */
  private async markEvaluated(rules: Array<{ id: string; organization_id: string }>, now: Date): Promise<void> {
    const BATCH = 1000;
    for (let i = 0; i < rules.length; i += BATCH) {
      const batch = rules.slice(i, i + BATCH);
      try {
        await db
          .updateTable('alert_rules')
          .set({ last_evaluated_at: now })
          .where('organization_id', 'in', [...new Set(batch.map((r) => r.organization_id))])
          .where('id', 'in', batch.map((r) => r.id))
          .execute();
      } catch (err) {
        console.error('[Alerts] Failed to record last_evaluated_at:', err);
      }
    }
  }

  /**
   * Evaluate a single rule and apply its lifecycle decision.
   *
   * PERFORMANCE: Uses pre-fetched orgProjectsMap instead of querying per rule
   */
  private async checkRule(
    rule: Selectable<AlertRulesTable>,
    orgProjectsMap: Map<string, string[]>,
    now: Date
  ): Promise<AlertEvaluationResult | null> {
    // Dispatch to rate-of-change logic if applicable
    if (rule.alert_type === 'rate_of_change') {
      return this.checkRateOfChangeRule(rule, orgProjectsMap, now);
    }

    const compiled = compileAlertQuery({
      query: rule.query,
      level: rule.level,
      service: rule.service,
      metadataFilters: (rule.metadata_filters ?? []) as MetadataFilter[],
    });
    if (!compiled.ok) {
      // A stored query that a newer grammar rejects: skip the rule (state kept).
      throw new Error(
        `Stored query no longer parses at position ${compiled.error.position}: ${compiled.error.message}`
      );
    }

    // Sliding window [now - time_window, now]: the lifecycle state, not a
    // "logs since the last trigger" exclusion, prevents duplicate notifications.
    // An org-wide rule of an organization without projects counts 0 (so a
    // firing rule resolves).
    const projectIds = rule.project_id ? [rule.project_id] : (orgProjectsMap.get(rule.organization_id) ?? []);
    let count = 0;
    if (projectIds.length > 0) {
      const countResult = await reservoir.count({
        projectId: rule.project_id ? rule.project_id : projectIds,
        from: new Date(now.getTime() - rule.time_window * 60_000),
        to: now,
        ...filterToReservoirParams(compiled.filter),
      });
      count = countResult.count;
    }

    const decision = decideThreshold(lifecycleSnapshot(rule), count >= rule.threshold, now);
    return this.applyDecision(rule, decision, { now, logCount: count, baselineMetadata: null });
  }

  /**
   * Apply a lifecycle decision with a compare-and-set: the UPDATE only
   * matches when the rule is still enabled and its lifecycle columns are the
   * ones this evaluation read, so of two concurrent evaluators exactly one
   * wins a transition or a notification. The alert_history row (one per
   * notification) is written in the same transaction. Only the winner fires
   * the hook, syncs the incident and returns a result.
   */
  private async applyDecision(
    rule: Selectable<AlertRulesTable>,
    decision: LifecycleDecision,
    ctx: { now: Date; logCount: number; baselineMetadata: BaselineMetadata | null }
  ): Promise<AlertEvaluationResult | null> {
    if (decision.type === 'none') return null;
    const { now } = ctx;

    const set: { last_evaluated_at: Date; state?: AlertRuleState; last_triggered_at?: Date; last_notified_at?: Date } = {
      last_evaluated_at: now,
    };
    if (decision.type === 'fire') {
      set.state = 'firing';
      set.last_triggered_at = now;
      if (decision.notification) set.last_notified_at = now;
    } else if (decision.type === 'notify') {
      set.last_notified_at = now;
    } else {
      set.state = 'ok'; // last_triggered_at is kept (start of the last episode)
    }

    const historyKind: AlertNotificationKind | null =
      decision.notification === 'triggered' || decision.notification === 'renotify' ? decision.notification : null;

    const won = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('alert_rules')
        .set(set)
        .where('id', '=', rule.id)
        .where('organization_id', '=', rule.organization_id)
        .where('enabled', '=', true)
        .where('state', '=', rule.state)
        .where(sql`date_trunc('milliseconds', last_triggered_at)`, 'is not distinct from', rule.last_triggered_at)
        .where(sql`date_trunc('milliseconds', last_notified_at)`, 'is not distinct from', rule.last_notified_at)
        .where(sql`date_trunc('milliseconds', snoozed_until)`, 'is not distinct from', rule.snoozed_until)
        .returning('id')
        .executeTakeFirst();
      if (!updated) return null;
      if (!historyKind) return { historyId: null as string | null };

      const history = await trx
        .insertInto('alert_history')
        .values({
          rule_id: rule.id,
          triggered_at: now,
          log_count: ctx.logCount,
          baseline_metadata: ctx.baselineMetadata,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return { historyId: history.id as string | null };
    });
    if (!won) return null;

    const historyId = won.historyId;
    if (historyId && hooks.hasHandlers('afterAlertTriggered')) {
      void hooks.runAfter('afterAlertTriggered', {
        organizationId: rule.organization_id,
        projectId: rule.project_id ?? null,
        ruleId: rule.id,
        ruleName: rule.name,
        historyId,
        logCount: ctx.logCount,
        baselineMetadata: ctx.baselineMetadata as unknown as Record<string, unknown> | null,
      });
    }

    // Start of the firing episode: this run for a transition, else the stored one.
    const firingSince = (decision.type === 'fire' ? now : (toDateOrNull(rule.last_triggered_at) ?? now)).toISOString();

    if (decision.type === 'resolve') {
      const incidentId = await resolveAlertIncident(rule, 'recovered', now);
      if (decision.notification !== 'resolved') return null;
      return {
        kind: 'resolved',
        rule_id: rule.id,
        rule_name: rule.name,
        organization_id: rule.organization_id,
        project_id: rule.project_id ?? null,
        alert_type: rule.alert_type,
        log_count: ctx.logCount,
        threshold: rule.threshold,
        time_window: rule.time_window,
        firing_since: firingSince,
        resolved_at: now.toISOString(),
        incident_id: incidentId,
      };
    }

    const incidentId = await openAlertIncident(rule, {
      now,
      logCount: ctx.logCount,
      historyId,
      notification: historyKind,
      baselineMetadata: ctx.baselineMetadata,
    });
    if (!historyKind || !historyId) return null;

    return {
      historyId,
      rule_id: rule.id,
      rule_name: rule.name,
      organization_id: rule.organization_id,
      project_id: rule.project_id ?? null,
      log_count: ctx.logCount,
      threshold: rule.threshold,
      time_window: rule.time_window,
      email_recipients: rule.email_recipients,
      webhook_url: rule.webhook_url,
      ...(ctx.baselineMetadata ? { baseline_metadata: ctx.baselineMetadata } : {}),
      kind: historyKind,
      firing_since: firingSince,
      incident_id: incidentId,
    };
  }

  /**
   * Evaluate a rate-of-change rule: compute its signal, decide with the
   * state machine (rows R1-R8) and apply the decision. Notifications keep
   * the cooldown semantics: a still-anomalous firing rule notifies again
   * only after the cooldown.
   */
  private async checkRateOfChangeRule(
    rule: Selectable<AlertRulesTable>,
    orgProjectsMap: Map<string, string[]>,
    now: Date
  ): Promise<AlertEvaluationResult | null> {
    const projectIds = rule.project_id ? [rule.project_id] : (orgProjectsMap.get(rule.organization_id) ?? []);
    const { signal, currentValue, baselineMetadata } = await this.rateOfChangeSignal(rule, projectIds, now);
    const decision = decideRateOfChange(lifecycleSnapshot(rule), signal, now);
    return this.applyDecision(rule, decision, {
      now,
      logCount: currentValue,
      baselineMetadata: signal === 'anomaly' ? baselineMetadata : null,
    });
  }

  /**
   * Rate-of-change signal for one rule at `now`:
   * - in cooldown while ok: `skipped`, without baseline queries;
   * - in cooldown while firing: baseline and current rate only, to tell
   *   `recovered` from `pending` (sustained counters untouched);
   * - outside the cooldown: the baseline, deviation and sustained pipeline,
   *   `anomaly`, `pending` or `recovered`.
   * No projects, no baseline, a baseline below `min_baseline_value` or an
   * incomplete rule configuration all count as `recovered`.
   */
  private async rateOfChangeSignal(
    rule: Selectable<AlertRulesTable>,
    projectIds: string[],
    now: Date
  ): Promise<{ signal: RateOfChangeSignal; currentValue: number; baselineMetadata: BaselineMetadata | null }> {
    const recovered = (currentValue = 0, baselineMetadata: BaselineMetadata | null = null) => ({
      signal: 'recovered' as const,
      currentValue,
      baselineMetadata,
    });
    if (!rule.baseline_type || !rule.deviation_multiplier) return recovered();

    const deviationMultiplier = Number(rule.deviation_multiplier);
    const minBaseline = rule.min_baseline_value != null ? Number(rule.min_baseline_value) : 10;
    const cooldownMin = Number(rule.cooldown_minutes || 60);
    const sustainedMin = Number(rule.sustained_minutes || 5);
    const ruleMetadataFilters = (rule.metadata_filters ?? []) as MetadataFilter[];
    const metadataFilters = ruleMetadataFilters.length > 0 ? ruleMetadataFilters : undefined;

    // Cooldown: the last notification (alert_history row) of this rule.
    const lastTrigger = await db
      .selectFrom('alert_history')
      .select(['triggered_at'])
      .where('rule_id', '=', rule.id)
      .orderBy('triggered_at', 'desc')
      .executeTakeFirst();
    const inCooldown = lastTrigger
      ? now.getTime() < new Date(lastTrigger.triggered_at).getTime() + cooldownMin * 60 * 1000
      : false;

    if (inCooldown && rule.state !== 'firing') {
      return { signal: 'skipped', currentValue: 0, baselineMetadata: null };
    }

    // Calculate baseline. Pass the rule's metadata filters so the baseline is
    // computed over the same filtered population as the current rate; otherwise
    // the deviation ratio is deflated when filters are present.
    const baseline = await baselineCalculator.calculate(
      rule.baseline_type,
      projectIds,
      rule.level,
      rule.service || null,
      metadataFilters,
    );

    if (!baseline || baseline.value < minBaseline) {
      // Reset sustained state - baseline too low or no data
      if (!inCooldown) this.sustainedState.delete(rule.id);
      return recovered();
    }

    // Get current hourly rate
    const currentValue = await baselineCalculator.getCurrentHourlyRate(
      projectIds,
      rule.level,
      rule.service || null,
      metadataFilters,
    );

    const deviationRatio = baseline.value > 0 ? currentValue / baseline.value : 0;
    const baselineMetadata: BaselineMetadata = {
      baseline_value: baseline.value,
      current_value: currentValue,
      deviation_ratio: Math.round(deviationRatio * 100) / 100,
      baseline_type: rule.baseline_type,
      evaluation_time: now.toISOString(),
    };

    // Check if deviation exceeds multiplier
    if (deviationRatio < deviationMultiplier) {
      // Reset sustained state - not exceeding threshold
      if (!inCooldown) this.sustainedState.delete(rule.id);
      return recovered(currentValue, baselineMetadata);
    }

    // Still deviating inside the cooldown: no new notification yet.
    if (inCooldown) return { signal: 'pending', currentValue, baselineMetadata };

    // Sustained check: anomaly must persist for sustained_minutes
    // We track consecutive checks (each ~60s apart)
    const requiredChecks = Math.max(1, Math.ceil(sustainedMin / 1)); // 1 check per minute
    const state = this.sustainedState.get(rule.id);
    const nowMs = now.getTime();

    if (state && (nowMs - state.lastCheck) < 3 * 60 * 1000) {
      // Within 3 minutes of last check - increment counter
      const newCount = state.count + 1;
      this.sustainedState.set(rule.id, { count: newCount, lastCheck: nowMs });

      if (newCount < requiredChecks) {
        return { signal: 'pending', currentValue, baselineMetadata }; // Not yet sustained enough
      }
    } else {
      // First check or gap too large - start counting
      this.sustainedState.set(rule.id, { count: 1, lastCheck: nowMs });
      if (requiredChecks > 1) {
        return { signal: 'pending', currentValue, baselineMetadata }; // Need more checks
      }
    }

    // Reset sustained state after an anomaly
    this.sustainedState.delete(rule.id);

    return { signal: 'anomaly', currentValue, baselineMetadata };
  }

  /**
   * Notifications (alert_history rows) per rule since `since`, for the rules
   * of one organization. Rules without any row are absent from the map.
   */
  async countTriggersSince(organizationId: string, since: Date): Promise<Map<string, number>> {
    const rows = await db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .select(['alert_history.rule_id', (eb) => eb.fn.count('alert_history.id').as('count')])
      .where('alert_rules.organization_id', '=', organizationId)
      .where('alert_history.triggered_at', '>=', since)
      .groupBy('alert_history.rule_id')
      .execute();

    return new Map(rows.map((row) => [row.rule_id, Number(row.count)]));
  }

  /**
   * Get alert history for an organization
   */
  async getAlertHistory(
    organizationId: string,
    options?: { projectId?: string; limit?: number; offset?: number }
  ) {
    let query = db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .leftJoin('projects', 'projects.id', 'alert_rules.project_id')
      .select([
        'alert_history.id',
        'alert_history.rule_id',
        'alert_rules.name as rule_name',
        'alert_rules.project_id',
        'projects.name as project_name',
        'alert_history.triggered_at',
        'alert_history.log_count',
        'alert_history.baseline_metadata',
        'alert_history.notified',
        'alert_history.error',
        // Alert rule details
        'alert_rules.threshold',
        'alert_rules.time_window',
        'alert_rules.service',
        'alert_rules.level',
        'alert_rules.alert_type',
        'alert_rules.query',
        'alert_rules.metadata_filters',
      ])
      .where('alert_rules.organization_id', '=', organizationId);

    if (options?.projectId) {
      query = query.where((eb) =>
        eb.or([
          eb('alert_rules.project_id', '=', options.projectId!),
          eb('alert_rules.project_id', 'is', null),
        ])
      );
    }

    const results = await query
      .orderBy('alert_history.triggered_at', 'desc')
      .limit(options?.limit ?? 100)
      .offset(options?.offset ?? 0)
      .execute();

    let totalQuery = db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .select((eb) => eb.fn.count('alert_history.id').as('count'))
      .where('alert_rules.organization_id', '=', organizationId);

    if (options?.projectId) {
      totalQuery = totalQuery.where((eb) =>
        eb.or([
          eb('alert_rules.project_id', '=', options.projectId!),
          eb('alert_rules.project_id', 'is', null),
        ])
      );
    }

    const total = await totalQuery.executeTakeFirst();

    return {
      history: results.map((row) => ({
        id: row.id,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        projectId: row.project_id,
        projectName: row.project_name,
        triggeredAt: row.triggered_at,
        logCount: row.log_count,
        baselineMetadata: (row as any).baseline_metadata || null,
        notified: row.notified,
        error: row.error,
        threshold: row.threshold,
        timeWindow: row.time_window,
        service: row.service,
        level: row.level,
        alertType: (row as any).alert_type || 'threshold',
        query: row.query ?? null,
        metadataFilters: (row.metadata_filters ?? []) as MetadataFilter[],
      })),
      total: Number(total?.count || 0),
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    };
  }

  /**
   * Mark alert as notified
   */
  async markAsNotified(historyId: string, error?: string) {
    await db
      .updateTable('alert_history')
      .set({
        notified: error ? false : true,
        error: error || null,
      })
      .where('id', '=', historyId)
      .execute();
  }

  /**
   * Preview how an alert rule would have performed over historical data
   */
  async previewAlertRule(input: PreviewAlertRuleInput): Promise<PreviewAlertRuleOutput> {
    // 0. A query or metadata filters switch to the filtered path, which
    // compiles exactly what the saved rule would evaluate. An invalid query
    // throws AlertRuleInputError (400 { error, position }) before any read.
    const filter = this.previewFilter(input);

    // 1. Parse time range
    const rangeMs: Record<PreviewRange, number> = {
      '1d': 86400000,
      '7d': 604800000,
      '14d': 1209600000,
      '30d': 2592000000,
    };
    const to = new Date();
    const from = new Date(to.getTime() - rangeMs[input.previewRange]);

    // 2. Determine bucket interval based on time range (optimize for data volume)
    const bucketInterval =
      input.previewRange === '1d'
        ? '5 minutes'
        : input.previewRange === '7d'
          ? '15 minutes'
          : '1 hour';

    // 3. Get project IDs (single project or all org projects)
    const projectIds = await this.getProjectIds(input.organizationId, input.projectId);
    if (projectIds.length === 0) {
      return this.emptyPreviewResult(from, to);
    }

    // 4. Execute time-bucketed query
    const buckets = filter
      ? await this.getFilteredTimeBuckets(from, to, bucketInterval, projectIds, filter)
      : await this.getTimeBuckets(from, to, bucketInterval, projectIds, input.level, input.service);

    if (buckets.length === 0) {
      return this.emptyPreviewResult(from, to, [
        {
          type: 'no_data',
          severity: 'info',
          message: 'No logs found in the selected time range',
          detail: 'Try adjusting your filters or selecting a longer time range.',
        },
      ]);
    }

    // 5. Cluster consecutive triggers into incidents
    const bucketMs = this.getBucketMs(bucketInterval);
    const incidents = this.clusterIncidents(buckets, input.threshold, bucketMs);

    // 6. Fetch sample logs for top incidents (limit to avoid heavy queries)
    const topIncidents = incidents.slice(0, 10);
    for (const incident of topIncidents) {
      incident.sampleLogs = await this.fetchSampleLogs(
        incident.startTime,
        incident.endTime,
        projectIds,
        input.level,
        input.service,
        filter
      );
    }

    // 7. Get affected services
    const affectedServices = filter
      ? await this.getFilteredAffectedServices(from, to, projectIds, filter)
      : await this.getAffectedServices(from, to, projectIds, input.level, input.service);

    // 8. Compute statistics
    const statistics = this.computeStatistics(buckets, incidents, input.threshold);

    // 9. Generate suggestions
    const suggestions = this.generateSuggestions(
      statistics,
      incidents,
      input.threshold,
      input.previewRange
    );

    return {
      summary: {
        totalTriggers: incidents.reduce((sum, i) => sum + i.triggerCount, 0),
        totalIncidents: incidents.length,
        affectedServices,
        timeRange: { from, to },
      },
      incidents: topIncidents,
      statistics,
      suggestions,
    };
  }

  /**
   * The compiled filter of a preview with a query or metadata filters, or
   * null when it has neither (the pre-1.6 aggregate path then runs
   * unchanged). Same compiler as the evaluation, so the preview matches
   * exactly what the saved rule counts.
   */
  private previewFilter(input: PreviewAlertRuleInput): AlertLogFilter | null {
    const query = normalizeAlertQuery(input.query);
    const metadataFilters = input.metadataFilters ?? [];
    if (query === null && metadataFilters.length === 0) return null;

    const compiled = compileAlertQuery({
      query,
      level: input.level,
      service: input.service ?? null,
      metadataFilters,
    });
    if (!compiled.ok) {
      throw new AlertRuleInputError(compiled.error.message, compiled.error.position);
    }
    return filterToReservoirParams(compiled.filter);
  }

  /**
   * Time-bucketed counts of the logs matching a compiled filter (query,
   * levels, service, metadata), through the reservoir histogram on every
   * engine. Empty buckets are dropped so the statistics match the
   * aggregate path.
   */
  private async getFilteredTimeBuckets(
    from: Date,
    to: Date,
    bucketInterval: string,
    projectIds: string[],
    filter: AlertLogFilter
  ): Promise<Array<{ bucket: Date; count: number }>> {
    const bucketSeconds = this.getBucketMs(bucketInterval) / 1000;
    const result = await reservoir.histogram({
      projectId: projectIds,
      from,
      to,
      ...filter,
      bucketSeconds,
    });

    return result.buckets
      .filter((b) => b.total > 0)
      .map((b) => ({ bucket: b.time, count: b.total }))
      .sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
  }

  /**
   * Services of the logs matching a compiled filter (top 50), without the
   * `unknown` placeholder.
   */
  private async getFilteredAffectedServices(
    from: Date,
    to: Date,
    projectIds: string[],
    filter: AlertLogFilter
  ): Promise<string[]> {
    const result = await reservoir.facets({
      projectId: projectIds,
      from,
      to,
      ...filter,
      fields: [{ builtin: 'service' }],
      limit: 50,
    });

    const services = result.facets[0]?.values ?? [];
    return services.map((v) => v.value).filter((s) => s !== 'unknown');
  }

  /**
   * Get project IDs for the preview query
   */
  private async getProjectIds(
    organizationId: string,
    projectId?: string | null
  ): Promise<string[]> {
    if (projectId) {
      return [projectId];
    }

    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    return projects.map((p) => p.id);
  }

  /**
   * Get time-bucketed log counts
   */
  private async getTimeBuckets(
    from: Date,
    to: Date,
    bucketInterval: string,
    projectIds: string[],
    levels: LogLevel[],
    service?: string | null
  ): Promise<Array<{ bucket: Date; count: number }>> {
    // Map bucket interval string to reservoir AggregationInterval
    const intervalMap: Record<string, '5m' | '15m' | '1h'> = {
      '5 minutes': '5m',
      '15 minutes': '15m',
      '1 hour': '1h',
    };
    const interval = intervalMap[bucketInterval] ?? '1h';
    const serviceFilter = service ? [service, 'unknown'] : undefined;

    const aggResult = await reservoir.aggregate({
      projectId: projectIds,
      from,
      to,
      interval,
      service: serviceFilter,
    });

    // Filter by level client-side (aggregate returns all levels)
    // and flatten to simple bucket+count
    const levelSet = new Set(levels);
    const bucketMap = new Map<string, number>();

    for (const bucket of aggResult.timeseries) {
      let count = 0;
      if (bucket.byLevel) {
        for (const [lvl, n] of Object.entries(bucket.byLevel) as [string, number][]) {
          if (levelSet.has(lvl as LogLevel)) count += n;
        }
      }
      if (count > 0) {
        const key = bucket.bucket.toISOString();
        bucketMap.set(key, (bucketMap.get(key) ?? 0) + count);
      }
    }

    return Array.from(bucketMap.entries())
      .map(([key, count]) => ({ bucket: new Date(key), count }))
      .sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
  }

  /**
   * Get bucket size in milliseconds
   */
  private getBucketMs(bucketInterval: string): number {
    if (bucketInterval === '5 minutes') return 5 * 60 * 1000;
    if (bucketInterval === '15 minutes') return 15 * 60 * 1000;
    return 60 * 60 * 1000; // 1 hour
  }

  /**
   * Cluster consecutive buckets that exceed threshold into incidents
   */
  private clusterIncidents(
    buckets: Array<{ bucket: Date; count: number }>,
    threshold: number,
    bucketMs: number
  ): PreviewIncident[] {
    const incidents: PreviewIncident[] = [];
    let currentIncident: PreviewIncident | null = null;

    for (const bucket of buckets) {
      if (bucket.count >= threshold) {
        if (!currentIncident) {
          // Start new incident
          currentIncident = {
            id: crypto.randomUUID(),
            startTime: bucket.bucket,
            endTime: new Date(bucket.bucket.getTime() + bucketMs),
            durationMinutes: bucketMs / 60000,
            triggerCount: 1,
            peakValue: bucket.count,
            averageValue: bucket.count,
            sampleLogs: [],
          };
        } else {
          // Extend current incident
          currentIncident.endTime = new Date(bucket.bucket.getTime() + bucketMs);
          currentIncident.durationMinutes =
            (currentIncident.endTime.getTime() - currentIncident.startTime.getTime()) / 60000;
          currentIncident.triggerCount += 1;
          currentIncident.peakValue = Math.max(currentIncident.peakValue, bucket.count);
          // Running average
          currentIncident.averageValue = Math.round(
            (currentIncident.averageValue * (currentIncident.triggerCount - 1) + bucket.count) /
              currentIncident.triggerCount
          );
        }
      } else if (currentIncident) {
        // End current incident
        incidents.push(currentIncident);
        currentIncident = null;
      }
    }

    // Don't forget the last incident
    if (currentIncident) {
      incidents.push(currentIncident);
    }

    return incidents;
  }

  /**
   * Fetch sample logs for an incident
   */
  private async fetchSampleLogs(
    from: Date,
    to: Date,
    projectIds: string[],
    levels: LogLevel[],
    service?: string | null,
    filter?: AlertLogFilter | null
  ): Promise<PreviewIncident['sampleLogs']> {
    const serviceFilter = service ? [service, 'unknown'] : undefined;

    // With a compiled filter (query / metadata filters) the samples match
    // exactly the logs counted in the buckets.
    const criteria = filter ?? { level: levels, service: serviceFilter };
    const result = await reservoir.query({
      projectId: projectIds,
      from,
      to,
      ...criteria,
      limit: 5,
      sortOrder: 'desc',
    });

    return result.logs.map((log: { time: Date; service: string; level: string; message: string; traceId?: string }) => ({
      time: log.time,
      service: log.service,
      level: log.level,
      message: log.message,
      traceId: log.traceId || undefined,
    }));
  }

  /**
   * Get unique services affected in the time range
   */
  private async getAffectedServices(
    from: Date,
    to: Date,
    projectIds: string[],
    levels: LogLevel[],
    serviceFilter?: string | null
  ): Promise<string[]> {
    const svcFilter = serviceFilter ? [serviceFilter, 'unknown'] : undefined;

    const result = await reservoir.distinct({
      field: 'service',
      projectId: projectIds,
      from,
      to,
      level: levels,
      service: svcFilter,
    });

    return result.values.filter((s: string) => s !== 'unknown');
  }

  /**
   * Compute statistics from buckets and incidents
   */
  private computeStatistics(
    buckets: Array<{ bucket: Date; count: number }>,
    incidents: PreviewIncident[],
    threshold: number
  ): PreviewStatistics {
    // Duration stats
    const durations = incidents.map((i) => i.durationMinutes);
    const avgDuration =
      durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    // Temporal patterns
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDayOfWeek = dayNames.map((day) => ({ day, count: 0 }));
    const byHourOfDay = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));

    for (const incident of incidents) {
      const day = incident.startTime.getUTCDay();
      const hour = incident.startTime.getUTCHours();
      byDayOfWeek[day].count += 1;
      byHourOfDay[hour].count += 1;
    }

    // Threshold analysis (percentiles)
    const counts = buckets.map((b) => b.count).sort((a, b) => a - b);
    const getPercentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const index = Math.min(Math.floor(arr.length * p), arr.length - 1);
      return arr[index];
    };

    const percentAbove =
      buckets.length > 0
        ? Math.round((buckets.filter((b) => b.count >= threshold).length / buckets.length) * 100)
        : 0;

    return {
      incidents: {
        averageDuration: avgDuration,
        maxDuration: Math.max(...durations, 0),
        minDuration: durations.length > 0 ? Math.min(...durations) : 0,
      },
      temporalPatterns: { byDayOfWeek, byHourOfDay },
      thresholdAnalysis: {
        percentAboveThreshold: percentAbove,
        p50Value: getPercentile(counts, 0.5),
        p95Value: getPercentile(counts, 0.95),
        p99Value: getPercentile(counts, 0.99),
      },
    };
  }

  /**
   * Generate suggestions based on preview analysis
   */
  private generateSuggestions(
    stats: PreviewStatistics,
    incidents: PreviewIncident[],
    threshold: number,
    range: PreviewRange
  ): PreviewSuggestion[] {
    const suggestions: PreviewSuggestion[] = [];
    const rangeDays = { '1d': 1, '7d': 7, '14d': 14, '30d': 30 }[range];

    // Too many triggers (alert fatigue)
    if (stats.thresholdAnalysis.percentAboveThreshold > 15) {
      suggestions.push({
        type: 'threshold_too_low',
        severity: 'warning',
        message: `Alert would trigger ${stats.thresholdAnalysis.percentAboveThreshold}% of time buckets`,
        detail: 'This may cause alert fatigue. Consider raising the threshold.',
        recommendedValue: stats.thresholdAnalysis.p95Value,
      });
    } else if (incidents.length > rangeDays * 5) {
      // More than 5 incidents per day average
      suggestions.push({
        type: 'threshold_too_low',
        severity: 'warning',
        message: `${incidents.length} incidents in ${rangeDays} days may be too noisy`,
        detail: 'Consider increasing the threshold to reduce noise.',
        recommendedValue: Math.ceil(threshold * 1.5),
      });
    }

    // No triggers at all
    if (incidents.length === 0 && stats.thresholdAnalysis.p99Value > 0) {
      suggestions.push({
        type: 'threshold_too_high',
        severity: 'info',
        message: `No triggers found in the last ${rangeDays} days`,
        detail: 'The threshold may be too high to catch real issues.',
        recommendedValue:
          stats.thresholdAnalysis.p95Value > 0 ? stats.thresholdAnalysis.p95Value : undefined,
      });
    }

    // Time-based pattern detection
    const maxDayCount = Math.max(...stats.temporalPatterns.byDayOfWeek.map((d) => d.count));
    const maxDay = stats.temporalPatterns.byDayOfWeek.find((d) => d.count === maxDayCount);
    if (maxDay && incidents.length > 3 && maxDayCount > incidents.length * 0.4) {
      suggestions.push({
        type: 'time_based_pattern',
        severity: 'info',
        message: `${Math.round((maxDayCount / incidents.length) * 100)}% of incidents occur on ${maxDay.day}`,
        detail: 'This might indicate scheduled jobs or recurring patterns.',
      });
    }

    // Hour-based pattern
    const maxHourCount = Math.max(...stats.temporalPatterns.byHourOfDay.map((h) => h.count));
    const maxHour = stats.temporalPatterns.byHourOfDay.find((h) => h.count === maxHourCount);
    if (maxHour && incidents.length > 3 && maxHourCount > incidents.length * 0.3) {
      suggestions.push({
        type: 'time_based_pattern',
        severity: 'info',
        message: `Peak activity at ${maxHour.hour}:00 UTC`,
        detail: 'Consider if this aligns with expected patterns (deployments, traffic peaks).',
      });
    }

    return suggestions;
  }

  /**
   * Return empty preview result
   */
  private emptyPreviewResult(
    from: Date,
    to: Date,
    suggestions: PreviewSuggestion[] = []
  ): PreviewAlertRuleOutput {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      summary: {
        totalTriggers: 0,
        totalIncidents: 0,
        affectedServices: [],
        timeRange: { from, to },
      },
      incidents: [],
      statistics: {
        incidents: { averageDuration: 0, maxDuration: 0, minDuration: 0 },
        temporalPatterns: {
          byDayOfWeek: dayNames.map((day) => ({ day, count: 0 })),
          byHourOfDay: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
        },
        thresholdAnalysis: {
          percentAboveThreshold: 0,
          p50Value: 0,
          p95Value: 0,
          p99Value: 0,
        },
      },
      suggestions,
    };
  }

  private mapAlertRule(row: any): AlertRule {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      name: row.name,
      enabled: row.enabled,
      service: row.service,
      level: row.level,
      threshold: row.threshold,
      timeWindow: row.time_window,
      alertType: row.alert_type || 'threshold',
      baselineType: row.baseline_type || null,
      deviationMultiplier: row.deviation_multiplier != null ? Number(row.deviation_multiplier) : null,
      minBaselineValue: row.min_baseline_value != null ? Number(row.min_baseline_value) : null,
      cooldownMinutes: row.cooldown_minutes != null ? Number(row.cooldown_minutes) : null,
      sustainedMinutes: row.sustained_minutes != null ? Number(row.sustained_minutes) : null,
      emailRecipients: row.email_recipients,
      webhookUrl: row.webhook_url,
      metadataFilters: row.metadata_filters ?? [],
      query: row.query ?? null,
      state: row.state ?? 'ok',
      lastTriggeredAt: toDateOrNull(row.last_triggered_at),
      lastEvaluatedAt: toDateOrNull(row.last_evaluated_at),
      lastNotifiedAt: toDateOrNull(row.last_notified_at),
      snoozedUntil: toDateOrNull(row.snoozed_until),
      renotifyMinutes: row.renotify_minutes != null ? Number(row.renotify_minutes) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const alertsService = new AlertsService();
