import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import { addFieldClause } from '@logtide/shared';
import { requestStreamTicket } from './stream-tickets';

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
  projectId: string | string[];
  service?: string | string[];
  error?: boolean;
  from?: string;
  to?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  operation?: string;
  /** Whitespace separated field clauses (log query grammar), metadata keys only. */
  attr?: string;
  sortBy?: 'start_time' | 'duration';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface TraceStats {
  total_traces: number;
  total_spans: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  /** Approximate, from latency buckets when several operations are in scope. */
  p95_duration_ms: number;
  error_count: number;
  error_rate: number;
}

export interface OperationRow {
  service: string;
  operation: string;
  count: number;
  errorCount: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughputPerMin: number;
}

export interface LatencyHistogram {
  bounds: number[];
  counts: number[];
}

export interface TraceErrorGroup {
  errorGroupId: string;
  status: 'open' | 'resolved' | 'ignored';
  exceptionType: string;
  exceptionMessage: string | null;
  projectId: string;
  logId: string;
  spanId: string | null;
  occurredAt: string;
}

export interface SpanLog {
  time: string;
  level: string;
  service: string;
  message: string;
  metadata?: Record<string, unknown>;
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

// Enriched types for the service map page
export interface EnrichedServiceDependencyNode {
  id: string;
  name: string;
  callCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number | null;
  totalCalls: number;
}

export interface EnrichedServiceDependencyEdge {
  source: string;
  target: string;
  callCount: number;
  type: 'span' | 'log_correlation';
}

export interface EnrichedServiceDependencies {
  nodes: EnrichedServiceDependencyNode[];
  edges: EnrichedServiceDependencyEdge[];
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

    const projectIds = Array.isArray(filters.projectId) ? filters.projectId : [filters.projectId];
    params.append('projectId', projectIds.join(','));
    if (filters.service) {
      const services = Array.isArray(filters.service) ? filters.service : [filters.service];
      if (services.length > 0) params.append('service', services.join(','));
    }
    if (filters.error !== undefined) params.append('error', String(filters.error));
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    if (filters.minDurationMs != null) params.append('minDurationMs', filters.minDurationMs.toString());
    if (filters.maxDurationMs != null) params.append('maxDurationMs', filters.maxDurationMs.toString());
    if (filters.operation) params.append('operation', filters.operation);
    if (filters.attr) params.append('attr', filters.attr);
    if (filters.sortBy) params.append('sortBy', filters.sortBy);
    if (filters.sortOrder) params.append('sortOrder', filters.sortOrder);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset != null) params.append('offset', filters.offset.toString());

    const url = `${getApiBaseUrl()}/traces?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
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

  async getStats(
    projectId: string,
    from?: string,
    to?: string,
    filter: { service?: string; operation?: string } = {}
  ): Promise<TraceStats> {
    const params = new URLSearchParams();
    params.append('projectId', projectId);
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (filter.service) params.append('service', filter.service);
    if (filter.operation) params.append('operation', filter.operation);

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

  async getOperations(params: {
    projectId: string;
    service?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<OperationRow[]> {
    const query = new URLSearchParams();
    query.append('projectId', params.projectId);
    if (params.service) query.append('service', params.service);
    if (params.from) query.append('from', params.from);
    if (params.to) query.append('to', params.to);
    if (params.limit) query.append('limit', params.limit.toString());

    const response = await fetch(`${getApiBaseUrl()}/traces/operations?${query.toString()}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch operations: ${response.statusText}`);
    }

    const data = await response.json();
    return data.operations;
  }

  async getLatencyHistogram(params: {
    projectId: string;
    service?: string;
    operation?: string;
    from?: string;
    to?: string;
  }): Promise<LatencyHistogram> {
    const query = new URLSearchParams();
    query.append('projectId', params.projectId);
    if (params.service) query.append('service', params.service);
    if (params.operation) query.append('operation', params.operation);
    if (params.from) query.append('from', params.from);
    if (params.to) query.append('to', params.to);

    const response = await fetch(`${getApiBaseUrl()}/traces/latency-histogram?${query.toString()}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch latency histogram: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Error groups that have an event in this trace. Optional enhancement: any
   * failure (including a 404) yields an empty list so the trace page never
   * depends on it.
   */
  async getErrorGroupsByTrace(
    traceId: string,
    projectId: string,
    organizationId: string
  ): Promise<TraceErrorGroup[]> {
    try {
      const query = new URLSearchParams();
      query.append('organizationId', organizationId);
      query.append('projectId', projectId);

      const response = await fetch(
        `${getApiBaseUrl()}/error-groups/by-trace/${encodeURIComponent(traceId)}?${query.toString()}`,
        { method: 'GET', headers: this.getHeaders() }
      );
      if (!response.ok) return [];

      const data = await response.json();
      return Array.isArray(data?.groups) ? data.groups : [];
    } catch {
      return [];
    }
  }

  /**
   * Logs of one span in a time window. Own fetch on purpose: lib/api/logs.ts
   * belongs to the logs explorer; the contract is GET /logs with `q`.
   */
  async getSpanLogs(params: {
    projectId: string;
    spanId: string;
    from: string;
    to: string;
    limit?: number;
  }): Promise<SpanLog[]> {
    const query = new URLSearchParams();
    query.append('projectId', params.projectId);
    query.append('q', addFieldClause('', 'span', params.spanId, false));
    query.append('from', params.from);
    query.append('to', params.to);
    if (params.limit) query.append('limit', params.limit.toString());

    const response = await fetch(`${getApiBaseUrl()}/logs?${query.toString()}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch span logs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.logs ?? [];
  }

  /**
   * Open an SSE stream that emits new traces as they arrive. Filters match
   * the traces query (projectId, service, error). Returns an EventSource the
   * caller is responsible for closing.
   */
  async createTracesEventSource(filters: {
    projectId: string;
    service?: string | string[];
    error?: boolean;
  }): Promise<EventSource> {
    const params = new URLSearchParams();
    params.append('projectId', filters.projectId);
    if (filters.service) {
      const services = Array.isArray(filters.service) ? filters.service : [filters.service];
      if (services.length > 0) params.append('service', services.join(','));
    }
    if (filters.error !== undefined) params.append('error', String(filters.error));
    // Use a short-lived single-use ticket instead of the session token so the
    // token never appears in the SSE URL (and thus in proxy/server logs).
    const ticket = await requestStreamTicket(this.getToken());
    params.append('ticket', ticket);
    const url = `${getApiBaseUrl()}/traces/stream?${params.toString()}`;
    return new EventSource(url, { withCredentials: true });
  }

  async getServiceMap(projectId: string, from?: string, to?: string): Promise<EnrichedServiceDependencies> {
    const params = new URLSearchParams();
    params.append('projectId', projectId);
    if (from) params.append('from', from);
    if (to) params.append('to', to);

    const url = `${getApiBaseUrl()}/traces/service-map?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch service map: ${response.statusText}`);
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

export const tracesAPI = new TracesAPI(getAuthToken);
