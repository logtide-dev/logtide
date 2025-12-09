// LogsAPI Client for backend integration
import { getApiBaseUrl, getApiUrl } from '$lib/config';

interface LogEntry {
  time: string;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  metadata?: Record<string, any>;
  traceId?: string;
  projectId: string;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
  limit: number;
  offset: number;
  nextCursor?: string;
}

interface LogFilters {
  projectId?: string | string[]; // Support single or multiple projects
  service?: string | string[]; // Support single or multiple services
  level?: string | string[]; // Support single or multiple levels
  traceId?: string; // Filter by trace ID
  from?: string;
  to?: string;
  q?: string; // Full-text search
  limit?: number;
  offset?: number;
  cursor?: string;
}

interface StatsResponse {
  timeseries: {
    bucket: string;
    total: number;
    by_level: Record<string, number>;
  }[];
  top_services: {
    service: string;
    count: number;
  }[];
  top_errors: {
    message: string;
    count: number;
  }[];
}

interface StatsFilters {
  service?: string;
  from?: string;
  to?: string;
  interval?: '1m' | '5m' | '1h' | '1d';
}


export class LogsAPI {
  constructor(private getToken: () => string | null) { }

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
   * Get logs with filters
   */
  async getLogs(filters: LogFilters = {}): Promise<LogsResponse> {
    const params = new URLSearchParams();

    // Handle projectId as single value or array
    if (filters.projectId) {
      if (Array.isArray(filters.projectId)) {
        filters.projectId.forEach((id) => params.append('projectId', id));
      } else {
        params.append('projectId', filters.projectId);
      }
    }

    // Handle service as single value or array
    if (filters.service) {
      if (Array.isArray(filters.service)) {
        filters.service.forEach((svc) => params.append('service', svc));
      } else {
        params.append('service', filters.service);
      }
    }

    // Handle level as single value or array
    if (filters.level) {
      if (Array.isArray(filters.level)) {
        filters.level.forEach((level) => params.append('level', level));
      } else {
        params.append('level', filters.level);
      }
    }

    if (filters.traceId) params.append('traceId', filters.traceId);
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    if (filters.q) params.append('q', filters.q);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());
    if (filters.cursor) params.append('cursor', filters.cursor);

    const url = `${getApiBaseUrl()}/logs?${params.toString()}`;

    console.log('Fetching logs from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Backend error response:', errorBody);
      throw new Error(`Failed to fetch logs: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get aggregated stats
   */
  async getStats(filters: StatsFilters = {}): Promise<StatsResponse> {
    const params = new URLSearchParams();

    if (filters.service) params.append('service', filters.service);
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    if (filters.interval) params.append('interval', filters.interval);

    const url = `${getApiBaseUrl()}/stats?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch stats: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create WebSocket for live tail
   */
  createLogsWebSocket(filters: { service?: string; level?: string; projectId: string }): WebSocket {
    const params = new URLSearchParams();
    params.append('projectId', filters.projectId);
    if (filters.service) params.append('service', filters.service);
    if (filters.level) params.append('level', filters.level);

    // Add authentication token
    const token = this.getToken();
    if (token) {
      params.append('token', token);
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use runtime API URL but replace protocol
    const apiUrl = new URL(getApiUrl());
    const wsUrl = `${wsProtocol}//${apiUrl.host}/api/v1/logs/ws?${params.toString()}`;

    return new WebSocket(wsUrl);
  }

  /**
   * Close WebSocket stream
   */
  closeLogsWebSocket(ws: WebSocket) {
    ws.close();
  }

  /**
   * Get log context (logs before and after a specific time)
   */
  async getLogContext(params: {
    projectId: string;
    time: string;
    before?: number;
    after?: number;
  }): Promise<{
    before: LogEntry[];
    current: LogEntry | null;
    after: LogEntry[];
  }> {
    const queryParams = new URLSearchParams();
    queryParams.append('projectId', params.projectId);
    queryParams.append('time', params.time);
    if (params.before) queryParams.append('before', params.before.toString());
    if (params.after) queryParams.append('after', params.after.toString());

    const url = `${getApiBaseUrl()}/logs/context?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch log context: ${response.statusText}`);
    }

    return response.json();
  }

  async getLogById(logId: string, projectId: string): Promise<{ log: LogEntry } | null> {
    const queryParams = new URLSearchParams();
    queryParams.append('projectId', projectId);

    const url = `${getApiBaseUrl()}/logs/${logId}?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch log: ${response.statusText}`);
    }

    return response.json();
  }
}

// Singleton instance
export const logsAPI = new LogsAPI(() => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('logward_auth');
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
