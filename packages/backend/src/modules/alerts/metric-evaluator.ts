import type { Selectable } from 'kysely';
import {
  METRIC_ALERT_MAX_GROUPS,
  METRIC_ALERT_WINDOW_MINUTES,
  formatMetricAlertLabels,
  metricAlertBreaches,
  metricAlertGroupKey,
  metricAlertTarget,
  type MetricAlertConfig,
  type MetricAlertInstancePayload,
  type MetricAlertWindow,
  type MetricQueryResponse,
} from '@logtide/shared';
import { db } from '../../database/connection.js';
import type { AlertRulesTable, AlertRuleState } from '../../database/types.js';
import { metricQueryService } from '../metrics/query/service.js';
import { hooks } from '../../hooks/index.js';
import { decideThreshold, type LifecycleDecision, type LifecycleSnapshot } from './lifecycle.js';
import { evaluationQuery } from './metric-config.js';
import { openMetricAlertIncident, resolveAlertIncident, retitleMetricAlertIncident } from './incident-sync.js';
import type { AlertEvaluationResult, AlertNotificationKind } from './types.js';

/**
 * Metric alert rules (alert_type 'metric', 1.8).
 *
 * Evaluation, on the existing alert cadence (one run per minute):
 * - Window: the last `window` minutes of FULL minutes, i.e. [to - window, to)
 *   with `to` = the start of the current minute, queried through the metrics
 *   query service at a 1 minute interval (multi-engine through the
 *   reservoir). The current, still filling minute is never read.
 * - Lead step: the query reads ONE extra minute before the window and that
 *   bucket is dropped before the value is computed. Rates of cumulative
 *   counters and cumulative histograms are differences between consecutive
 *   buckets, so the first bucket of a window has no value of its own; without
 *   the lead step a 1 minute window could never produce a rate.
 * - Value per group: the AVERAGE of the non-null 1 minute buckets of the
 *   watched query or formula in the window. The time aggregation of the
 *   query (avg, max, p95, rate...) applies inside each bucket; averaging the
 *   buckets smooths one late or partial bucket instead of letting the last
 *   bucket alone decide. A group without any point in the window has no
 *   value (no data).
 * - Groups: the query service returns EVERY group (internal.unfoldedGroups, no top-N
 *   fold), so breaches are evaluated before any ranking. Groups that already
 *   have an instance are always evaluated. New breaching groups get an
 *   instance ranked by the alert direction (highest first for `above`,
 *   lowest first for `below`) while the rule has fewer than
 *   METRIC_ALERT_MAX_GROUPS instances. An ungrouped query is a single
 *   instance with group key ''.
 * - Breach: value strictly above (or below) the threshold. An ok instance
 *   fires after `forEvaluations` consecutive breaching runs; a firing
 *   instance resolves on the first run whose value is evaluated and does
 *   not breach. Snooze and re-notify are the rule's own and apply per
 *   instance, through the same state machine as threshold rules
 *   (lifecycle.ts).
 * - No data policy (HOLD): a run where a group has no value (no point in the
 *   window, the group or the metric disappeared, the rule's projects are
 *   gone) is neither a breach nor a recovery. The instance keeps its state,
 *   its breach counter and its last value, and nothing is notified (no fire,
 *   no re-notify, no resolve). Missing data never resolves a firing instance
 *   by itself: it resolves when data comes back on the good side of the
 *   threshold, or when a user disables or deletes the rule.
 *
 * State: one alert_metric_instances row per instance that is firing or
 * counting breaches; ok instances without breaches have no row. The rule's
 * own lifecycle columns summarize the instances (firing when any is).
 * Incidents: one per rule (the incidents model allows one active incident per
 * source), opened by the first firing instance, retitled with the firing
 * groups and resolved when the last instance resolves.
 *
 * Disable / delete (alerts service) take the same rule row lock as the
 * evaluation and flip `enabled` first. The incident phase of an evaluation
 * runs under a share lock of the rule row that requires it to be enabled, so
 * a disabled or deleted rule never gets an incident (re)opened afterwards.
 */

export interface MetricGroupValue {
  groupKey: string;
  labels: Record<string, string>;
  value: number | null;
}

export interface MetricWindowResult {
  groups: MetricGroupValue[];
  /** Query or formula id watched by the rule. */
  queryId: string;
  /** Metric name of a query, expression of a formula. */
  source: string;
  unit: string | null;
}

