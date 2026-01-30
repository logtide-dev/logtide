import { getApiBaseUrl, getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type { LogLevel } from '@logtide/shared';

interface LogEntry {
  time: string;
  service: string;
  level: LogLevel;
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

export type SearchMode = 'fulltext' | 'substring';

interface LogFilters {
  projectId?: string | string[];
  service?: string | string[];
  level?: string | string[];
  traceId?: string;
  from?: string;
  to?: string;
  q?: string;
  searchMode?: SearchMode;
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

  async getLogs(filters: LogFilters = {}): Promise<LogsResponse> {
    const params = new URLSearchParams();

    if (filters.projectId) {
      if (Array.isArray(filters.projectId)) {
        filters.projectId.forEach((id) => params.append('projectId', id));
      } else {
        params.append('projectId', filters.projectId);
      }
    }

    if (filters.service) {
      if (Array.isArray(filters.service)) {
        filters.service.forEach((svc) => params.append('service', svc));
      } else {
        params.append('service', filters.service);
      }
    }

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
    if (filters.searchMode) params.append('searchMode', filters.searchMode);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());
    if (filters.cursor) params.append('cursor', filters.cursor);

    const url = `${getApiBaseUrl()}/logs?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch logs: ${response.statusText}`);
    }

    return response.json();
  }

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

  createLogsWebSocket(filters: { service?: string; level?: string; projectId: string }): WebSocket {
    const params = new URLSearchParams();
    params.append('projectId', filters.projectId);
    if (filters.service) params.append('service', filters.service);
    if (filters.level) params.append('level', filters.level);

    const token = this.getToken();
    if (token) {
      params.append('token', token);
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const apiUrl = new URL(getApiUrl());
    const wsUrl = `${wsProtocol}//${apiUrl.host}/api/v1/logs/ws?${params.toString()}`;

    return new WebSocket(wsUrl);
  }

  closeLogsWebSocket(ws: WebSocket) {
    ws.close();
  }

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

  async getServices(params: {
    projectId: string | string[];
    from?: string;
    to?: string;
  }): Promise<string[]> {
    const queryParams = new URLSearchParams();

    if (Array.isArray(params.projectId)) {
      params.projectId.forEach((id) => queryParams.append('projectId', id));
    } else {
      queryParams.append('projectId', params.projectId);
    }

    if (params.from) queryParams.append('from', params.from);
    if (params.to) queryParams.append('to', params.to);

    const url = `${getApiBaseUrl()}/logs/services?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch services: ${response.statusText}`);
    }

    const data = await response.json();
    return data.services;
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

export const logsAPI = new LogsAPI(getAuthToken);
