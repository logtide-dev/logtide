export type ProjectHealthCheckKey =
  | 'silent'
  | 'pii_rejected'
  | 'timestamp_skew_logs'
  | 'timestamp_skew_spans'
  | 'timestamp_skew_metrics'
  | 'revoked_key';

export type ProjectHealthSeverity = 'critical' | 'warning';

export const PROJECT_HEALTH_CHECKS: Record<
  ProjectHealthCheckKey,
  { severity: ProjectHealthSeverity; title: string }
> = {
  silent: { severity: 'critical', title: 'Project stopped sending data' },
  pii_rejected: { severity: 'critical', title: 'Records rejected by PII masking' },
  timestamp_skew_logs: { severity: 'warning', title: 'Logs with out-of-range timestamp' },
  timestamp_skew_spans: { severity: 'warning', title: 'Spans with out-of-range timestamp' },
  timestamp_skew_metrics: { severity: 'warning', title: 'Metrics with out-of-range timestamp' },
  revoked_key: { severity: 'warning', title: 'Data sent with a revoked API key' },
};

/**
 * inactive: the project received data in the past but nothing within its silent
 * threshold, and the silent check is not alerting (it was already idle when
 * health checks started, or the silent issue is muted).
 */
export type ProjectHealthStatus = 'healthy' | 'warning' | 'critical' | 'inactive' | 'no_data';

export type ProjectHealthMuteDuration = '24h' | '7d' | 'until_resolved';

export interface ProjectHealthMute {
  until: string | null;
  untilResolved: boolean;
}

export interface ProjectHealthIssue {
  id: string;
  checkKey: ProjectHealthCheckKey;
  severity: ProjectHealthSeverity;
  openedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  details: Record<string, unknown>;
  mute: ProjectHealthMute | null;
}

export const PROJECT_HEALTH_SILENT_DEFAULT_MINUTES = 60;
export const PROJECT_HEALTH_SILENT_MIN_MINUTES = 10;
export const PROJECT_HEALTH_SILENT_MAX_MINUTES = 1440;
