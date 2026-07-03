import { describe, it, expect } from 'vitest';
import { TENANT_TABLES, GLOBAL_TABLES, CHILD_TABLES, classifyTable } from '../../database/tenant-tables.js';

const ALL_TABLES = [
  'logs', 'users', 'sessions', 'organizations', 'organization_members',
  'organization_invitations', 'projects', 'api_keys', 'alert_rules', 'alert_history',
  'notifications', 'sigma_rules', 'traces', 'spans', 'logs_hourly_stats',
  'logs_daily_stats', 'spans_hourly_stats', 'spans_daily_stats',
  'detection_events_hourly_stats', 'detection_events_daily_stats',
  'detection_events_rule_stats', 'user_onboarding', 'detection_events', 'incidents',
  'monitors', 'monitor_status', 'monitor_results', 'monitor_uptime_daily',
  'status_incidents', 'status_incident_updates', 'scheduled_maintenances',
  'incident_alerts', 'incident_comments', 'incident_history', 'exceptions',
  'stack_frames', 'sourcemaps', 'error_groups', 'user_identities', 'oidc_states',
  'system_settings', 'auth_providers', 'detection_pack_activations', 'log_identifiers',
  'identifier_patterns', 'notification_channels', 'alert_rule_channels',
  'sigma_rule_channels', 'monitor_channels', 'incident_channels', 'error_group_channels',
  'organization_default_channels', 'pii_masking_rules', 'organization_pii_salts',
  'audit_log', 'metrics_hourly_stats', 'metrics_daily_stats', 'metrics',
  'metric_exemplars', 'custom_dashboards', 'log_pipelines', 'digest_configs',
  'digest_recipients', 'receivers', 'receiver_events',
];

describe('tenant-tables manifest', () => {
  it('classifies every table exactly once', () => {
    for (const t of ALL_TABLES) {
      const count = [TENANT_TABLES.has(t), GLOBAL_TABLES.has(t), CHILD_TABLES.has(t)].filter(Boolean).length;
      expect(count, `table "${t}" must be in exactly one category`).toBe(1);
    }
  });

  it('has no unknown tables in any set', () => {
    const known = new Set(ALL_TABLES);
    for (const t of [...TENANT_TABLES, ...GLOBAL_TABLES, ...CHILD_TABLES]) {
      expect(known.has(t), `"${t}" is categorized but not in ALL_TABLES`).toBe(true);
    }
  });

  it('classifyTable returns the right category', () => {
    expect(classifyTable('logs')).toBe('tenant');
    expect(classifyTable('users')).toBe('global');
    expect(classifyTable('incident_comments')).toBe('child');
    expect(classifyTable('does_not_exist')).toBe('unknown');
  });
});
