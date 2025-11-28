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
  password_hash: string;
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
  role: string;
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

export interface Database {
  logs: LogsTable;
  users: UsersTable;
  sessions: SessionsTable;
  organizations: OrganizationsTable;
  organization_members: OrganizationMembersTable;
  projects: ProjectsTable;
  api_keys: ApiKeysTable;
  alert_rules: AlertRulesTable;
  alert_history: AlertHistoryTable;
  notifications: NotificationsTable;
  sigma_rules: SigmaRulesTable;
  traces: TracesTable;
  spans: SpansTable;
}
