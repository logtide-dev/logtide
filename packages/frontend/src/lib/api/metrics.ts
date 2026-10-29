import { getApiBaseUrl, getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type { MetricChartConfig, PanelInstance } from '@logtide/shared';

/** Read the server `error` field of a failed response, falling back to the status text. */
export async function errorTextOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string' && body.error !== '') return body.error;
  } catch {
    /* not json */
  }
  return `${fallback}: ${res.statusText || res.status}`;
}

export type MetricType = 'gauge' | 'sum' | 'histogram' | 'exp_histogram' | 'summary';
export type MetricAggregationFn = 'avg' | 'sum' | 'min' | 'max' | 'count' | 'last' | 'rate' | 'p50' | 'p95' | 'p99';

export interface MetricName {
  name: string;
  type: MetricType;
}

export interface MetricTimeBucket {
  bucket: string;
  value: number;
  labels?: Record<string, string>;
}

export interface MetricAggregateResult {
  metricName: string;
  metricType: MetricType;
  timeseries: MetricTimeBucket[];
  /** Interval the server used (resolved when `auto` was requested). */
  interval?: string;
  bucketSeconds?: number;
  /** Number of distinct series before the server-side cap. */
  seriesTotal?: number;
  seriesShown?: number;
}

export interface MetricDataPoint {
  id: string;
  time: string;
  metricName: string;
  metricType: MetricType;
  value: number;
  serviceName: string;
  attributes: Record<string, unknown> | null;
  resourceAttributes: Record<string, unknown> | null;
  histogramData: Record<string, unknown> | null;
  hasExemplars: boolean;
  exemplars?: Array<{
    exemplarValue: number;
    exemplarTime?: string;
    traceId?: string;
    spanId?: string;
    attributes?: Record<string, unknown>;
  }>;
}

