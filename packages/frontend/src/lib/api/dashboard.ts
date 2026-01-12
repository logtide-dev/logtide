// Dashboard API Client
import { getApiUrl } from '$lib/config';

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

  /**
   * Get dashboard statistics
   */
  async getStats(organizationId: string): Promise<DashboardStats> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);

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

  /**
   * Get timeseries data for chart
   */
  async getTimeseries(organizationId: string): Promise<TimeseriesDataPoint[]> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);

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

  /**
   * Get top services
   */
  async getTopServices(organizationId: string): Promise<TopService[]> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);

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

  /**
   * Get recent errors
   */
  async getRecentErrors(organizationId: string): Promise<RecentError[]> {
    const params = new URLSearchParams();
    params.append('organizationId', organizationId);

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

// Singleton instance
export const dashboardAPI = new DashboardAPI(() => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('logtide_auth');
      if (stored) {
        const data = JSON.parse(stored);
        return data.token;
      }
    } catch (e) {
      console.error('Failed to get token:', e);
    }
  }
  return null;
});