export interface MetricInstanceRow {
  group_key: string;
  labels: Record<string, string>;
  state: AlertRuleState;
  consecutive_breaches: number;
  last_value: number | null;
  last_triggered_at: Date | null;
  last_notified_at: Date | null;
}

export interface MetricInstancePlan {
  groupKey: string;
  labels: Record<string, string>;
  value: number | null;
  decision: LifecycleDecision;
  previous: MetricInstanceRow | null;
  /** Row after this run, or null when the instance is ok without breaches (no row kept). */
  next: Omit<MetricInstanceRow, 'group_key' | 'labels'> | null;
}

const MINUTE_MS = 60_000;

/** [from, to) of the evaluation window: whole minutes ending at the start of the current minute. */
export function metricAlertWindowRange(window: MetricAlertWindow, now: Date): { from: Date; to: Date } {
  const to = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  return { from: new Date(to - METRIC_ALERT_WINDOW_MINUTES[window] * MINUTE_MS), to: new Date(to) };
}

/**
 * [from, to) actually queried: the window plus one lead step before it (see
 * the module comment). groupsFromResponse drops the lead bucket.
 */
export function metricAlertQueryRange(window: MetricAlertWindow, now: Date): { from: Date; to: Date } {
  const { from, to } = metricAlertWindowRange(window, now);
  return { from: new Date(from.getTime() - MINUTE_MS), to };
}

/**
 * Projects a metric rule reads: the query's explicit projects that are still
 * live projects of the organization, or every live project when it has none.
 */
export async function metricRuleProjects(organizationId: string, projectIds: string[] | null): Promise<string[]> {
  const rows = await db
    .selectFrom('projects')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute();
  const live = rows.map((r) => r.id).sort();
  if (projectIds === null) return live;
  const wanted = new Set(projectIds);
  return live.filter((id) => wanted.has(id));
}

/**
 * Window value of every group of the watched item, from one query service
 * response. Points before `windowFrom` (the lead step) are ignored.
 */
export function groupsFromResponse(
  config: MetricAlertConfig,
  response: MetricQueryResponse,
  windowFrom?: Date
): MetricWindowResult {
  const target = metricAlertTarget(config.query);
  if (!target) throw new Error('Metric alert query has no single visible query or formula');

  const info = response.queries.find((q) => q.id === target.id);
  // A metric that does not exist (yet) is no data, not a broken rule.
  if (info?.error && !info.error.startsWith('Unknown metric')) {
    throw new Error(`Metric alert query ${target.id} failed: ${info.error}`);
  }

  const groups: MetricGroupValue[] = [];
  for (const s of response.series) {
    if (s.queryId !== target.id || s.comparison || s.labels.__other__ === 'true') continue;
    const values = s.points
      .filter((p) => windowFrom === undefined || Date.parse(p.t) >= windowFrom.getTime())
      .map((p) => p.v)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const value = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    groups.push({ groupKey: metricAlertGroupKey(s.labels), labels: { ...s.labels }, value });
  }

  const source =
    target.kind === 'query'
      ? (config.query.queries.find((q) => q.id === target.id)?.metricName ?? target.id)
      : (config.query.formulas.find((f) => f.id === target.id)?.expression ?? target.id);

  return { groups, queryId: target.id, source, unit: info?.unit ?? null };
}

/** Run the rule's query over its window and return the value of every group. */
export async function computeMetricWindow(
  config: MetricAlertConfig,
  organizationId: string,
  projectIds: string[],
  now: Date
): Promise<MetricWindowResult> {
  const window = metricAlertWindowRange(config.window, now);
  const { from, to } = metricAlertQueryRange(config.window, now);
  const response = await metricQueryService.run({
    ...evaluationQuery(config.query),
    organizationId,
    projectIds,
    from: from.toISOString(),
    to: to.toISOString(),
    // Every group: breaches are evaluated here, before any ranking.
    internal: { unfoldedGroups: true },
  });
  return groupsFromResponse(config, response, window.from);
}

/**
 * Groups this run evaluates: every group that already has an instance (with
 * its value, or no data when it is absent), plus the new breaching groups,
 * most severe first in the alert direction, while the rule has fewer than
 * `maxGroups` instances. Non breaching groups without an instance need no
 * row and are left out.
 */