export interface MetricDataResponse {
  metrics: MetricDataPoint[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface MetricOverviewItem {
  metricName: string;
  metricType: MetricType;
  serviceName: string;
  latestValue: number;
  avgValue: number;
  minValue: number;
  maxValue: number;
  pointCount: number;
}

export interface MetricsOverviewResult {
  services: Array<{
    serviceName: string;
    metrics: MetricOverviewItem[];
  }>;
  executionTimeMs?: number;
}

export class MetricsAPI {
  constructor(private getToken: () => string | null) {}

  private getHeaders(): HeadersInit {
    const token = this.getToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async getMetricNames(projectId: string, from?: string, to?: string): Promise<MetricName[]> {
    const params = new URLSearchParams({ projectId });
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const res = await fetch(`${getApiBaseUrl()}/metrics/names?${params}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch metric names: ${res.statusText}`);
    const data = await res.json();
    return data.names;
  }

  async getLabelKeys(projectId: string, metricName: string, from?: string, to?: string): Promise<string[]> {
    const params = new URLSearchParams({ projectId, metricName });
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const res = await fetch(`${getApiBaseUrl()}/metrics/labels/keys?${params}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch label keys: ${res.statusText}`);
    const data = await res.json();
    return data.keys ?? [];
  }

  async getLabelValues(projectId: string, metricName: string, labelKey: string, from?: string, to?: string): Promise<string[]> {
    const params = new URLSearchParams({ projectId, metricName, labelKey });
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const res = await fetch(`${getApiBaseUrl()}/metrics/labels/values?${params}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch label values: ${res.statusText}`);
    const data = await res.json();
    return data.values ?? [];
  }

  async getMetricData(params: {
    projectId: string;
    metricName: string;
    from: string;
    to: string;
    attributes?: Record<string, string>;
    limit?: number;
    offset?: number;
    includeExemplars?: boolean;
  }): Promise<MetricDataResponse> {
    const searchParams = new URLSearchParams({
      projectId: params.projectId,
      metricName: params.metricName,
      from: params.from,
      to: params.to,
    });
    if (params.limit) searchParams.append('limit', String(params.limit));
    if (params.offset) searchParams.append('offset', String(params.offset));
    if (params.includeExemplars) searchParams.append('includeExemplars', 'true');
    if (params.attributes) {
      for (const [k, v] of Object.entries(params.attributes)) {
        searchParams.append(`attributes[${k}]`, v);
      }
    }
    const res = await fetch(`${getApiBaseUrl()}/metrics/data?${searchParams}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch metric data: ${res.statusText}`);
    return res.json();
  }

  async aggregateMetrics(params: {
    projectId: string;
    metricName: string;
    from: string;
    to: string;
    interval?: string | 'auto';
    aggregation?: MetricAggregationFn;
    groupBy?: string[];
    /** An array value is sent as repeated `attributes[key]` (one series per value). */
    attributes?: Record<string, string | string[]>;
    serviceName?: string;
  }): Promise<MetricAggregateResult> {
    const searchParams = new URLSearchParams({
      projectId: params.projectId,
      metricName: params.metricName,
      from: params.from,
      to: params.to,
      interval: params.interval ?? 'auto',
      aggregation: params.aggregation ?? 'avg',
    });
    if (params.groupBy) params.groupBy.forEach(g => searchParams.append('groupBy', g));
    if (params.serviceName) searchParams.append('serviceName', params.serviceName);
    if (params.attributes) {
      for (const [k, v] of Object.entries(params.attributes)) {
        for (const value of Array.isArray(v) ? v : [v]) {
          searchParams.append(`attributes[${k}]`, value);
        }
      }
    }
    const res = await fetch(`${getApiBaseUrl()}/metrics/aggregate?${searchParams}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(await errorTextOf(res, 'Failed to aggregate metrics'));
    return res.json();
  }

  async getOverview(params: {
    projectId: string;
    from: string;
    to: string;
    serviceName?: string;
  }): Promise<MetricsOverviewResult> {
    const searchParams = new URLSearchParams({
      projectId: params.projectId,
      from: params.from,
      to: params.to,
    });
    if (params.serviceName) searchParams.append('serviceName', params.serviceName);
    const res = await fetch(`${getApiBaseUrl()}/metrics/overview?${searchParams}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch metrics overview: ${res.statusText}`);
    return res.json();
  }
}

export const metricsAPI = new MetricsAPI(getAuthToken);

// ─── Add to dashboard ───────────────────────────────────────────────────────

function dashboardHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

const DASHBOARD_PANEL_WIDTH = 6;
const DASHBOARD_PANEL_HEIGHT = 4;

export async function listDashboardsForPicker(organizationId: string): Promise<{ id: string; name: string }[]> {
  const params = new URLSearchParams({ organizationId });
  const res = await fetch(`${getApiUrl()}/api/v1/custom-dashboards?${params}`, { headers: dashboardHeaders() });
  if (!res.ok) throw new Error(await errorTextOf(res, 'Failed to load dashboards'));
  const data = await res.json();
  return (data.dashboards ?? []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }));
}

/** Append a metric chart panel below the lowest existing panel and save the panels only. */
export async function addMetricPanelToDashboard(input: {
  organizationId: string;
  dashboardId: string;
  config: MetricChartConfig;
}): Promise<void> {
  const params = new URLSearchParams({ organizationId: input.organizationId });
  const url = `${getApiUrl()}/api/v1/custom-dashboards/${encodeURIComponent(input.dashboardId)}?${params}`;

  const getRes = await fetch(url, { headers: dashboardHeaders() });
  if (!getRes.ok) throw new Error(await errorTextOf(getRes, 'Failed to load dashboard'));
  const { dashboard } = await getRes.json();
  const panels: PanelInstance[] = dashboard?.panels ?? [];

  const y = panels.reduce((max, p) => Math.max(max, p.layout.y + p.layout.h), 0);
  const panel: PanelInstance = {
    id: crypto.randomUUID(),
    layout: { x: 0, y, w: DASHBOARD_PANEL_WIDTH, h: DASHBOARD_PANEL_HEIGHT },
    config: input.config,
  };

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: dashboardHeaders(),
    body: JSON.stringify({ panels: [...panels, panel] }),
  });
  if (!putRes.ok) throw new Error(await errorTextOf(putRes, 'Failed to save dashboard'));
}
