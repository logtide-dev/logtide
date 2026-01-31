import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type {
  Severity,
  IncidentStatus,
  DetectionEvent,
  Incident,
  IncidentComment,
  IncidentHistoryEntry,
  TopThreat,
  TimelineBucket,
  AffectedService,
  SeverityDistribution,
  MitreHeatmapCell,
  DashboardStats,
  DashboardFilters,
  IncidentFilters,
  IpReputationData,
  GeoIpData,
} from '@logtide/shared';

import type {
  Severity,
  IncidentStatus,
  DetectionEvent,
  Incident,
  IncidentComment,
  IncidentHistoryEntry,
  DashboardStats,
  IncidentFilters,
  IpReputationData,
  GeoIpData,
} from '@logtide/shared';

export interface CreateIncidentParams {
  organizationId: string;
  projectId?: string;
  title: string;
  description?: string;
  severity: Severity;
  status?: IncidentStatus;
  assigneeId?: string;
  traceId?: string;
  detectionEventIds?: string[];
}

export interface UpdateIncidentParams {
  organizationId: string;
  title?: string;
  description?: string;
  severity?: Severity;
  status?: IncidentStatus;
  assigneeId?: string;
}

export async function getDashboardStats(params: {
  organizationId: string;
  projectId?: string;
  timeRange: '24h' | '7d' | '30d';
  severity?: Severity[];
}): Promise<DashboardStats> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: params.organizationId,
    timeRange: params.timeRange,
  });

  if (params.projectId) {
    searchParams.append('projectId', params.projectId);
  }

  if (params.severity) {
    params.severity.forEach((s) => searchParams.append('severity', s));
  }

  const response = await fetch(`${getApiUrl()}/api/v1/siem/dashboard?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get dashboard stats');
  }

  return response.json();
}

export async function createIncident(params: CreateIncidentParams): Promise<Incident> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/siem/incidents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create incident');
  }

  return response.json();
}

export async function listIncidents(filters: IncidentFilters): Promise<{ incidents: Incident[] }> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: filters.organizationId,
  });

  if (filters.projectId) {
    searchParams.append('projectId', filters.projectId);
  }

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    statuses.forEach((s) => searchParams.append('status', s));
  }

  if (filters.severity) {
    const severities = Array.isArray(filters.severity) ? filters.severity : [filters.severity];
    severities.forEach((s) => searchParams.append('severity', s));
  }

  if (filters.assigneeId) {
    searchParams.append('assigneeId', filters.assigneeId);
  }

  if (filters.service) {
    searchParams.append('service', filters.service);
  }

  if (filters.technique) {
    searchParams.append('technique', filters.technique);
  }

  if (filters.limit) {
    searchParams.append('limit', filters.limit.toString());
  }

  if (filters.offset) {
    searchParams.append('offset', filters.offset.toString());
  }

  const response = await fetch(`${getApiUrl()}/api/v1/siem/incidents?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list incidents');
  }

  return response.json();
}

export async function getIncident(
  incidentId: string,
  organizationId: string
): Promise<{
  incident: Incident;
  detections: DetectionEvent[];
  comments: IncidentComment[];
  history: IncidentHistoryEntry[];
}> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({ organizationId });

  const response = await fetch(
    `${getApiUrl()}/api/v1/siem/incidents/${incidentId}?${searchParams}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get incident');
  }

  return response.json();
}

export async function updateIncident(
  incidentId: string,
  params: UpdateIncidentParams
): Promise<Incident> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/siem/incidents/${incidentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update incident');
  }

  return response.json();
}

export async function deleteIncident(incidentId: string, organizationId: string): Promise<void> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({ organizationId });

  const response = await fetch(
    `${getApiUrl()}/api/v1/siem/incidents/${incidentId}?${searchParams}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete incident');
  }
}

export async function addIncidentComment(
  incidentId: string,
  organizationId: string,
  comment: string
): Promise<IncidentComment> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/siem/incidents/${incidentId}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ comment, organizationId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add comment');
  }

  return response.json();
}

export async function checkIpReputation(ip: string): Promise<IpReputationData> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/siem/enrichment/ip-reputation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ip }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to check IP reputation');
  }

  return response.json();
}

export async function getGeoIpData(ip: string): Promise<GeoIpData> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/siem/enrichment/geoip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ip }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get GeoIP data');
  }

  return response.json();
}

export async function getEnrichmentStatus(): Promise<{
  ipReputation: boolean;
  geoIp: boolean;
}> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/siem/enrichment/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get enrichment status');
  }

  return response.json();
}

export async function getRecentDetections(params: {
  organizationId: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ detections: DetectionEvent[] }> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: params.organizationId,
  });

  if (params.projectId) {
    searchParams.append('projectId', params.projectId);
  }
  if (params.limit) {
    searchParams.append('limit', params.limit.toString());
  }
  if (params.offset) {
    searchParams.append('offset', params.offset.toString());
  }

  const response = await fetch(`${getApiUrl()}/api/v1/siem/detections?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get recent detections');
  }

  return response.json();
}
