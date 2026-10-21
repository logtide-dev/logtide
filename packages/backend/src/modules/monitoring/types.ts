import type { MonitorType, MonitorStatusValue, MonitorHttpConfig } from '../../database/types.js';
import type { Severity } from '@logtide/shared';

export type { MonitorType, MonitorStatusValue, MonitorHttpConfig };

export type ErrorCode =
  | 'timeout'
  | 'dns_error'
  | 'connection_refused'
  | 'ssl_error'
  | 'http_error'
  | 'no_heartbeat'
  | 'blocked'
  | 'cert_expiring'
  | 'cert_expired'
  | 'dns_mismatch'
  | 'dns_no_records'
  | 'unexpected';

// Alias for the database JSONB shape - single source of truth in database/types.ts
export type HttpConfig = MonitorHttpConfig;

export interface CheckResult {
  status: 'up' | 'down';
  responseTimeMs: number | null;
  statusCode: number | null;
  errorCode: ErrorCode | null;
  /** Last-check facts (ssl certificate, dns records), stored in monitor_status.detail. */
  detail?: Record<string, unknown>;
}

export interface SslCheckConfig {
  /** Down when fewer than this many days remain on the certificate. */
  warnDays: number;
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT';

export interface DnsCheckConfig {
  recordType: DnsRecordType;
  expectedValue?: string;
}

export interface Monitor {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  type: MonitorType;
  target: string | null;
  intervalSeconds: number;
  timeoutSeconds: number;
  gracePeriodSeconds: number | null;
  failureThreshold: number;
  autoResolve: boolean;
  enabled: boolean;
  httpConfig: HttpConfig | null;
  severity: Severity;
  displayName: string | null;
  groupName: string | null;
  displayOrder: number;
  checkConfig: SslCheckConfig | DnsCheckConfig | null;
  status?: MonitorCurrentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonitorCurrentStatus {
  monitorId: string;
  status: MonitorStatusValue;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: Date | null;
  lastStatusChangeAt: Date | null;
  responseTimeMs: number | null;
  lastErrorCode: string | null;
  incidentId: string | null;
  /** Last-check facts: ssl certificate or dns records. Null when the last check had none. */
  detail: Record<string, unknown> | null;
  updatedAt: Date;
}

export interface MonitorResult {
  time: Date;
  id: string;
  monitorId: string;
  status: 'up' | 'down';
  responseTimeMs: number | null;
  statusCode: number | null;
  errorCode: string | null;
  isHeartbeat: boolean;
}

export interface UptimeBucket {
  bucket: Date;
  monitorId: string;
  totalChecks: number;
  successfulChecks: number;
  uptimePct: number;
}

export interface CreateMonitorInput {
  organizationId: string;
  projectId: string;
  name: string;
  type: MonitorType;
  target?: string | null;
  intervalSeconds?: number;
  timeoutSeconds?: number;
  gracePeriodSeconds?: number | null;
  failureThreshold?: number;
  autoResolve?: boolean;
  enabled?: boolean;
  httpConfig?: HttpConfig | null;
  severity?: string;
  displayName?: string | null;
  groupName?: string | null;
  displayOrder?: number;
  checkConfig?: SslCheckConfig | DnsCheckConfig | null;
}

export interface UpdateMonitorInput {
  name?: string;
  target?: string | null;
  intervalSeconds?: number;
  timeoutSeconds?: number;
  gracePeriodSeconds?: number | null;
  failureThreshold?: number;
  autoResolve?: boolean;
  enabled?: boolean;
  httpConfig?: HttpConfig | null;
  severity?: string;
  displayName?: string | null;
  groupName?: string | null;
  displayOrder?: number;
  checkConfig?: SslCheckConfig | DnsCheckConfig | null;
}

export interface PublicMonitorStatus {
  name: string;
  type: MonitorType;
  status: MonitorStatusValue;
  uptimeHistory: { bucket: string; uptimePct: number }[];
}

export interface PublicStatusIncident {
  id: string;
  title: string;
  status: string;
  severity: string;
  createdAt: string;
  resolvedAt: string | null;
  updates: { id: string; status: string; message: string; createdAt: string }[];
}

export interface PublicMaintenance {
  id: string;
  title: string;
  description: string | null;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
}

export interface PublicStatusPage {
  projectName: string;
  projectSlug: string;
  overallStatus: 'operational' | 'degraded' | 'outage';
  monitors: PublicMonitorStatus[];
  activeIncidents: PublicStatusIncident[];
  recentIncidents: PublicStatusIncident[];
  activeMaintenances: PublicMaintenance[];
  upcomingMaintenances: PublicMaintenance[];
  lastUpdated: string;
}
