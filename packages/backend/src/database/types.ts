import type { ColumnType } from 'kysely';
import type {
  LogLevel,
  OrgRole,
  SpanKind,
  SpanStatusCode,
  AuthProviderType,
  NotificationType,
  SigmaLevel,
  Severity,
  IncidentStatus,
  ExceptionLanguage,
  ErrorGroupStatus,
  NotificationChannelType,
  NotificationEventType,
  ChannelConfig,
  PackCategory,
  ApiKeyType,
  PanelInstance,
} from '@logtide/shared';

// Re-export types for backward compatibility (modules importing from database/types)
export type {
  LogLevel,
  OrgRole,
  SpanKind,
  SpanStatusCode,
  AuthProviderType,
  NotificationType,
  SigmaLevel,
  Severity,
  IncidentStatus,
  ExceptionLanguage,
  ErrorGroupStatus,
  NotificationChannelType,
  NotificationEventType,
  ChannelConfig,
  PackCategory,
  ApiKeyType,
} from '@logtide/shared';

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface LogsTable {
  id: Generated<string>;
  time: Timestamp;
  project_id: string | null;
  service: string;
  level: LogLevel;
  message: string;
  metadata: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | null,
    Record<string, unknown> | null
  >;
  trace_id: string | null;
  span_id: string | null;
  session_id: string | null;
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
  retention_days: Generated<number>; // 1-365 days, default 90
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface OrganizationMembersTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: Generated<Timestamp>;
}

