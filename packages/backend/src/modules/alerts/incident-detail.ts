import {
  INCIDENT_ACTIVE_STATUSES,
  metricAlertGroupKey,
  type IncidentMetricAlertDetail,
  type IncidentMetricAlertGroup,
  type IncidentSourceEvent,
  type IncidentStatus,
  type MetricAlertConfig,
  type MetricAlertInstancePayload,
} from '@logtide/shared';
import { db } from '../../database/connection.js';
import { metricWindowFromConfig } from './metric-evaluator.js';

/**
 * Metric view of an alert incident (incident detail payload): the rule, its
 * threshold and window, and the groups that fired during the incident.
 *
 * - Groups seen in the incident's source events (one per fire / notify of an
 *   instance) are `resolved` with the value of their latest event.
 * - While the incident is active, the rule's firing instances override them
 *   (`firing`, last evaluated value, firing since).
 * Every read is scoped by the organization; a rule of another organization
 * reads as deleted.
 */

interface IncidentRef {
  organizationId: string;
  source: string;
  status: IncidentStatus;
  alertRuleId: string | null;
  /** Shown as the rule name once the rule is gone. */
  title: string;
}

function metricOf(event: IncidentSourceEvent): MetricAlertInstancePayload | null {
  const detail = event.detail as { alertType?: unknown; metric?: unknown } | undefined;
  if (!detail || detail.alertType !== 'metric' || !detail.metric || typeof detail.metric !== 'object') return null;
  const m = detail.metric as MetricAlertInstancePayload;
  return m.labels && typeof m.labels === 'object' ? m : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function metricIncidentDetail(
  incident: IncidentRef,
  sourceEvents: IncidentSourceEvent[]
): Promise<IncidentMetricAlertDetail | null> {
  if (incident.source !== 'alert') return null;

  const rule = incident.alertRuleId
    ? await db
        .selectFrom('alert_rules')
        .select(['id', 'organization_id', 'name', 'alert_type', 'metric_config'])
        .where('id', '=', incident.alertRuleId)
        .where('organization_id', '=', incident.organizationId)
        .executeTakeFirst()
    : undefined;
  const config = rule?.alert_type === 'metric' ? (rule.metric_config as MetricAlertConfig | null) : null;

  // Source events are newest first.
  const events = sourceEvents
    .map((e) => ({ time: e.time, metric: metricOf(e) }))
    .filter((e): e is { time: string; metric: MetricAlertInstancePayload } => e.metric !== null);
  if (!config && events.length === 0) return null;

  const groups = new Map<string, IncidentMetricAlertGroup>();
  for (const { time, metric } of events) {
    const groupKey = typeof metric.group_key === 'string' ? metric.group_key : metricAlertGroupKey(metric.labels);
    const known = groups.get(groupKey);
    if (known) {
      // Older event of the same group: only moves "since" back.
      known.firingSince = time;
      continue;
    }
    groups.set(groupKey, {
      groupKey,
      labels: { ...metric.labels },
      value: typeof metric.value === 'number' ? metric.value : null,
      state: 'resolved',
      firingSince: time,
    });
  }

  const active = (INCIDENT_ACTIVE_STATUSES as readonly string[]).includes(incident.status);
  if (rule && config && active) {
    const firing = await db
      .selectFrom('alert_metric_instances')
      .select(['group_key', 'labels', 'last_value', 'last_triggered_at'])
      .where('rule_id', '=', rule.id)
      .where('organization_id', '=', incident.organizationId)
      .where('state', '=', 'firing')
      .execute();
    for (const row of firing) {
      groups.set(row.group_key, {
        groupKey: row.group_key,
        labels: { ...((row.labels ?? {}) as Record<string, string>) },
        value: row.last_value === null ? null : Number(row.last_value),
        state: 'firing',
        firingSince: toIso(row.last_triggered_at) ?? groups.get(row.group_key)?.firingSince ?? null,
      });
    }
  }

  const latest = events[0]?.metric ?? null;
  const watched = config ? metricWindowFromConfig(config) : null;
  const condition = config?.condition ?? latest?.condition ?? 'above';
  const direction = condition === 'above' ? -1 : 1;
  const sorted = [...groups.values()].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'firing' ? -1 : 1;
    if (a.value !== null && b.value !== null && a.value !== b.value) return direction * (a.value - b.value);
    if (a.value === null && b.value !== null) return 1;
    if (b.value === null && a.value !== null) return -1;
    return a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0;
  });

  return {
    ruleId: rule?.id ?? null,
    ruleName: rule?.name ?? incident.title,
    config,
    queryId: watched?.queryId ?? latest?.query_id ?? 'A',
    source: watched?.source ?? latest?.source ?? '',
    condition,
    threshold: config?.threshold ?? latest?.threshold ?? 0,
    // The evaluator's unit (catalog or override) when an event carries it.
    unit: latest?.unit ?? config?.unit ?? null,
    window: config?.window ?? latest?.window ?? '5m',
    groups: sorted,
  };
}
