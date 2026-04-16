import { db } from '../../database/connection.js';
import type { LogLevel } from '@logtide/shared';
import type { AlertType, BaselineType, BaselineMetadata } from '../../database/types.js';
import { baselineCalculator } from './baseline-calculator.js';
import { reservoir } from '../../database/reservoir.js';

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
        min_baseline_value: input.minBaselineValue || null,
        cooldown_minutes: input.cooldownMinutes || null,
        sustained_minutes: input.sustainedMinutes || null,
        email_recipients: input.emailRecipients,
        webhook_url: input.webhookUrl || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapAlertRule(alertRule);
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
   * Delete alert rule
   */
  async deleteAlertRule(id: string, organizationId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('alert_rules')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0) > 0;
  }

  /**
   * Check alert rules and trigger if threshold is met
   *
   * PERFORMANCE: Pre-fetches all org->projects mappings in one query
   * instead of querying per rule (N+1 fix).
   */
  async checkAlertRules() {
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

    const triggeredAlerts = [];

    for (const rule of rules) {
      const triggered = await this.checkRule(rule, orgProjectsMap);
      if (triggered) {
        triggeredAlerts.push(triggered);
      }
    }

    return triggeredAlerts;
  }

  /**
   * Check a single rule
   *
   * PERFORMANCE: Uses pre-fetched orgProjectsMap instead of querying per rule
   */
  private async checkRule(rule: any, orgProjectsMap: Map<string, string[]>) {
    // Dispatch to rate-of-change logic if applicable
    if (rule.alert_type === 'rate_of_change') {
      return this.checkRateOfChangeRule(rule, orgProjectsMap);
    }

    // Get the last trigger time for this rule
    const lastTrigger = await db
      .selectFrom('alert_history')
      .select(['triggered_at'])
      .where('rule_id', '=', rule.id)
      .orderBy('triggered_at', 'desc')
      .executeTakeFirst();

    // Determine the time window for counting logs
    const timeWindow = new Date(Date.now() - rule.time_window * 60 * 1000);

    // If there's a last trigger, only count logs AFTER it
    // This prevents re-triggering on the same logs
    const fromTime = lastTrigger
      ? new Date(Math.max(new Date(lastTrigger.triggered_at).getTime(), timeWindow.getTime()))
      : timeWindow;

    // Determine project scope
    let projectId: string | string[];
    if (rule.project_id) {
      projectId = rule.project_id;
    } else {
      const projectIds = orgProjectsMap.get(rule.organization_id) || [];
      if (projectIds.length === 0) return null;
      projectId = projectIds;
    }

    // Count NEW logs (after last trigger or within time window)
    // Use fromTime + 1ms to simulate exclusive bound (time > fromTime)
    const serviceFilter = rule.service ? [rule.service, 'unknown'] : undefined;
    const exclusiveFrom = new Date(fromTime.getTime() + 1);

    const countResult = await reservoir.count({
      projectId,
      from: exclusiveFrom,
      to: new Date(),
      level: rule.level,
      service: serviceFilter,
    });
    const count = countResult.count;

    if (count >= rule.threshold) {
      // Record alert trigger
      const historyRecord = await db
        .insertInto('alert_history')
        .values({
          rule_id: rule.id,
          triggered_at: new Date(),
          log_count: count,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      return {
        historyId: historyRecord.id,
        rule_id: rule.id,
        rule_name: rule.name,
        organization_id: rule.organization_id,
        project_id: rule.project_id,
        log_count: count,
        threshold: rule.threshold,
        time_window: rule.time_window,
        email_recipients: rule.email_recipients,
        webhook_url: rule.webhook_url,
      };
    }

    return null;
  }

  /**
   * Check a rate-of-change alert rule against baseline
   */
  private async checkRateOfChangeRule(rule: any, orgProjectsMap: Map<string, string[]>) {
    if (!rule.baseline_type || !rule.deviation_multiplier) return null;

    const deviationMultiplier = Number(rule.deviation_multiplier);
    const minBaseline = Number(rule.min_baseline_value || 10);
    const cooldownMin = Number(rule.cooldown_minutes || 60);
    const sustainedMin = Number(rule.sustained_minutes || 5);

    // Get project IDs
    const projectIds = rule.project_id
      ? [rule.project_id]
      : (orgProjectsMap.get(rule.organization_id) || []);

    if (projectIds.length === 0) return null;

    // Check cooldown: skip if last trigger was within cooldown period
    const lastTrigger = await db
      .selectFrom('alert_history')
      .select(['triggered_at'])
      .where('rule_id', '=', rule.id)
      .orderBy('triggered_at', 'desc')
      .executeTakeFirst();

    if (lastTrigger) {
      const cooldownEnd = new Date(lastTrigger.triggered_at).getTime() + cooldownMin * 60 * 1000;
      if (Date.now() < cooldownEnd) {
        return null;
      }
    }

    // Calculate baseline
    const baseline = await baselineCalculator.calculate(
      rule.baseline_type,
      projectIds,
      rule.level,
      rule.service || null,
    );

    if (!baseline || baseline.value < minBaseline) {
      // Reset sustained state - baseline too low or no data
      this.sustainedState.delete(rule.id);
      return null;
    }

    // Get current hourly rate
    const currentValue = await baselineCalculator.getCurrentHourlyRate(
      projectIds,
      rule.level,
      rule.service || null,
    );

    const deviationRatio = baseline.value > 0 ? currentValue / baseline.value : 0;

    // Check if deviation exceeds multiplier
    if (deviationRatio < deviationMultiplier) {
      // Reset sustained state - not exceeding threshold
      this.sustainedState.delete(rule.id);
      return null;
    }

    // Sustained check: anomaly must persist for sustained_minutes
    // We track consecutive checks (each ~60s apart)
    const requiredChecks = Math.max(1, Math.ceil(sustainedMin / 1)); // 1 check per minute
    const state = this.sustainedState.get(rule.id);
    const now = Date.now();

    if (state && (now - state.lastCheck) < 3 * 60 * 1000) {
      // Within 3 minutes of last check - increment counter
      const newCount = state.count + 1;
      this.sustainedState.set(rule.id, { count: newCount, lastCheck: now });

      if (newCount < requiredChecks) {
        return null; // Not yet sustained enough
      }
    } else {
      // First check or gap too large - start counting
      this.sustainedState.set(rule.id, { count: 1, lastCheck: now });
      if (requiredChecks > 1) {
        return null; // Need more checks
      }
    }

    // Reset sustained state after trigger
    this.sustainedState.delete(rule.id);

    const baselineMetadata: BaselineMetadata = {
      baseline_value: baseline.value,
      current_value: currentValue,
      deviation_ratio: Math.round(deviationRatio * 100) / 100,
      baseline_type: rule.baseline_type,
      evaluation_time: new Date().toISOString(),
    };

    // Record alert trigger
    const historyRecord = await db
      .insertInto('alert_history')
      .values({
        rule_id: rule.id,
        triggered_at: new Date(),
        log_count: currentValue,
        baseline_metadata: baselineMetadata,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return {
      historyId: historyRecord.id,
      rule_id: rule.id,
      rule_name: rule.name,
      organization_id: rule.organization_id,
      project_id: rule.project_id,
      log_count: currentValue,
      threshold: rule.threshold,
      time_window: rule.time_window,
      email_recipients: rule.email_recipients,
      webhook_url: rule.webhook_url,
      baseline_metadata: baselineMetadata,
    };
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
    const buckets = await this.getTimeBuckets(
      from,
      to,
      bucketInterval,
      projectIds,
      input.level,
      input.service
    );

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
        input.service
      );
    }

    // 7. Get affected services
    const affectedServices = await this.getAffectedServices(
      from,
      to,
      projectIds,
      input.level,
      input.service
    );

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
    service?: string | null
  ): Promise<PreviewIncident['sampleLogs']> {
    const serviceFilter = service ? [service, 'unknown'] : undefined;

    const result = await reservoir.query({
      projectId: projectIds,
      from,
      to,
      level: levels,
      service: serviceFilter,
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
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const alertsService = new AlertsService();