export interface OrganizationInvitationsTable {
  id: Generated<string>;
  organization_id: string;
  email: string;
  role: OrgRole;
  token: string;
  invited_by: string;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export type StatusPageVisibility = 'disabled' | 'public' | 'password' | 'members_only';

export interface ProjectsTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string; // Keep for tracking who created the project
  name: string;
  slug: string;
  description: string | null;
  status_page_visibility: Generated<StatusPageVisibility>;
  status_page_password_hash: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ApiKeysTable {
  id: Generated<string>;
  project_id: string;
  name: string;
  key_hash: string;
  type: Generated<ApiKeyType>;
  allowed_origins: string[] | null;
  created_at: Generated<Timestamp>;
  last_used: Timestamp | null;
  revoked: Generated<boolean>;
}

export type AlertType = 'threshold' | 'rate_of_change';
export type BaselineType = 'same_time_yesterday' | 'same_day_last_week' | 'rolling_7d_avg' | 'percentile_p95';

export interface BaselineMetadata {
  baseline_value: number;
  current_value: number;
  deviation_ratio: number;
  baseline_type: BaselineType;
  evaluation_time: string;
}

export interface AlertRulesTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  name: string;
  enabled: Generated<boolean>;
  service: string | null;
  level: LogLevel[];
  threshold: number;
  time_window: number;
  alert_type: Generated<AlertType>;
  baseline_type: BaselineType | null;
  deviation_multiplier: number | null;
  min_baseline_value: number | null;
  cooldown_minutes: number | null;
  sustained_minutes: number | null;
  email_recipients: string[];
  webhook_url: string | null;
  metadata: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | null,
    Record<string, unknown> | null
  >;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface AlertHistoryTable {
  id: Generated<string>;
  rule_id: string;
  triggered_at: Timestamp;
  log_count: number;
  baseline_metadata: ColumnType<BaselineMetadata | null, BaselineMetadata | null, BaselineMetadata | null>;
  notified: Generated<boolean>;
  error: string | null;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: Generated<boolean>;
  organization_id: string | null;
  project_id: string | null;
  metadata: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | null,
    Record<string, unknown> | null
  >;
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
  // Detection routing category
  category: Generated<PackCategory>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// SpanKind and SpanStatusCode are imported from @logtide/shared

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
  level: LogLevel;
  service: string;
  log_count: number;
}

export interface LogsDailyStatsTable {
  bucket: Timestamp;
  project_id: string | null;
  level: LogLevel;
  service: string;
  log_count: number;
}

// ============================================================================
// SPANS CONTINUOUS AGGREGATES
// ============================================================================

export interface SpansHourlyStatsTable {
  bucket: Timestamp;
  project_id: string;
  service_name: string;
  span_count: number;
  duration_p50_ms: number | null;
  duration_p95_ms: number | null;
  duration_p99_ms: number | null;
  duration_min_ms: number | null;
  duration_max_ms: number | null;
  duration_avg_ms: number | null;
  error_rate: number | null; // 0.0 to 1.0
  error_count: number | null;
}

export interface SpansDailyStatsTable {
  bucket: Timestamp;
  project_id: string;
  service_name: string;
  span_count: number;
  duration_p50_ms: number | null;
  duration_p95_ms: number | null;
  duration_p99_ms: number | null;
  duration_min_ms: number | null;
  duration_max_ms: number | null;
  duration_avg_ms: number | null;
  error_rate: number | null;
  error_count: number | null;
}

// ============================================================================
// DETECTION EVENTS CONTINUOUS AGGREGATES (SIEM Dashboard)
// ============================================================================

export interface DetectionEventsHourlyStatsTable {
  bucket: Timestamp;
  organization_id: string;
  project_id: string | null;
  severity: Severity;
  sigma_rule_id: string;
  rule_title: string;
  service: string;
  detection_count: number;
}

export interface DetectionEventsDailyStatsTable {
  bucket: Timestamp;
  organization_id: string;
  project_id: string | null;
  severity: Severity;
  detection_count: number;
}

export interface DetectionEventsRuleStatsTable {
  date: Timestamp;
  organization_id: string;
  project_id: string | null;
  sigma_rule_id: string;
  rule_title: string;
  severity: Severity;
  detection_count: number;
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

// Severity and IncidentStatus are imported from @logtide/shared

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
  category: Generated<PackCategory>;
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
  source: Generated<string>;
  monitor_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  resolved_at: Timestamp | null;
}

// ============================================================================
// SERVICE HEALTH MONITORING TABLES
// ============================================================================

export type MonitorType = 'http' | 'tcp' | 'heartbeat' | 'log_heartbeat';
export type MonitorStatusValue = 'up' | 'down' | 'unknown';

export interface MonitorHttpConfig {
  method?: string;
  expectedStatus?: number;
  headers?: Record<string, string>;
  bodyAssertion?: { type: 'contains'; value: string } | { type: 'regex'; pattern: string };
}

export interface MonitorsTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string;
  name: string;
  type: MonitorType;
  target: string | null;
  interval_seconds: Generated<number>;
  timeout_seconds: Generated<number>;
  failure_threshold: Generated<number>;
  auto_resolve: Generated<boolean>;
  enabled: Generated<boolean>;
  http_config: MonitorHttpConfig | null;
  severity: Generated<string>;
  grace_period_seconds: number | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface MonitorStatusTable {
  monitor_id: string;
  status: Generated<MonitorStatusValue>;
  consecutive_failures: Generated<number>;
  consecutive_successes: Generated<number>;
  last_checked_at: Timestamp | null;
  last_status_change_at: Timestamp | null;
  response_time_ms: number | null;
  last_error_code: string | null;
  incident_id: string | null;
  updated_at: Generated<Timestamp>;
}

export interface MonitorResultsTable {
  time: Timestamp;
  id: Generated<string>;
  monitor_id: string;
  organization_id: string;
  project_id: string;
  status: 'up' | 'down';
  response_time_ms: number | null;
  status_code: number | null;
  error_code: string | null;
  is_heartbeat: Generated<boolean>;
}

export interface MonitorUptimeDailyTable {
  bucket: Timestamp;
  monitor_id: string;
  organization_id: string;
  project_id: string;
  total_checks: number;
  successful_checks: number;
  uptime_pct: number | null;
}

// ============================================================================
// STATUS PAGE INCIDENTS
// ============================================================================

export type StatusIncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export type StatusIncidentSeverity = 'minor' | 'major' | 'critical';

export interface StatusIncidentsTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string;
  title: string;
  status: Generated<StatusIncidentStatus>;
  severity: Generated<StatusIncidentSeverity>;
  created_by: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  resolved_at: Timestamp | null;
}

export interface StatusIncidentUpdatesTable {
  id: Generated<string>;
  incident_id: string;
  status: StatusIncidentStatus;
  message: string;
  created_by: string | null;
  created_at: Generated<Timestamp>;
}

// ============================================================================
// SCHEDULED MAINTENANCES
// ============================================================================

export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed';

export interface ScheduledMaintenancesTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: Generated<MaintenanceStatus>;
  scheduled_start: Timestamp;
  scheduled_end: Timestamp;
  actual_start: Timestamp | null;
  actual_end: Timestamp | null;
  auto_update_status: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
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
// EXCEPTION TRACKING TABLES
// ============================================================================

// ExceptionLanguage and ErrorGroupStatus are imported from @logtide/shared

export interface ExceptionsTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  log_id: string;
  exception_type: string;
  exception_message: string | null;
  language: ExceptionLanguage;
  fingerprint: string;
  raw_stack_trace: string;
  frame_count: number;
  created_at: Generated<Timestamp>;
}