export function selectAlertGroups(
  config: Pick<MetricAlertConfig, 'condition' | 'threshold'>,
  groups: MetricGroupValue[],
  instances: Array<Pick<MetricInstanceRow, 'group_key'>>,
  maxGroups: number = METRIC_ALERT_MAX_GROUPS
): MetricGroupValue[] {
  const known = new Set(instances.map((i) => i.group_key));
  const kept: MetricGroupValue[] = [];
  const candidates: Array<{ group: MetricGroupValue; value: number }> = [];
  for (const g of groups) {
    if (known.has(g.groupKey)) kept.push(g);
    else if (g.value !== null && metricAlertBreaches(config.condition, g.value, config.threshold)) {
      candidates.push({ group: g, value: g.value });
    }
  }
  const direction = config.condition === 'above' ? -1 : 1;
  candidates.sort((a, b) => {
    if (a.value !== b.value) return direction * (a.value - b.value);
    return a.group.groupKey < b.group.groupKey ? -1 : a.group.groupKey > b.group.groupKey ? 1 : 0;
  });
  const room = Math.max(0, maxGroups - known.size);
  return [...kept, ...candidates.slice(0, room).map((c) => c.group)];
}

/**
 * Pure per-instance lifecycle: consecutive breach counting and the shared
 * threshold state machine (T1-T10), with the rule's snooze and re-notify.
 * Instances known from the database but absent from this run have no data,
 * and no data holds an instance as it is (see the module comment).
 */
export function planMetricInstances(
  config: MetricAlertConfig,
  groups: MetricGroupValue[],
  instances: MetricInstanceRow[],
  rule: { snoozedUntil: Date | null; renotifyMinutes: number | null },
  now: Date
): MetricInstancePlan[] {
  const byKey = new Map<string, { labels: Record<string, string>; value: number | null }>();
  for (const g of groups) byKey.set(g.groupKey, { labels: g.labels, value: g.value });
  for (const i of instances) {
    if (!byKey.has(i.group_key)) byKey.set(i.group_key, { labels: i.labels, value: null });
  }
  const previousByKey = new Map(instances.map((i) => [i.group_key, i]));

  const plans: MetricInstancePlan[] = [];
  for (const [groupKey, { labels, value }] of byKey) {
    const previous = previousByKey.get(groupKey) ?? null;
    if (value === null) {
      // No data: hold. Not a breach, not a recovery, nothing notified.
      plans.push({
        groupKey,
        labels,
        value: null,
        decision: { type: 'none' },
        previous,
        next: previous
          ? {
              state: previous.state,
              consecutive_breaches: previous.consecutive_breaches,
              last_value: previous.last_value,
              last_triggered_at: previous.last_triggered_at,
              last_notified_at: previous.last_notified_at,
            }
          : null,
      });
      continue;
    }
    const breachingNow = metricAlertBreaches(config.condition, value, config.threshold);
    const consecutive = breachingNow ? (previous?.consecutive_breaches ?? 0) + 1 : 0;
    const state: AlertRuleState = previous?.state ?? 'ok';
    const snapshot: LifecycleSnapshot = {
      state,
      lastTriggeredAt: previous?.last_triggered_at ?? null,
      lastNotifiedAt: previous?.last_notified_at ?? null,
      snoozedUntil: rule.snoozedUntil,
      renotifyMinutes: rule.renotifyMinutes,
    };
    // An ok instance needs `forEvaluations` breaching runs in a row; a firing
    // one keeps firing as long as it breaches.
    const breaching = state === 'ok' ? consecutive >= config.forEvaluations : breachingNow;
    const decision = decideThreshold(snapshot, breaching, now);

    let nextState = state;
    let lastTriggeredAt = snapshot.lastTriggeredAt;
    let lastNotifiedAt = snapshot.lastNotifiedAt;
    if (decision.type === 'fire') {
      nextState = 'firing';
      lastTriggeredAt = now;
      if (decision.notification) lastNotifiedAt = now;
    } else if (decision.type === 'notify') {
      lastNotifiedAt = now;
    } else if (decision.type === 'resolve') {
      nextState = 'ok';
    }

    const keep = nextState === 'firing' || consecutive > 0;
    plans.push({
      groupKey,
      labels,
      value,
      decision,
      previous,
      next: keep
        ? {
            state: nextState,
            consecutive_breaches: consecutive,
            last_value: value,
            last_triggered_at: lastTriggeredAt,
            last_notified_at: lastNotifiedAt,
          }
        : null,
    });
  }
  return plans;
}

