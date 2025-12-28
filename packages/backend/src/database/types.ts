import type { ColumnType } from 'kysely';

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface LogsTable {
  id: Generated<string>;
  time: Timestamp;
  project_id: string | null;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  trace_id: string | null;
  span_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string | null; // Nullable: OIDC/LDAP users may not have local passwords
  name: string;
  is_admin: Generated<boolean>;
  disabled: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  last_login: Timestamp | null;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token: string;
  expires_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface OrganizationMembersTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: Generated<Timestamp>;
}

export interface OrganizationInvitationsTable {
  id: Generated<string>;
  organization_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  token: string;
  invited_by: string;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface ProjectsTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string; // Keep for tracking who created the project
  name: string;
  description: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ApiKeysTable {
  id: Generated<string>;
  project_id: string;
  name: string;
  key_hash: string;
  created_at: Generated<Timestamp>;
  last_used: Timestamp | null;
  revoked: Generated<boolean>;
}

export interface AlertRulesTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  name: string;
  enabled: Generated<boolean>;
  service: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold: number;
  time_window: number;
  email_recipients: string[];
  webhook_url: string | null;
  metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface AlertHistoryTable {
  id: Generated<string>;
  rule_id: string;
  triggered_at: Timestamp;
  log_count: number;
  notified: Generated<boolean>;
  error: string | null;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: 'alert' | 'system' | 'organization_invite' | 'project_update';
  title: string;
  message: string;
  read: Generated<boolean>;
  organization_id: string | null;
  project_id: string | null;
  metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  created_at: Generated<Timestamp>;
}

export interface SigmaRulesTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  sigma_id: string | null;
  title: string;
  description: string | null;
  author: string | null;
  date: Timestamp | null;
  level: string | null;
  status: string | null;
  logsource: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  detection: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  email_recipients: string[];
  webhook_url: string | null;
  alert_rule_id: string | null;
  conversion_status: string | null;
  conversion_notes: string | null;
  enabled: Generated<boolean>;
  // Phase 3: SigmaHQ integration fields
  tags: string[] | null;
  mitre_tactics: string[] | null;
  mitre_techniques: string[] | null;
  sigmahq_path: string | null;
  sigmahq_commit: string | null;
  last_synced_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type SpanKind = 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

export interface TracesTable {
  trace_id: string;
  organization_id: string;
  project_id: string;
  service_name: string;
  root_service_name: string | null;
  root_operation_name: string | null;
  start_time: Timestamp;
  end_time: Timestamp;
  duration_ms: number;
  span_count: number;
  error: boolean;
  created_at: Generated<Timestamp>;
}

export interface SpansTable {
  time: Timestamp;
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  organization_id: string;
  project_id: string;
  service_name: string;
  operation_name: string;
  start_time: Timestamp;
  end_time: Timestamp;
  duration_ms: number;
  kind: SpanKind | null;
  status_code: SpanStatusCode | null;
  status_message: string | null;
  attributes: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  events: ColumnType<Array<Record<string, unknown>> | null, Array<Record<string, unknown>> | null, Array<Record<string, unknown>> | null>;
  links: ColumnType<Array<Record<string, unknown>> | null, Array<Record<string, unknown>> | null, Array<Record<string, unknown>> | null>;
  resource_attributes: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  created_at: Generated<Timestamp>;
}

// ============================================================================
// CONTINUOUS AGGREGATES (TimescaleDB Materialized Views)
// ============================================================================
// These are pre-computed aggregations for fast dashboard queries

export interface LogsHourlyStatsTable {
  bucket: Timestamp;
  project_id: string | null;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  service: string;
  log_count: number;
}

export interface LogsDailyStatsTable {
  bucket: Timestamp;
  project_id: string | null;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  service: string;
  log_count: number;
}

// Checklist items state stored as JSON: { "item-id": true, ... }
export type ChecklistItemsState = Record<string, boolean>;

export interface UserOnboardingTable {
  id: Generated<string>;
  user_id: string;
  checklist_items: ColumnType<ChecklistItemsState, ChecklistItemsState, ChecklistItemsState>;
  checklist_collapsed: Generated<boolean>;
  checklist_dismissed: Generated<boolean>;
  tutorial_completed: Generated<boolean>;
  tutorial_step: Generated<number>;
  tutorial_skipped: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ============================================================================
// SIEM TABLES (Security Incident & Event Management)
// ============================================================================

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'false_positive';

export interface DetectionEventsTable {
  time: Timestamp;
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  sigma_rule_id: string;
  log_id: string;
  severity: Severity;
  rule_title: string;
  rule_description: string | null;
  mitre_tactics: string[] | null;
  mitre_techniques: string[] | null;
  service: string;
  log_level: string;
  log_message: string;
  trace_id: string | null;
  matched_fields: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  incident_id: string | null;
}

export interface IncidentsTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  severity: Severity;
  status: Generated<IncidentStatus>;
  assignee_id: string | null;
  trace_id: string | null;
  time_window_start: Timestamp | null;
  time_window_end: Timestamp | null;
  detection_count: Generated<number>;
  affected_services: string[] | null;
  mitre_tactics: string[] | null;
  mitre_techniques: string[] | null;
  ip_reputation: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  geo_data: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  resolved_at: Timestamp | null;
}

export interface IncidentAlertsTable {
  id: Generated<string>;
  incident_id: string;
  detection_event_id: string | null;
  alert_history_id: string | null;
  added_at: Generated<Timestamp>;
}

export interface IncidentCommentsTable {
  id: Generated<string>;
  incident_id: string;
  user_id: string;
  comment: string;
  edited: Generated<boolean>;
  edited_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface IncidentHistoryTable {
  id: Generated<string>;
  incident_id: string;
  user_id: string | null;  // Nullable: trigger might not find user context
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  created_at: Generated<Timestamp>;
}

// ============================================================================
// EXTERNAL AUTHENTICATION TABLES (LDAP/OIDC)
// ============================================================================

export type AuthProviderType = 'local' | 'oidc' | 'ldap';

export interface AuthProvidersTable {
  id: Generated<string>;
  type: AuthProviderType;
  name: string;
  slug: string;
  enabled: Generated<boolean>;
  is_default: Generated<boolean>;
  display_order: Generated<number>;
  icon: string | null;
  config: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UserIdentitiesTable {
  id: Generated<string>;
  user_id: string;
  provider_id: string;
  provider_user_id: string;
  metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  last_login_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface OidcStatesTable {
  id: Generated<string>;
  state: string;
  nonce: string;
  code_verifier: string; // PKCE code verifier for token exchange
  provider_id: string;
  redirect_uri: string; // Required for OIDC token exchange
  created_at: Generated<Timestamp>;
}

// ============================================================================
// SYSTEM SETTINGS TABLE
// ============================================================================

export interface SystemSettingsTable {
  key: string;
  value: ColumnType<unknown, unknown, unknown>; // JSONB - can be any JSON value
  description: string | null;
  updated_at: Generated<Timestamp>;
  updated_by: string | null;
}

export interface Database {
  logs: LogsTable;
  users: UsersTable;
  sessions: SessionsTable;
  organizations: OrganizationsTable;
  organization_members: OrganizationMembersTable;
  organization_invitations: OrganizationInvitationsTable;
  projects: ProjectsTable;
  api_keys: ApiKeysTable;
  alert_rules: AlertRulesTable;
  alert_history: AlertHistoryTable;
  notifications: NotificationsTable;
  sigma_rules: SigmaRulesTable;
  traces: TracesTable;
  spans: SpansTable;
  user_onboarding: UserOnboardingTable;
  // SIEM tables
  detection_events: DetectionEventsTable;
  incidents: IncidentsTable;
  incident_alerts: IncidentAlertsTable;
  incident_comments: IncidentCommentsTable;
  incident_history: IncidentHistoryTable;
  // Continuous aggregates (TimescaleDB materialized views)
  logs_hourly_stats: LogsHourlyStatsTable;
  logs_daily_stats: LogsDailyStatsTable;
  // External authentication tables
  auth_providers: AuthProvidersTable;
  user_identities: UserIdentitiesTable;
  oidc_states: OidcStatesTable;
  // System settings
  system_settings: SystemSettingsTable;
}