export interface StackFramesTable {
  id: Generated<string>;
  exception_id: string;
  frame_index: number;
  file_path: string;
  function_name: string | null;
  line_number: number | null;
  column_number: number | null;
  is_app_code: boolean;
  code_context: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  original_file: string | null;
  original_line: number | null;
  original_column: number | null;
  original_function: string | null;
  created_at: Generated<Timestamp>;
}

export interface SourceMapsTable {
  id: Generated<string>;
  project_id: string;
  organization_id: string;
  release: string;
  file_name: string;
  file_size: number;
  storage_path: string;
  uploaded_at: Generated<Timestamp>;
}

export interface ErrorGroupsTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  fingerprint: string;
  exception_type: string;
  exception_message: string | null;
  language: ExceptionLanguage;
  occurrence_count: number;
  first_seen: Timestamp;
  last_seen: Timestamp;
  status: Generated<ErrorGroupStatus>;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  affected_services: string[] | null;
  sample_log_id: string | null;
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

// ============================================================================
// EXTERNAL AUTHENTICATION TABLES (LDAP/OIDC)
// ============================================================================

// AuthProviderType is imported from @logtide/shared

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

// ============================================================================
// DETECTION PACKS TABLE
// ============================================================================

// Type for custom thresholds in detection packs (Sigma-based)
type PackThresholdOverride = { level?: SigmaLevel; emailEnabled?: boolean; webhookEnabled?: boolean };
type PackThresholdMap = Record<string, PackThresholdOverride> | null;