function toDate(value: Date | string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

function sameTime(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

function instanceChanged(plan: MetricInstancePlan): boolean {
  const p = plan.previous;
  const n = plan.next;
  if (p === null || n === null) return p !== n;
  return (
    p.state !== n.state ||
    p.consecutive_breaches !== n.consecutive_breaches ||
    p.last_value !== n.last_value ||
    !sameTime(p.last_triggered_at, n.last_triggered_at) ||
    !sameTime(p.last_notified_at, n.last_notified_at)
  );
}

export async function loadInstances(
  executor: Pick<typeof db, 'selectFrom'>,
  rule: { id: string; organization_id: string }
): Promise<MetricInstanceRow[]> {
  const rows = await executor
    .selectFrom('alert_metric_instances')
    .select([
      'group_key',
      'labels',
      'state',
      'consecutive_breaches',
      'last_value',
      'last_triggered_at',
      'last_notified_at',
    ])
    .where('rule_id', '=', rule.id)
    .where('organization_id', '=', rule.organization_id)
    .execute();
  return rows.map((r) => ({
    group_key: r.group_key,
    labels: (r.labels ?? {}) as Record<string, string>,
    state: r.state,
    consecutive_breaches: Number(r.consecutive_breaches),
    last_value: r.last_value === null ? null : Number(r.last_value),
    last_triggered_at: toDate(r.last_triggered_at),
    last_notified_at: toDate(r.last_notified_at),
  }));
}

/**
 * Forget every instance of a rule (it stops being evaluated) and return the
 * ones that were firing. Disable / delete call it inside the transaction that
 * holds the rule row lock, so no evaluation can write instances in between.
 */
export async function takeMetricInstances(
  executor: Pick<typeof db, 'selectFrom' | 'deleteFrom'>,
  rule: { id: string; organization_id: string }
): Promise<MetricInstanceRow[]> {
  const rows = await loadInstances(executor, rule);
  if (rows.length > 0) {
    await executor
      .deleteFrom('alert_metric_instances')
      .where('rule_id', '=', rule.id)
      .where('organization_id', '=', rule.organization_id)
      .execute();
  }
  return rows.filter((i) => i.state === 'firing');
}

/**
 * Run `fn` while holding a share lock on the rule row, only when the rule is
 * still enabled; null otherwise. Disable / delete need the exclusive lock, so
 * they wait for `fn` and, once they ran, `fn` is skipped. Incident writes in
 * `fn` (other connections) only need a key share lock on the rule row, which
 * the share lock does not block.
 */
async function whileRuleEnabled<T>(
  rule: { id: string; organization_id: string },
  fn: () => Promise<T>
): Promise<T | null> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('alert_rules')
      .select('id')
      .where('id', '=', rule.id)
      .where('organization_id', '=', rule.organization_id)
      .where('enabled', '=', true)
      .forShare()
      .executeTakeFirst();
    if (!row) return null;
    return fn();
  });
}

/** Notification / webhook payload of one instance. */
export function metricInstancePayload(
  config: MetricAlertConfig,
  window: Pick<MetricWindowResult, 'queryId' | 'source' | 'unit'>,
  instance: { groupKey: string; labels: Record<string, string>; value: number | null }
): MetricAlertInstancePayload {
  return {
    query_id: window.queryId,
    source: window.source,
    condition: config.condition,
    threshold: config.threshold,
    value: instance.value,
    unit: window.unit,
    window: config.window,
    for_evaluations: config.forEvaluations,
    labels: { ...instance.labels },
    group_key: instance.groupKey,
  };
}

/** Static description of the watched item when no query ran (disable / delete). */
export function metricWindowFromConfig(config: MetricAlertConfig): Pick<MetricWindowResult, 'queryId' | 'source' | 'unit'> {
  const target = metricAlertTarget(config.query);
  const id = target?.id ?? config.query.queries[0]?.id ?? 'A';
  const source =
    target?.kind === 'formula'
      ? (config.query.formulas.find((f) => f.id === id)?.expression ?? id)
      : (config.query.queries.find((q) => q.id === id)?.metricName ?? id);
  return { queryId: id, source, unit: null };
}

/** Rule name plus the labels of a group: "CPU high (host.name=web-1)". */
export function metricInstanceTitle(ruleName: string, labels: Record<string, string>): string {
  const text = formatMetricAlertLabels(labels);
  return text ? `${ruleName} (${text})` : ruleName;
}

