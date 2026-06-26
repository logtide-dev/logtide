import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export interface DashboardStats {
  totalLogsToday: {
    value: number;
    trend: number;
  };
  errorRate: {
    value: number;
    trend: number;
  };
  activeServices: {
    value: number;
    trend: number;
  };
  avgThroughput: {
    value: number;
    trend: number;
  };
}

export interface TimeseriesDataPoint {
  time: string;
  total: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
  critical: number;
}

export interface TopService {
  name: string;
  count: number;
  percentage: number;
}

export interface RecentError {
  time: string;
  service: string;
  level: 'error' | 'critical';
  message: string;
  projectId: string;
  traceId?: string;
}

export interface TimelineEvent {
  time: string;
  alerts: number;
  detections: number;
  alertDetails: Array<{ ruleName: string; alertType: string; logCount: number }>;
  detectionsBySeverity: { critical: number; high: number; medium: number; low: number };
}

export interface ActivityOverviewData {
  series: Array<{
    time: string;
    logs: number;
    log_errors: number;
    spans: number;
    span_errors: number;
    detections: number;
    alerts: number;
  }>;
  timeRange: string;
  bucket: 'hour' | 'day';
  enabled: string[];
}

export class DashboardAPI {
  constructor(private getToken: () => string | null) {}

  private getHeaders(): HeadersInit {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  async getStats(organizationId: string, projectId?: string): Promise<DashboardStats> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);
    if (projectId) params.append('projectId', projectId);

    const url = `${getApiUrl()}/api/v1/dashboard/stats?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch dashboard stats: ${response.statusText}`);
    }

    return response.json();
  }

  async getTimeseries(organizationId: string, projectId?: string): Promise<TimeseriesDataPoint[]> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);
    if (projectId) params.append('projectId', projectId);

    const url = `${getApiUrl()}/api/v1/dashboard/timeseries?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch timeseries data: ${response.statusText}`);
    }

    const data = await response.json();
    return data.timeseries;
  }

  async getActivityOverview(
    organizationId: string,
    projectId?: string,
    timeRange: '24h' | '7d' | '30d' = '24h'
  ): Promise<ActivityOverviewData> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);
    if (projectId) params.append('projectId', projectId);
    params.append('timeRange', timeRange);

    const url = `${getApiUrl()}/api/v1/dashboard/activity-overview?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch activity overview: ${response.statusText}`);
    }

    return (await response.json()) as ActivityOverviewData;
  }

  async getTopServices(organizationId: string, projectId?: string): Promise<TopService[]> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);
    if (projectId) params.append('projectId', projectId);

    const url = `${getApiUrl()}/api/v1/dashboard/top-services?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch top services: ${response.statusText}`);
    }

    const data = await response.json();
    return data.services;
  }

  async getTimelineEvents(organizationId: string, projectId?: string): Promise<TimelineEvent[]> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);
    if (projectId) params.append('projectId', projectId);

    const url = `${getApiUrl()}/api/v1/dashboard/timeline-events?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch timeline events: ${response.statusText}`);
    }

    const data = await response.json();
    return data.events;
  }

  async getRecentErrors(organizationId: string, projectId?: string): Promise<RecentError[]> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);
    if (projectId) params.append('projectId', projectId);

    const url = `${getApiUrl()}/api/v1/dashboard/recent-errors?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch recent errors: ${response.statusText}`);
    }

    const data = await response.json();
    return data.errors;
  }
}

export const dashboardAPI = new DashboardAPI(getAuthToken);
