import type { CapabilityUsage } from '$lib/api/usage';

/**
 * Quota grace is a percentage overage band, not a dated period (see the
 * backend quota-state module). The only date a user can act on is the next
 * reset of a calendar-month quota, which is the first instant of the next UTC
 * month.
 */
export function nextQuotaReset(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** "Nov 1" style, en-US, UTC. */
export function formatResetDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/**
 * Whether a capability row is a quota measured over a calendar month. The
 * usage API does not expose the registry `window`, so this mirrors it: every
 * quota is calendar-month except the point-in-time storage cap
 * (backend/src/capabilities/registry.ts).
 */
export function isMonthlyQuota(cap: Pick<CapabilityUsage, 'kind' | 'capability'>): boolean {
  return cap.kind === 'quota' && cap.capability !== 'storage.max_bytes';
}

export const CAPABILITY_LABELS: Record<string, { label: string; unit: 'count' | 'bytes' }> = {
  'alerts.max_rules': { label: 'Alert rules', unit: 'count' },
  'notifications.max_channels': { label: 'Notification channels', unit: 'count' },
  'apikeys.max': { label: 'API keys', unit: 'count' },
  'projects.max': { label: 'Projects', unit: 'count' },
  'sigma.max_active_rules': { label: 'Active Sigma rules', unit: 'count' },
  'dashboards.max_custom': { label: 'Custom dashboards', unit: 'count' },
  'ingestion.max_events_monthly': { label: 'Events (this month)', unit: 'count' },
  'ingestion.max_bytes_monthly': { label: 'Ingested bytes (this month)', unit: 'bytes' },
  'storage.max_bytes': { label: 'Storage used', unit: 'bytes' },
  'tracing.max_spans_monthly': { label: 'Spans (this month)', unit: 'count' },
  'metrics.max_datapoints_monthly': { label: 'Metric datapoints (this month)', unit: 'count' },
  'telemetry.max_bytes_monthly': { label: 'Telemetry (logs, traces and metrics)', unit: 'bytes' },
};

export function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability]?.label ?? capability;
}
