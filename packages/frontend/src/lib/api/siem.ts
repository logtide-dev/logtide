import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'false_positive';

export interface DashboardStats {
    topThreats: TopThreat[];
    timeline: TimelineBucket[];
    affectedServices: AffectedService[];
    severityDistribution: SeverityDistribution[];
    mitreHeatmap: MitreHeatmapCell[];
    totalDetections: number;
    totalIncidents: number;
    openIncidents: number;
    criticalIncidents: number;
}

export interface TopThreat {
    ruleId: string;
    ruleTitle: string;
    count: number;
    severity: Severity;
    mitreTactics: string[] | null;
    mitreTechniques: string[] | null;
}

export interface TimelineBucket {
    timestamp: string;
    count: number;
}

export interface AffectedService {
    serviceName: string;
    detectionCount: number;
    incidents: number;
    criticalCount: number;
    highCount: number;
}

export interface SeverityDistribution {
    severity: Severity;
    count: number;
    percentage: number;
}

export interface MitreHeatmapCell {
    technique: string;
    tactic: string;
    count: number;
}

export interface Incident {
    id: string;
    organizationId: string;
    projectId: string | null;
    title: string;
    description: string | null;
    severity: Severity;
    status: IncidentStatus;
    assigneeId: string | null;
    traceId: string | null;
    timeWindowStart: string | null;
    timeWindowEnd: string | null;
    detectionCount: number;
    affectedServices: string[] | null;
    mitreTactics: string[] | null;
    mitreTechniques: string[] | null;
    ipReputation: Record<string, any> | null;
    geoData: Record<string, any> | null;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
}

export interface DetectionEvent {
    id: string;
    time: string;
    organizationId: string;
    projectId: string | null;
    sigmaRuleId: string;
    logId: string;
    severity: Severity;
    ruleTitle: string;
    ruleDescription: string | null;
    mitreTactics: string[] | null;
    mitreTechniques: string[] | null;
    service: string;
    logLevel: string;
    logMessage: string;
    traceId: string | null;
    matchedFields: Record<string, any> | null;
    incidentId: string | null;
}

export interface IncidentComment {
    id: string;
    incidentId: string;
    userId: string;
    comment: string;
    edited: boolean;
    editedAt: string | null;
    createdAt: string;
    userName?: string;
    userEmail?: string;
}

export interface IncidentHistoryEntry {
    id: string;
    incidentId: string;
    userId: string | null;
    action: string;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
    metadata: Record<string, any> | null;
    createdAt: string;
    userName?: string;
    userEmail?: string;
}

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

export interface IncidentFilters {
    organizationId: string;
    projectId?: string;
    status?: IncidentStatus[];
    severity?: Severity[];
    assigneeId?: string;
    service?: string;
    technique?: string;
    limit?: number;
    offset?: number;
}

export interface IpReputationData {
    ip: string;
    reputation: 'clean' | 'suspicious' | 'malicious';
    abuseConfidenceScore?: number;
    country?: string;
    isp?: string;
    domain?: string;
    usageType?: string;
    source: 'AbuseIPDB' | 'manual';
    lastChecked: string;
}

export interface GeoIpData {
    ip: string;
    country: string;
    countryCode: string;
    city: string | null;
    latitude: number;
    longitude: number;
    timezone: string | null;
    source: 'MaxMind' | 'manual';
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
        params.severity.forEach(s => searchParams.append('severity', s));
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
        filters.status.forEach(s => searchParams.append('status', s));
    }

    if (filters.severity) {
        filters.severity.forEach(s => searchParams.append('severity', s));
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