export interface DetectionPackActivationsTable {
  id: Generated<string>;
  organization_id: string;
  pack_id: string;
  enabled: Generated<boolean>;
  custom_thresholds: ColumnType<PackThresholdMap, PackThresholdMap, PackThresholdMap>;
  activated_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ============================================================================
// LOG IDENTIFIERS TABLE (Event Correlation)
// ============================================================================

export interface LogIdentifiersTable {
  // Note: This table is a TimescaleDB hypertable without a UUID primary key
  // (converted in migration 018 for performance)
  log_time: Timestamp;
  log_id: string;
  project_id: string;
  organization_id: string;
  identifier_type: string;
  identifier_value: string;
  source_field: string;
  created_at: Generated<Timestamp>;
}

export interface IdentifierPatternsTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  display_name: string;
  description: string | null;
  pattern: string;
  field_names: string[];
  enabled: Generated<boolean>;
  priority: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ============================================================================
// NOTIFICATION CHANNELS TABLES
// ============================================================================

export interface NotificationChannelsTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  type: NotificationChannelType;
  enabled: Generated<boolean>;
  config: ColumnType<ChannelConfig, ChannelConfig, ChannelConfig>;
  description: string | null;
  created_by: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface AlertRuleChannelsTable {
  id: Generated<string>;
  alert_rule_id: string;
  channel_id: string;
  created_at: Generated<Timestamp>;
}

export interface SigmaRuleChannelsTable {
  id: Generated<string>;
  sigma_rule_id: string;
  channel_id: string;
  created_at: Generated<Timestamp>;
}

export interface MonitorChannelsTable {
  id: Generated<string>;
  monitor_id: string;
  channel_id: string;
  created_at: Generated<Timestamp>;
}

export interface IncidentChannelsTable {
  id: Generated<string>;
  incident_id: string;
  channel_id: string;
  created_at: Generated<Timestamp>;
}

export interface ErrorGroupChannelsTable {
  id: Generated<string>;
  error_group_id: string;
  channel_id: string;
  created_at: Generated<Timestamp>;
}

export interface OrganizationDefaultChannelsTable {
  id: Generated<string>;
  organization_id: string;
  event_type: NotificationEventType;
  channel_id: string;
  created_at: Generated<Timestamp>;
}

// ============================================================================
// PII MASKING TABLES
// ============================================================================

export type PiiPatternType = 'builtin' | 'field_name' | 'custom';
export type PiiAction = 'mask' | 'redact' | 'hash';

export interface PiiMaskingRulesTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  name: string;
  display_name: string;
  description: string | null;
  pattern_type: PiiPatternType;
  regex_pattern: string | null;
  field_names: string[];
  action: PiiAction;
  enabled: Generated<boolean>;
  priority: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface OrganizationPiiSaltsTable {
  organization_id: string;
  salt: string;
  created_at: Generated<Timestamp>;
}

// ============================================================================
// AUDIT LOG TABLE
// ============================================================================

export type AuditCategory =
  | 'log_access'
  | 'config_change'
  | 'user_management'
  | 'data_modification';

export interface AuditLogTable {
  time: Generated<Timestamp>;
  id: Generated<string>;
  organization_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action: string;
  category: AuditCategory;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | null,
    Record<string, unknown> | null
  >;
}

// ============================================================================
// METRICS TABLES (OTLP Metrics Ingestion)
// ============================================================================

// ============================================================================
// METRICS CONTINUOUS AGGREGATES
// ============================================================================

export interface MetricsHourlyStatsTable {
  bucket: Timestamp;
  project_id: string;
  metric_name: string;
  metric_type: string;
  service_name: string;
  point_count: number;
  avg_value: number | null;
  sum_value: number | null;
  min_value: number | null;
  max_value: number | null;
}

export interface MetricsDailyStatsTable {
  bucket: Timestamp;
  project_id: string;
  metric_name: string;
  metric_type: string;
  service_name: string;
  point_count: number;
  avg_value: number | null;
  sum_value: number | null;
  min_value: number | null;
  max_value: number | null;
}

export interface MetricsTable {
  time: Timestamp;
  id: Generated<string>;
  organization_id: string;
  project_id: string;
  metric_name: string;
  metric_type: string;
  value: number;
  is_monotonic: boolean | null;
  service_name: string;
  attributes: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  resource_attributes: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  histogram_data: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  has_exemplars: boolean;
}

export interface MetricExemplarsTable {
  time: Timestamp;
  id: Generated<string>;
  metric_id: string;
  organization_id: string;
  project_id: string;
  exemplar_value: number;
  exemplar_time: Timestamp | null;
  trace_id: string | null;
  span_id: string | null;
  attributes: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
}

// ============================================================================
// CUSTOM DASHBOARDS TABLE
// ============================================================================

export interface CustomDashboardsTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  created_by: string | null;
  name: string;
  description: string | null;
  is_default: Generated<boolean>;
  is_personal: Generated<boolean>;
  schema_version: Generated<number>;
  panels: ColumnType<PanelInstance[], PanelInstance[] | string, PanelInstance[] | string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ============================================================================
// LOG PIPELINES TABLE
// ============================================================================

export interface LogPipelinesTable {
  id: Generated<string>;
  organization_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  enabled: Generated<boolean>;
  steps: ColumnType<
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[]
  >;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
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
  spans_hourly_stats: SpansHourlyStatsTable;
  spans_daily_stats: SpansDailyStatsTable;
  detection_events_hourly_stats: DetectionEventsHourlyStatsTable;
  detection_events_daily_stats: DetectionEventsDailyStatsTable;
  detection_events_rule_stats: DetectionEventsRuleStatsTable;
  metrics_hourly_stats: MetricsHourlyStatsTable;
  metrics_daily_stats: MetricsDailyStatsTable;
  // Exception tracking tables
  exceptions: ExceptionsTable;
  stack_frames: StackFramesTable;
  error_groups: ErrorGroupsTable;
  // External authentication tables
  auth_providers: AuthProvidersTable;
  user_identities: UserIdentitiesTable;
  oidc_states: OidcStatesTable;
  // System settings
  system_settings: SystemSettingsTable;
  // Detection packs
  detection_pack_activations: DetectionPackActivationsTable;
  // Event correlation
  log_identifiers: LogIdentifiersTable;
  identifier_patterns: IdentifierPatternsTable;
  // Notification channels
  notification_channels: NotificationChannelsTable;
  alert_rule_channels: AlertRuleChannelsTable;
  sigma_rule_channels: SigmaRuleChannelsTable;
  incident_channels: IncidentChannelsTable;
  error_group_channels: ErrorGroupChannelsTable;
  organization_default_channels: OrganizationDefaultChannelsTable;
  monitor_channels: MonitorChannelsTable;
  // PII masking
  pii_masking_rules: PiiMaskingRulesTable;
  organization_pii_salts: OrganizationPiiSaltsTable;
  // Audit log
  audit_log: AuditLogTable;
  // Source maps
  sourcemaps: SourceMapsTable;
  // Metrics (OTLP)
  metrics: MetricsTable;
  metric_exemplars: MetricExemplarsTable;
  // Log pipelines
  log_pipelines: LogPipelinesTable;
  // Custom dashboards
  custom_dashboards: CustomDashboardsTable;
  // Service health monitoring
  monitors: MonitorsTable;
  monitor_status: MonitorStatusTable;
  monitor_results: MonitorResultsTable;
  monitor_uptime_daily: MonitorUptimeDailyTable;
  // Status page incidents & maintenances
  status_incidents: StatusIncidentsTable;
  status_incident_updates: StatusIncidentUpdatesTable;
  scheduled_maintenances: ScheduledMaintenancesTable;
}
