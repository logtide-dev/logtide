import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import { errorTextOf } from '$lib/api/metrics';
import type {
  HostSourceDetail,
  MetricAttrScope,
  MetricCatalogDetail,
  MetricCatalogListResponse,
  MetricQueryRequest,
  MetricQueryResponse,
  MetricSourceKind,
  MetricSourcesResponse,
  PanelConfig,
  ServiceSourceDetail,
  SourceTraceSeries,
} from '@logtide/shared';

/** Where a call looks: organization, optional project subset (null/empty = every project) and window. */
export interface MetricsScopeParams {
  organizationId: string;
  projectIds?: string[] | null;
  from?: string;
  to?: string;
}

export interface PanelsDataRequest {
  organizationId: string;
  from: string;
  to: string;
  variables: Record<string, string | null>;
  panels: Array<{ id: string; config: PanelConfig }>;
}

export interface PanelsDataResponse {
  panels: Record<string, { data?: unknown; error?: string }>;
}

export interface MetricAttributeParams extends MetricsScopeParams {
  /** Optional for scope=resource (every metric). */
  metricName?: string;
  scope: MetricAttrScope;
}

/** Typed client for the 1.8 metrics endpoints (query, sources, catalog, attributes, panel data). */
export class MetricsV2API {
  constructor(private getToken: () => string | null) {}

  private getHeaders(): HeadersInit {
    const token = this.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  private scopeQuery(p: MetricsScopeParams, extra: Record<string, string | undefined> = {}): string {
    const params = new URLSearchParams({ organizationId: p.organizationId });
    if (p.projectIds && p.projectIds.length > 0) params.set('projectIds', p.projectIds.join(','));
    if (p.from) params.set('from', p.from);
    if (p.to) params.set('to', p.to);
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== '') params.set(k, v);
    }
    return params.toString();
  }

  private async get<T>(path: string, query: string, fallback: string): Promise<T> {
    const res = await fetch(`${getApiBaseUrl()}${path}?${query}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(await errorTextOf(res, fallback));
    return res.json();
  }

  private async post<T>(path: string, body: unknown, fallback: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(await errorTextOf(res, fallback));
    return res.json();
  }

  query(request: MetricQueryRequest, signal?: AbortSignal): Promise<MetricQueryResponse> {
    return this.post('/metrics/query', request, 'Failed to run the metrics query', signal);
  }

  panelsData(request: PanelsDataRequest, signal?: AbortSignal): Promise<PanelsDataResponse> {
    return this.post('/metrics/panels/data', request, 'Failed to load panel data', signal);
  }

  getSources(p: MetricsScopeParams): Promise<MetricSourcesResponse> {
    return this.get('/metrics/sources', this.scopeQuery(p), 'Failed to load metric sources');
  }

  getHostSource(name: string, p: MetricsScopeParams): Promise<HostSourceDetail> {
    return this.get(
      `/metrics/sources/host/${encodeURIComponent(name)}`,
      this.scopeQuery(p),
      'Failed to load the host',
    );
  }

  /** Requests, errors and p95 over time from the entry spans of a host or service. */
  getSourceTraces(kind: MetricSourceKind, name: string, p: MetricsScopeParams): Promise<SourceTraceSeries> {
    return this.get(
      `/metrics/sources/${kind}/${encodeURIComponent(name)}/traces`,
      this.scopeQuery(p),
      'Failed to load the trace activity',
    );
  }

  getServiceSource(name: string, p: MetricsScopeParams): Promise<ServiceSourceDetail> {
    return this.get(
      `/metrics/sources/service/${encodeURIComponent(name)}`,
      this.scopeQuery(p),
      'Failed to load the service',
    );
  }

  /** Saves the kind's template as a dashboard bound to this source. */
  customizeSource(
    kind: MetricSourceKind,
    name: string,
    body: { organizationId: string; projectIds?: string[] | null },
  ): Promise<{ dashboardId: string }> {
    return this.post(
      `/metrics/sources/${kind}/${encodeURIComponent(name)}/customize`,
      body,
      'Failed to create the dashboard',
    );
  }

  /** `source` is `host:<name>` or `service:<name>`: only the metrics that source sent. */
  getCatalog(p: MetricsScopeParams & { search?: string; prefix?: string; source?: string }): Promise<MetricCatalogListResponse> {
    return this.get(
      '/metrics/catalog',
      this.scopeQuery(
        { organizationId: p.organizationId, projectIds: p.projectIds },
        { search: p.search, prefix: p.prefix, source: p.source },
      ),
      'Failed to load the metric catalog',
    );
  }

  getCatalogEntry(name: string, p: MetricsScopeParams): Promise<MetricCatalogDetail> {
    return this.get(
      '/metrics/catalog/entry',
      this.scopeQuery({ organizationId: p.organizationId, projectIds: p.projectIds }, { name }),
      'Failed to load the metric',
    );
  }

  async getAttributes(p: MetricAttributeParams): Promise<string[]> {
    const body = await this.get<{ keys: string[] }>(
      '/metrics/attributes',
      this.scopeQuery(p, { metricName: p.metricName, scope: p.scope }),
      'Failed to load attribute keys',
    );
    return body.keys;
  }

  async getAttributeValues(p: MetricAttributeParams & { key: string }): Promise<string[]> {
    const body = await this.get<{ values: string[] }>(
      '/metrics/attribute-values',
      this.scopeQuery(p, { metricName: p.metricName, scope: p.scope, key: p.key }),
      'Failed to load attribute values',
    );
    return body.values;
  }
}

export const metricsV2API = new MetricsV2API(getAuthToken);
