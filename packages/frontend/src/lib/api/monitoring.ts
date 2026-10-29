import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type MonitorType = 'http' | 'tcp' | 'heartbeat' | 'log_heartbeat' | 'ssl' | 'dns';
export type MonitorStatus = 'up' | 'down' | 'unknown';

export interface HttpConfig {
  method?: string;
  expectedStatus?: number;
  headers?: Record<string, string>;
  bodyAssertion?: { type: 'contains'; value: string } | { type: 'regex'; pattern: string };
}

export interface SslCheckConfig {
  warnDays: number;
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT';

export interface DnsCheckConfig {
  recordType: DnsRecordType;
  expectedValue?: string;
}

export type CheckConfig = SslCheckConfig | DnsCheckConfig;

export type MonitorSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export interface MonitorDetail {
  /** ssl */
  expiresAt?: string;
  daysRemaining?: number;
  issuer?: string;
  subject?: string;
  /** dns */
  records?: string[];
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
  severity: MonitorSeverity;
  displayName: string | null;
  groupName: string | null;
  displayOrder: number;
  checkConfig: CheckConfig | null;
  createdAt: string;
  updatedAt: string;
  status?: {
    monitorId: string;
    status: MonitorStatus;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    lastCheckedAt: string | null;
    lastStatusChangeAt: string | null;
    responseTimeMs: number | null;
    lastErrorCode: string | null;
    incidentId: string | null;
    detail: MonitorDetail | null;
    updatedAt: string;
  };
}

export interface MonitorResult {
  time: string;
  id: string;
  monitorId: string;
  status: 'up' | 'down';
  responseTimeMs: number | null;
  statusCode: number | null;
  errorCode: string | null;
  isHeartbeat: boolean;
}

export interface UptimeBucket {
  bucket: string;
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
  checkConfig?: CheckConfig | null;
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
  checkConfig?: CheckConfig | null;
}

export type UptimeWindowKey = '24h' | '7d' | '30d' | '90d';

export interface UptimeWindow {
  /** Null when the window has no data: show a dash, never 0% or 100%. */
  uptimePct: number | null;
  totalChecks: number;
}

export interface UptimeSummary {
  windows: Record<UptimeWindowKey, UptimeWindow>;
}

export type ResponseTimeRange = '24h' | '7d' | '30d';

export interface ResponseTimePoint {
  time: string;
  avgMs: number | null;
  p95Ms: number | null;
  failures: number;
}

export interface ResponseTimes {
  bucketSeconds: number;
  points: ResponseTimePoint[];
}

export interface MonitorOutage {
  incidentId: string;
  title: string;
  status: string;
  severity: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
}

export interface MonitorChannel {
  id: string;
  name?: string;
  type?: string;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), {
      status: response.status,
    });
  }

  if (response.status === 204) return null as T;
  return response.json();
}

export async function listMonitors(
  organizationId: string,
  projectId?: string
): Promise<{ monitors: Monitor[] }> {
  const params = new URLSearchParams({ organizationId });
  if (projectId) params.append('projectId', projectId);
  return request(`/api/v1/monitors?${params}`);
}

export async function getMonitor(
  id: string,
  organizationId: string
): Promise<{ monitor: Monitor }> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/monitors/${id}?${params}`);
}

export async function createMonitor(input: CreateMonitorInput): Promise<{ monitor: Monitor }> {
  return request('/api/v1/monitors', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateMonitor(
  id: string,
  organizationId: string,
  input: UpdateMonitorInput
): Promise<{ monitor: Monitor }> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/monitors/${id}?${params}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteMonitor(id: string, organizationId: string): Promise<null> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/monitors/${id}?${params}`, { method: 'DELETE' });
}

export async function getMonitorResults(
  id: string,
  organizationId: string,
  limit = 50
): Promise<{ results: MonitorResult[] }> {
  const params = new URLSearchParams({ organizationId, limit: String(limit) });
  return request(`/api/v1/monitors/${id}/results?${params}`);
}

export async function getMonitorUptime(
  id: string,
  organizationId: string,
  days = 90
): Promise<{ history: UptimeBucket[] }> {
  const params = new URLSearchParams({ organizationId, days: String(days) });
  return request(`/api/v1/monitors/${id}/uptime?${params}`);
}

export async function getMonitorUptimeSummary(
  id: string,
  organizationId: string
): Promise<UptimeSummary> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/monitors/${id}/uptime-summary?${params}`);
}

export async function getMonitorResponseTimes(
  id: string,
  organizationId: string,
  range: ResponseTimeRange = '24h'
): Promise<ResponseTimes> {
  const params = new URLSearchParams({ organizationId, range });
  return request(`/api/v1/monitors/${id}/response-times?${params}`);
}

export async function getMonitorOutages(
  id: string,
  organizationId: string,
  limit = 20
): Promise<{ outages: MonitorOutage[] }> {
  const params = new URLSearchParams({ organizationId, limit: String(limit) });
  return request(`/api/v1/monitors/${id}/outages?${params}`);
}

export async function getMonitorChannels(
  id: string,
  organizationId: string
): Promise<{ channels: MonitorChannel[] }> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/monitors/${id}/channels?${params}`);
}

export async function setMonitorChannels(
  id: string,
  organizationId: string,
  channelIds: string[]
): Promise<null> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/monitors/${id}/channels?${params}`, {
    method: 'PUT',
    body: JSON.stringify({ channelIds }),
  });
}
