import { getApiBaseUrl } from '$lib/config';

export interface TraceRecord {
  trace_id: string;
  service_name: string;
  root_service_name: string | null;
  root_operation_name: string | null;
  start_time: string;
  end_time: string;
  duration_ms: number;
  span_count: number;
  error: boolean;
}

export interface SpanRecord {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | null;
  status_code: 'UNSET' | 'OK' | 'ERROR' | null;
  status_message: string | null;
  attributes: Record<string, unknown> | null;
  events: Array<Record<string, unknown>> | null;
  links: Array<Record<string, unknown>> | null;
  resource_attributes: Record<string, unknown> | null;
}

export interface TracesResponse {
  traces: TraceRecord[];
  total: number;
}

export interface TraceFilters {
  projectId: string;
  service?: string;
  error?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface TraceStats {
  total_traces: number;
  total_spans: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  error_count: number;
  error_rate: number;
}

export interface ServiceDependencyNode {
  id: string;
  name: string;
  callCount: number;
}

export interface ServiceDependencyEdge {
  source: string;
  target: string;
  callCount: number;
}

export interface ServiceDependencies {
  nodes: ServiceDependencyNode[];
  edges: ServiceDependencyEdge[];
}


export class TracesAPI {
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


  async getTraces(filters: TraceFilters): Promise<TracesResponse> {
    const params = new URLSearchParams();

    params.append('projectId', filters.projectId);
    if (filters.service) params.append('service', filters.service);
    if (filters.error !== undefined) params.append('error', String(filters.error));
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    const url = `${getApiBaseUrl()}/traces?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Backend error response:', errorBody);
      throw new Error(`Failed to fetch traces: ${response.statusText}`);
    }

    return response.json();
  }

  async getTrace(traceId: string, projectId: string): Promise<TraceRecord> {
    const params = new URLSearchParams();
    params.append('projectId', projectId);

    const url = `${getApiBaseUrl()}/traces/${traceId}?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch trace: ${response.statusText}`);
    }

    return response.json();
  }

  async getTraceSpans(traceId: string, projectId: string): Promise<SpanRecord[]> {
    const params = new URLSearchParams();
    params.append('projectId', projectId);

    const url = `${getApiBaseUrl()}/traces/${traceId}/spans?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch trace spans: ${response.statusText}`);
    }

    const data = await response.json();
    return data.spans;
  }

  async getServices(projectId: string): Promise<string[]> {
    const params = new URLSearchParams();
    params.append('projectId', projectId);

    const url = `${getApiBaseUrl()}/traces/services?${params.toString()}`;

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

  async getStats(projectId: string, from?: string, to?: string): Promise<TraceStats> {
    const params = new URLSearchParams();
    params.append('projectId', projectId);
    if (from) params.append('from', from);
    if (to) params.append('to', to);

    const url = `${getApiBaseUrl()}/traces/stats?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch trace stats: ${response.statusText}`);
    }

    return response.json();
  }

  async getDependencies(projectId: string, from?: string, to?: string): Promise<ServiceDependencies> {
    const params = new URLSearchParams();
    params.append('projectId', projectId);
    if (from) params.append('from', from);
    if (to) params.append('to', to);

    const url = `${getApiBaseUrl()}/traces/dependencies?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch service dependencies: ${response.statusText}`);
    }

    return response.json();
  }
}

export const tracesAPI = new TracesAPI(() => {
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
