import { request } from './monitoring';

// ---------------------------------------------------------------------------
// Status page config, components and subscribers (admin)
// ---------------------------------------------------------------------------

export interface StatusPageConfig {
  title: string | null;
  description: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  showMonitorTypes: boolean;
}

export interface StatusPageConfigResponse {
  config: StatusPageConfig;
  subscriptionsAvailable: boolean;
}

export interface StatusPageComponentInput {
  monitorId: string;
  displayName: string | null;
  groupName: string | null;
  order: number;
}

export interface StatusSubscriber {
  id: string;
  email: string;
  confirmedAt: string | null;
  createdAt: string;
}

function scopeParams(organizationId: string, projectId: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ organizationId, projectId, ...extra });
}

export async function getStatusPageConfig(
  organizationId: string,
  projectId: string
): Promise<StatusPageConfigResponse> {
  return request(`/api/v1/status-page/config?${scopeParams(organizationId, projectId)}`);
}

export async function updateStatusPageConfig(
  organizationId: string,
  projectId: string,
  config: Partial<StatusPageConfig>
): Promise<{ config: StatusPageConfig }> {
  return request('/api/v1/status-page/config', {
    method: 'PUT',
    body: JSON.stringify({ organizationId, projectId, ...config }),
  });
}

export async function updateStatusPageComponents(
  organizationId: string,
  projectId: string,
  components: StatusPageComponentInput[]
): Promise<{ ok: boolean }> {
  return request('/api/v1/status-page/components', {
    method: 'PUT',
    body: JSON.stringify({ organizationId, projectId, components }),
  });
}

export async function listStatusSubscribers(
  organizationId: string,
  projectId: string,
  page = 1
): Promise<{ subscribers: StatusSubscriber[]; total: number }> {
  return request(
    `/api/v1/status-page/subscribers?${scopeParams(organizationId, projectId, { page: String(page) })}`
  );
}

export async function removeStatusSubscriber(id: string, organizationId: string): Promise<null> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/status-page/subscribers/${id}?${params}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Status updates (the public incidents of the status page)
// ---------------------------------------------------------------------------

export type StatusUpdateSeverity = 'minor' | 'major' | 'critical';
export type StatusUpdateStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface StatusUpdateItem {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  status: StatusUpdateStatus;
  severity: StatusUpdateSeverity;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  monitorIds: string[];
  sourceIncidentId: string | null;
}

export interface CreateStatusUpdateInput {
  organizationId: string;
  projectId: string;
  title: string;
  severity: StatusUpdateSeverity;
  status?: StatusUpdateStatus;
  message?: string;
  monitorIds?: string[];
  sourceIncidentId?: string;
}

export async function listStatusUpdates(
  organizationId: string,
  projectId: string,
  sourceIncidentId?: string
): Promise<{ incidents: StatusUpdateItem[] }> {
  const extra: Record<string, string> = {};
  if (sourceIncidentId) extra.sourceIncidentId = sourceIncidentId;
  return request(`/api/v1/status-incidents?${scopeParams(organizationId, projectId, extra)}`);
}

export async function createStatusUpdate(
  input: CreateStatusUpdateInput
): Promise<{ incident: StatusUpdateItem }> {
  return request('/api/v1/status-incidents', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateStatusUpdate(
  id: string,
  organizationId: string,
  patch: {
    title?: string;
    status?: StatusUpdateStatus;
    severity?: StatusUpdateSeverity;
    monitorIds?: string[];
  }
): Promise<{ incident: StatusUpdateItem }> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/status-incidents/${id}?${params}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function postStatusUpdateMessage(
  id: string,
  organizationId: string,
  body: { status: StatusUpdateStatus; message: string }
): Promise<{ update: { id: string; status: string; message: string; createdAt: string } }> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/status-incidents/${id}/updates?${params}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteStatusUpdate(id: string, organizationId: string): Promise<null> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/status-incidents/${id}?${params}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Maintenances
// ---------------------------------------------------------------------------

export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed';

export interface MaintenanceItem {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: MaintenanceStatus;
  scheduledStart: string;
  scheduledEnd: string;
  autoUpdateStatus: boolean;
  monitorIds: string[];
}

export interface CreateMaintenanceInput {
  organizationId: string;
  projectId: string;
  title: string;
  description?: string;
  scheduledStart: string;
  scheduledEnd: string;
  autoUpdateStatus?: boolean;
  monitorIds?: string[];
}

export async function listMaintenances(
  organizationId: string,
  projectId: string
): Promise<{ maintenances: MaintenanceItem[] }> {
  return request(`/api/v1/maintenances?${scopeParams(organizationId, projectId)}`);
}

export async function createMaintenance(
  input: CreateMaintenanceInput
): Promise<{ maintenance: MaintenanceItem }> {
  return request('/api/v1/maintenances', { method: 'POST', body: JSON.stringify(input) });
}

export async function deleteMaintenance(id: string, organizationId: string): Promise<null> {
  const params = new URLSearchParams({ organizationId });
  return request(`/api/v1/maintenances/${id}?${params}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Public status page and email subscriptions (no admin role needed)
// ---------------------------------------------------------------------------

export interface PublicUpdate {
  id: string;
  status: string;
  message: string;
  createdAt: string;
}

export interface PublicStatusIncident {
  id: string;
  title: string;
  status: string;
  severity: string;
  createdAt: string;
  resolvedAt: string | null;
  updates: PublicUpdate[];
  affectedComponents: string[];
}

export interface PublicMaintenance {
  id: string;
  title: string;
  description: string | null;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  affectedComponents: string[];
}

export interface PublicMonitorStatus {
  name: string;
  type?: string;
  groupName: string | null;
  status: 'up' | 'down' | 'unknown';
  uptimeHistory: { bucket: string; uptimePct: number | string; totalChecks: number }[];
}

export interface PublicStatusPage {
  projectName: string;
  projectSlug: string;
  title: string | null;
  description: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  showMonitorTypes: boolean;
  subscriptionsEnabled: boolean;
  historyDays: number;
  overallStatus: 'operational' | 'degraded' | 'outage';
  monitors: PublicMonitorStatus[];
  activeIncidents: PublicStatusIncident[];
  recentIncidents: PublicStatusIncident[];
  activeMaintenances: PublicMaintenance[];
  upcomingMaintenances: PublicMaintenance[];
  lastUpdated: string;
}

function publicPath(orgSlug: string, projectSlug: string, suffix = ''): string {
  return `/api/v1/status/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}${suffix}`;
}

export async function getPublicStatus(
  orgSlug: string,
  projectSlug: string,
  password?: string
): Promise<PublicStatusPage> {
  return request(publicPath(orgSlug, projectSlug), {
    headers: password ? { 'x-status-password': password } : undefined,
  });
}

export async function subscribeToStatusPage(
  orgSlug: string,
  projectSlug: string,
  email: string
): Promise<{ ok: boolean }> {
  return request(publicPath(orgSlug, projectSlug, '/subscribe'), {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function confirmStatusSubscription(
  orgSlug: string,
  projectSlug: string,
  token: string
): Promise<{ ok: boolean }> {
  return request(publicPath(orgSlug, projectSlug, '/subscribe/confirm'), {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function unsubscribeFromStatusPage(
  orgSlug: string,
  projectSlug: string,
  token: string
): Promise<{ ok: boolean }> {
  return request(publicPath(orgSlug, projectSlug, '/unsubscribe'), {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}