/** Incident title listing the firing groups (at most 3, then "+N more"). */
export function metricIncidentTitle(ruleName: string, firing: Array<Record<string, string>>): string {
  const labelled = firing.map(formatMetricAlertLabels).filter((t) => t.length > 0).sort();
  if (labelled.length === 0) return ruleName;
  const shown = labelled.slice(0, 3).join('; ');
  const more = labelled.length > 3 ? ` +${labelled.length - 3} more` : '';
  return `${ruleName} (${shown}${more})`;
}

async function activeIncidentId(rule: { id: string; organization_id: string }): Promise<string | null> {
  const row = await db
    .selectFrom('incidents')
    .select('id')
    .where('organization_id', '=', rule.organization_id)
    .where('source', '=', 'alert')
    .where('alert_rule_id', '=', rule.id)
    .where('status', 'in', ['open', 'investigating'])
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Evaluate one metric rule at `now` and apply the per-instance decisions.
 * The query runs first (no lock held); the decisions are then computed and
 * written under a row lock of the rule with a compare-and-set on
 * last_evaluated_at, so of two concurrent evaluators only the first applies
 * a run. Returns the notifications to enqueue.
 */
export async function evaluateMetricRule(
  rule: Selectable<AlertRulesTable>,
  now: Date
): Promise<AlertEvaluationResult[]> {
  const config = rule.metric_config as MetricAlertConfig | null;
  if (!config) throw new Error('Metric rule without metric_config');

  const projectIds = await metricRuleProjects(rule.organization_id, config.query.projectIds);
  const window: MetricWindowResult =
    projectIds.length > 0
      ? await computeMetricWindow(config, rule.organization_id, projectIds, now)
      : { ...metricWindowFromConfig(config), groups: [] };

  const readEvaluatedAt = toDate(rule.last_evaluated_at);
  const snoozedUntil = toDate(rule.snoozed_until);
  const renotifyMinutes = rule.renotify_minutes != null ? Number(rule.renotify_minutes) : null;

  const applied = await db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom('alert_rules')
      .select(['id', 'state', 'last_triggered_at', 'last_evaluated_at'])
      .where('id', '=', rule.id)
      .where('organization_id', '=', rule.organization_id)
      .where('enabled', '=', true)
      .forUpdate()
      .executeTakeFirst();
    if (!locked || !sameTime(toDate(locked.last_evaluated_at), readEvaluatedAt)) return null;

    const instances = await loadInstances(trx, rule);
    const groups = selectAlertGroups(config, window.groups, instances);
    const plans = planMetricInstances(config, groups, instances, { snoozedUntil, renotifyMinutes }, now);

    for (const plan of plans) {
      if (!instanceChanged(plan)) continue;
      if (plan.next === null) {
        await trx
          .deleteFrom('alert_metric_instances')
          .where('rule_id', '=', rule.id)
          .where('organization_id', '=', rule.organization_id)
          .where('group_key', '=', plan.groupKey)
          .execute();
        continue;
      }
      const values = {
        labels: JSON.stringify(plan.labels),
        state: plan.next.state,
        consecutive_breaches: plan.next.consecutive_breaches,
        last_value: plan.next.last_value,
        last_triggered_at: plan.next.last_triggered_at,
        last_notified_at: plan.next.last_notified_at,
        updated_at: now,
      };
      await trx
        .insertInto('alert_metric_instances')
        .values({ rule_id: rule.id, organization_id: rule.organization_id, group_key: plan.groupKey, ...values })
        .onConflict((oc) => oc.columns(['rule_id', 'group_key']).doUpdateSet(values))
        .execute();
    }

    // One alert_history row per triggered / renotify notification.
    const histories = new Map<string, string>();
    for (const plan of plans) {
      const kind = notificationKind(plan.decision);
      if (kind !== 'triggered' && kind !== 'renotify') continue;
      const row = await trx
        .insertInto('alert_history')
        .values({
          rule_id: rule.id,
          triggered_at: now,
          log_count: 0,
          baseline_metadata: null,
          metric_metadata: JSON.stringify(metricInstancePayload(config, window, plan)),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      histories.set(plan.groupKey, row.id);
    }

    const wasFiring = locked.state === 'firing';
    const firing = plans.filter((p) => p.next?.state === 'firing');
    const anyFiring = firing.length > 0;
    const notified = plans.some((p) => p.next !== null && p.next.last_notified_at !== null && sameTime(p.next.last_notified_at, now));
    const ruleSet: {
      state: AlertRuleState;
      last_evaluated_at: Date;
      last_triggered_at?: Date;
      last_notified_at?: Date;
    } = { state: anyFiring ? 'firing' : 'ok', last_evaluated_at: now };
    if (anyFiring && !wasFiring) ruleSet.last_triggered_at = now;
    if (notified) ruleSet.last_notified_at = now;
    await trx
      .updateTable('alert_rules')
      .set(ruleSet)
      .where('id', '=', rule.id)
      .where('organization_id', '=', rule.organization_id)
      .execute();

    return {
      plans,
      histories,
      wasFiring,
      anyFiring,
      firingLabels: firing.map((p) => p.labels),
      ruleFiringSince: toDate(locked.last_triggered_at),
    };
  });
  if (!applied) return [];

  const { plans, histories, wasFiring, anyFiring, firingLabels } = applied;
  const results: AlertEvaluationResult[] = [];
  const timeWindow = METRIC_ALERT_WINDOW_MINUTES[config.window];

  // Incident: opened or updated by every firing transition / notification.
  // Under a share lock of the still enabled rule: a disable or delete that
  // committed meanwhile already resolved the incident and must not see it
  // reopened. The notifications of this run still go out (the disable sends
  // the matching resolves), only without an incident.
  const firingPlans = plans.filter((p) => p.decision.type === 'fire' || p.decision.type === 'notify');
  const resolving = plans.filter((p) => p.decision.type === 'resolve');
  const incidents = await whileRuleEnabled(rule, async () => {
    let opened: string | null = null;
    for (const plan of firingPlans) {
      const payload = metricInstancePayload(config, window, plan);
      opened = await openMetricAlertIncident(rule, config, {
        now,
        historyId: histories.get(plan.groupKey) ?? null,
        notification: notificationKind(plan.decision) as AlertNotificationKind | null,
        metric: payload,
        title: metricIncidentTitle(rule.name, firingLabels),
      });
    }
    const grouped = plans.some((p) => Object.keys(p.labels).length > 0);
    if (anyFiring && grouped && (firingPlans.length > 0 || resolving.length > 0)) {
      await retitleMetricAlertIncident(rule, config, metricIncidentTitle(rule.name, firingLabels));
    }

    let resolved: string | null = null;
    if (wasFiring && !anyFiring) {
      resolved = await resolveAlertIncident(rule, 'recovered', now);
    } else if (resolving.length > 0) {
      resolved = opened ?? (await activeIncidentId(rule));
    }
    return { opened, resolved };
  });
  const incidentId = incidents?.opened ?? null;
  const resolvedIncidentId = incidents?.resolved ?? null;

  for (const plan of plans) {
    const kind = notificationKind(plan.decision);
    if (kind === null) continue;
    const payload = metricInstancePayload(config, window, plan);
    const historyId = histories.get(plan.groupKey) ?? null;

    if (kind === 'resolved') {
      results.push({
        kind: 'resolved',
        rule_id: rule.id,
        rule_name: rule.name,
        organization_id: rule.organization_id,
        project_id: rule.project_id ?? null,
        alert_type: 'metric',
        log_count: 0,
        threshold: config.threshold,
        time_window: timeWindow,
        firing_since: (plan.previous?.last_triggered_at ?? now).toISOString(),
        resolved_at: now.toISOString(),
        incident_id: resolvedIncidentId,
        metric: payload,
      });
      continue;
    }

    if (!historyId) continue;
    if (hooks.hasHandlers('afterAlertTriggered')) {
      void hooks.runAfter('afterAlertTriggered', {
        organizationId: rule.organization_id,
        projectId: rule.project_id ?? null,
        ruleId: rule.id,
        ruleName: rule.name,
        historyId,
        logCount: 0,
        baselineMetadata: null,
      });
    }
    const firingSince = plan.decision.type === 'fire' ? now : (plan.previous?.last_triggered_at ?? now);
    results.push({
      historyId,
      rule_id: rule.id,
      rule_name: rule.name,
      organization_id: rule.organization_id,
      project_id: rule.project_id ?? null,
      log_count: 0,
      threshold: config.threshold,
      time_window: timeWindow,
      email_recipients: rule.email_recipients,
      webhook_url: rule.webhook_url,
      kind,
      firing_since: firingSince.toISOString(),
      incident_id: incidentId,
      alert_type: 'metric',
      metric: payload,
    });
  }

  return results;
}

function notificationKind(decision: LifecycleDecision): AlertNotificationKind | 'resolved' | null {
  if (decision.type === 'none') return null;
  return decision.notification;
}
