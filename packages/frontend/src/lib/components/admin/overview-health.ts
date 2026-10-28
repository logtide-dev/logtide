import type { ActiveIssues, HealthStats, IngestionHealthStats } from '$lib/api/admin';

export type OverallState = 'ok' | 'degraded' | 'down' | 'unknown';

export interface OverallHealth {
  state: OverallState;
  /** Key for stateTone() in utils/severity.ts. */
  tone: 'ok' | 'acknowledged' | 'down' | 'pending';
  label: string;
  /** Components that are not healthy, e.g. "Redis is down". */
  problems: string[];
}

const COMPONENT_NAMES: Array<[keyof HealthStats, string]> = [
  ['database', 'PostgreSQL'],
  ['clickhouse', 'ClickHouse'],
  ['mongodb', 'MongoDB'],
  ['redis', 'Redis'],
];

/** Overall status line from the health stats, plus the components that pull it down. */
export function overallHealth(health: HealthStats | null | undefined): OverallHealth {
  if (!health) return { state: 'unknown', tone: 'pending', label: 'Status unavailable', problems: [] };

  const problems: string[] = [];
  for (const [key, name] of COMPONENT_NAMES) {
    const comp = health[key] as { status?: string } | undefined;
    if (!comp || typeof comp !== 'object' || !('status' in comp)) continue;
    if (comp.status === 'degraded') problems.push(`${name} is degraded`);
    else if (comp.status === 'down') problems.push(`${name} is down`);
  }

  switch (health.overall) {
    case 'healthy':
      return { state: 'ok', tone: 'ok', label: 'All systems healthy', problems };
    case 'degraded':
      return { state: 'degraded', tone: 'acknowledged', label: 'Degraded', problems };
    case 'down':
      return { state: 'down', tone: 'down', label: 'Down', problems };
    default:
      return { state: 'unknown', tone: 'pending', label: 'Status unavailable', problems };
  }
}

export interface IssueItem {
  key: 'incidents' | 'critical' | 'notifications' | 'errors';
  label: string;
  /** Explicit window, or "right now" for open counts. */
  window: string;
  count: number;
  /** Tone key for stateTone(): colours the count when it is above zero. */
  tone: 'down' | 'acknowledged' | 'pending';
}

/** Active issues kept apart: summing incidents with failed notifications means nothing. */
export function activeIssueItems(issues: ActiveIssues): IssueItem[] {
  return [
    { key: 'incidents', label: 'Open incidents', window: 'right now', count: issues.openIncidents, tone: 'down' },
    {
      key: 'critical',
      label: 'Critical detections',
      window: 'last 24 hours',
      count: issues.criticalDetections24h,
      tone: 'down',
    },
    {
      key: 'notifications',
      label: 'Failed notifications',
      window: 'last 24 hours',
      count: issues.failedNotifications24h,
      tone: 'acknowledged',
    },
    { key: 'errors', label: 'Open error groups', window: 'right now', count: issues.openErrorGroups, tone: 'pending' },
  ];
}

export interface IngestionCounterItem {
  key: string;
  label: string;
  count: number;
  /** Counts above zero are a problem for these. */
  alarm: boolean;
}

/** Labelled ingestion counters for the last 24 hours. */
export function ingestionCounterItems(c: IngestionHealthStats['counters24h']): IngestionCounterItem[] {
  return [
    { key: 'piiRejected', label: 'Records rejected by PII masking', count: c.piiRejected, alarm: true },
    { key: 'detectionEnqueueFailed', label: 'Detection enqueue failures', count: c.detectionEnqueueFailed, alarm: true },
    { key: 'exceptionEnqueueFailed', label: 'Exception enqueue failures', count: c.exceptionEnqueueFailed, alarm: true },
    { key: 'identifierFailed', label: 'Identifier failures', count: c.identifierFailed, alarm: false },
    { key: 'timestampSkew', label: 'Log timestamp skew', count: c.timestampSkew, alarm: false },
    { key: 'spanTimestampSkew', label: 'Span timestamp skew', count: c.spanTimestampSkew, alarm: false },
    { key: 'metricTimestampSkew', label: 'Metric timestamp skew', count: c.metricTimestampSkew, alarm: false },
  ];
}
