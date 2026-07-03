/**
 * Tables scoped to a tenant: every query/update/delete MUST filter by
 * organization_id and/or project_id.
 */
export const TENANT_TABLES = new Set<string>([
  'logs', 'api_keys', 'alert_rules', 'alert_history', 'notifications',
  'sigma_rules', 'traces', 'spans', 'logs_hourly_stats', 'logs_daily_stats',
  'spans_hourly_stats', 'spans_daily_stats', 'detection_events_hourly_stats',
  'detection_events_daily_stats', 'detection_events_rule_stats', 'detection_events',
  'incidents', 'monitors', 'monitor_results', 'monitor_uptime_daily',
  'status_incidents', 'scheduled_maintenances', 'exceptions', 'sourcemaps',
  'error_groups', 'detection_pack_activations', 'log_identifiers',
  'identifier_patterns', 'notification_channels', 'organization_default_channels',
  'pii_masking_rules', 'organization_pii_salts', 'audit_log', 'metrics_hourly_stats',
  'metrics_daily_stats', 'metrics', 'metric_exemplars', 'custom_dashboards',
  'log_pipelines', 'digest_configs', 'digest_recipients', 'projects',
  'receivers',
]);

/**
 * Tables with no tenant column, scoped indirectly through a FK to a parent row.
 */
export const CHILD_TABLES = new Set<string>([
  'monitor_status', 'status_incident_updates', 'incident_alerts',
  'incident_comments', 'incident_history', 'stack_frames',
  'alert_rule_channels', 'sigma_rule_channels', 'monitor_channels',
  'incident_channels', 'error_group_channels', 'receiver_events',
]);

/** Intentionally global tables (no tenant scope). */
export const GLOBAL_TABLES = new Set<string>([
  'users', 'sessions', 'organizations', 'organization_members',
  'organization_invitations', 'user_identities', 'oidc_states',
  'system_settings', 'auth_providers', 'user_onboarding',
]);

export type TableCategory = 'tenant' | 'child' | 'global' | 'unknown';

export function classifyTable(table: string): TableCategory {
  if (TENANT_TABLES.has(table)) return 'tenant';
  if (CHILD_TABLES.has(table)) return 'child';
  if (GLOBAL_TABLES.has(table)) return 'global';
  return 'unknown';
}
