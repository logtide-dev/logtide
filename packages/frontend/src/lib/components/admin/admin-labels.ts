import type { EntitlementValue } from '$lib/api/admin';

export type EntitlementGroupId = 'access' | 'detection' | 'alerting' | 'workspace' | 'quotas';

export type EntitlementUnit = 'count' | 'days' | 'percent' | 'bytes' | 'events' | 'spans' | 'datapoints' | '';

export interface EntitlementMeta {
  label: string;
  group: EntitlementGroupId;
  /** Unit of a numeric value; empty for booleans. */
  unit: EntitlementUnit;
}

export const ENTITLEMENT_GROUPS: Array<{ id: EntitlementGroupId; label: string }> = [
  { id: 'access', label: 'Access and audit' },
  { id: 'detection', label: 'Detection' },
  { id: 'alerting', label: 'Alerting and notifications' },
  { id: 'workspace', label: 'Workspace limits' },
  { id: 'quotas', label: 'Ingestion and storage quotas' },
];

const META: Record<string, EntitlementMeta> = {
  'auth.sso': { label: 'Single sign-on', group: 'access', unit: '' },
  'audit.enabled': { label: 'Audit log recording', group: 'access', unit: '' },
  'audit.retention_days': { label: 'Audit retention cap', group: 'access', unit: 'days' },
  'isolation.dedicated': { label: 'Dedicated storage routing', group: 'access', unit: '' },
  'detection.advanced': { label: 'Advanced detection packs', group: 'detection', unit: '' },
  'sigma.max_active_rules': { label: 'Active Sigma rules', group: 'detection', unit: 'count' },
  'sigma.exceptions.max_per_rule': { label: 'Exceptions per detection rule', group: 'detection', unit: 'count' },
  'alerts.max_rules': { label: 'Alert rules', group: 'alerting', unit: 'count' },
  'notifications.max_channels': { label: 'Notification channels', group: 'alerting', unit: 'count' },
  'digests.max_recipients': { label: 'Digest recipients', group: 'alerting', unit: 'count' },
  'status_page.subscribers.max': { label: 'Status page subscribers', group: 'alerting', unit: 'count' },
  'projects.max': { label: 'Active projects', group: 'workspace', unit: 'count' },
  'apikeys.max': { label: 'API keys', group: 'workspace', unit: 'count' },
  'dashboards.max_custom': { label: 'Custom dashboards', group: 'workspace', unit: 'count' },
  'receivers.max': { label: 'Inbound webhook receivers', group: 'workspace', unit: 'count' },
  'saved_searches.max_per_org': { label: 'Saved searches', group: 'workspace', unit: 'count' },
  'ingestion.max_bytes_monthly': { label: 'Log bytes per month', group: 'quotas', unit: 'bytes' },
  'ingestion.max_events_monthly': { label: 'Log events per month', group: 'quotas', unit: 'events' },
  'tracing.max_spans_monthly': { label: 'Spans per month', group: 'quotas', unit: 'spans' },
  'metrics.max_datapoints_monthly': { label: 'Metric datapoints per month', group: 'quotas', unit: 'datapoints' },
  'telemetry.max_bytes_monthly': { label: 'Telemetry bytes per month (logs, traces, metrics)', group: 'quotas', unit: 'bytes' },
  'storage.max_bytes': { label: 'Stored bytes (current)', group: 'quotas', unit: 'bytes' },
  'quota.grace_percent': { label: 'Quota grace', group: 'quotas', unit: 'percent' },
};

/** Falls back to the raw key so a capability added later is still editable. */
export function entitlementMeta(key: string, kind?: EntitlementValue['kind']): EntitlementMeta {
  if (Object.prototype.hasOwnProperty.call(META, key)) return META[key];
  return { label: key, group: kind === 'boolean' ? 'access' : 'workspace', unit: kind === 'boolean' ? '' : 'count' };
}

export function hasEntitlementLabel(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(META, key);
}

const UNIT_TEXT: Record<EntitlementUnit, string> = {
  count: '',
  days: 'days',
  percent: '%',
  bytes: 'bytes',
  events: 'events',
  spans: 'spans',
  datapoints: 'datapoints',
  '': '',
};

/** Short unit suffix for the input ("days", "bytes"); empty when there is none. */
export function entitlementUnitText(unit: EntitlementUnit): string {
  return UNIT_TEXT[unit];
}

/** Groups rows in display order; empty groups are dropped. */
export function groupEntitlementRows<T extends { capability: string; kind: EntitlementValue['kind'] }>(
  rows: T[],
): Array<{ id: EntitlementGroupId; label: string; rows: T[] }> {
  return ENTITLEMENT_GROUPS.map((g) => ({
    ...g,
    rows: rows.filter((r) => entitlementMeta(r.capability, r.kind).group === g.id),
  })).filter((g) => g.rows.length > 0);
}

const METRIC_LABELS: Record<string, string> = {
  'logs.ingested.events': 'Log events ingested',
  'logs.ingested.bytes': 'Log bytes ingested',
  'spans.ingested': 'Spans ingested',
  'spans.ingested.bytes': 'Span bytes ingested',
  'metrics.ingested.datapoints': 'Metric datapoints ingested',
  'metrics.ingested.bytes': 'Metric bytes ingested',
  'metrics.cardinality': 'Metric series cardinality',
  'storage.snapshot': 'Storage snapshot',
};

/** Human label for a metering type; unknown ids come back unchanged. */
export function metricLabel(type: string): string {
  return Object.prototype.hasOwnProperty.call(METRIC_LABELS, type) ? METRIC_LABELS[type] : type;
}

export function isBytesMetric(type: string): boolean {
  return type.endsWith('.bytes') || type === 'storage.snapshot';
}
