import {
  SOURCE_STATUS_RANK,
  quoteFieldValue,
  type HostSourceSummary,
  type MetricCatalogEntry,
  type MetricTimeAggregation,
  type MetricAttrFilter,
  type MetricSourceKind,
  type ServiceSourceSummary,
  type SourceSignalValue,
} from '@logtide/shared';
import type { DataTableSort } from '$lib/components/app/data-table';
import { defaultExplorerQuery, writeExplorerQuery } from '$lib/utils/metrics-explorer-url';
import { writeScopeToUrl, type Scope } from '$lib/stores/scope-url';

// Pure helpers of the Metrics Sources pages: kind filter, sorting, filtering
// and the links that leave a source page.

export type KindFilter = 'all' | MetricSourceKind;

export const SETUP_DOCS = {
  hardware: 'https://logtide.dev/docs/hardware-health/',
  otlp: 'https://logtide.dev/docs/otlp/',
} as const;

/** `?kind=host|service`; anything else shows every kind. */
export function parseKind(value: string | null | undefined): KindFilter {
  return value === 'host' || value === 'service' ? value : 'all';
}

export function sourceHref(kind: MetricSourceKind, name: string): string {
  return `/dashboard/metrics/${kind === 'host' ? 'hosts' : 'services'}/${encodeURIComponent(name)}`;
}

// ---------------------------------------------------------------------------
// sorting
// ---------------------------------------------------------------------------

export type HostSortKey = 'status' | 'name' | 'cpu' | 'memory' | 'disk' | 'network' | 'load' | 'services' | 'lastSeen';
export type ServiceSortKey = 'status' | 'name' | 'requestRate' | 'errorRate' | 'p95' | 'hosts' | 'lastSeen';

/** Worst status first, then name: the order of a list nobody sorted. */
export const DEFAULT_SORT: DataTableSort = { key: 'status', dir: 'desc' };

function signalValue(s: SourceSignalValue | null | undefined): number | null {
  return s && s.value !== null && Number.isFinite(s.value) ? s.value : null;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
}

function hostValue(h: HostSourceSummary, key: string): number | string | null {
  switch (key) {
    case 'status':
      return SOURCE_STATUS_RANK[h.status] ?? 0;
    case 'name':
      return h.name.toLowerCase();
    case 'cpu':
    case 'memory':
    case 'disk':
    case 'network':
    case 'load':
      return signalValue(h[key]);
    case 'services':
      return h.services.length;
    case 'lastSeen':
      return new Date(h.lastSeen).getTime();
    default:
      return null;
  }
}

function serviceValue(s: ServiceSourceSummary, key: string): number | string | null {
  switch (key) {
    case 'status':
      return SOURCE_STATUS_RANK[s.status] ?? 0;
    case 'name':
      return s.name.toLowerCase();
    case 'requestRate':
    case 'errorRate':
    case 'p95':
      return signalValue(s[key]);
    case 'hosts':
      return s.hosts.length;
    case 'lastSeen':
      return new Date(s.lastSeen).getTime();
    default:
      return null;
  }
}

function sortBy<T extends { name: string }>(
  rows: T[],
  sort: DataTableSort | undefined,
  value: (row: T, key: string) => number | string | null,
): T[] {
  const { key, dir } = sort ?? DEFAULT_SORT;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, key);
    const vb = value(b, key);
    // Rows without a value always sink to the bottom, whatever the direction.
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'en', { numeric: true }) : (va as number) - (vb as number);
      if (cmp !== 0) return cmp * sign;
    }
    return byName(a, b);
  });
}

export function sortHosts(rows: HostSourceSummary[], sort?: DataTableSort): HostSourceSummary[] {
  return sortBy(rows, sort, hostValue);
}

export function sortServices(rows: ServiceSourceSummary[], sort?: DataTableSort): ServiceSourceSummary[] {
  return sortBy(rows, sort, serviceValue);
}

// ---------------------------------------------------------------------------
// filtering
// ---------------------------------------------------------------------------

function matches(text: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return text.some((t) => t.toLowerCase().includes(q));
}

export function filterHostRows(rows: HostSourceSummary[], query: string): HostSourceSummary[] {
  return rows.filter((h) => matches([h.name, h.os ?? '', ...h.services], query));
}

export function filterServiceRows(rows: ServiceSourceSummary[], query: string): ServiceSourceSummary[] {
  return rows.filter((s) => matches([s.name, ...s.hosts], query));
}

// ---------------------------------------------------------------------------
// links
// ---------------------------------------------------------------------------

const SOURCE_ATTR: Record<MetricSourceKind, string> = { host: 'host.name', service: 'service.name' };
const PREFERRED_METRIC: Record<MetricSourceKind, string> = {
  host: 'system.cpu.utilization.total',
  service: 'http.server.request.duration',
};

/** Explorer URL with the first query filtered on the source (a resource attribute filter). */
export function buildExploreHref(
  kind: MetricSourceKind,
  name: string,
  metricNames: string[],
  projectIds: string[] | null,
  search = '',
): string {
  const base = defaultExplorerQuery();
  const filter: MetricAttrFilter = { scope: 'resource', key: SOURCE_ATTR[kind], op: 'eq', values: [name] };
  const metricName = metricNames.includes(PREFERRED_METRIC[kind]) ? PREFERRED_METRIC[kind] : (metricNames[0] ?? '');
  const query = {
    ...base,
    projectIds: projectIds && projectIds.length > 0 ? projectIds : null,
    queries: [{ ...base.queries[0], metricName, filters: [filter] }],
  };
  const params = writeExplorerQuery(new URLSearchParams(search), query);
  return `/dashboard/metrics/explore?${params.toString()}`;
}

/** Explorer URL for one metric of a source (Metrics tab cards). */
export function buildMetricExploreHref(
  kind: MetricSourceKind,
  name: string,
  metricName: string,
  projectIds: string[] | null,
  search = '',
): string {
  return buildExploreHref(kind, name, [metricName], projectIds, search);
}

function scopedUrl(path: string, scope: Partial<Scope>, extra: Record<string, string>): string {
  const url = writeScopeToUrl(new URL(path, 'http://local.invalid'), scope, { explicitAll: true });
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}`;
}


/** Logs filtered on the host (host:name) or service (service:name) of a source. */
export function buildSourceLogsHref(kind: MetricSourceKind, name: string, scope: Partial<Scope>): string {
  return scopedUrl('/dashboard/logs', scope, { q: `${kind === 'host' ? 'host' : 'service'}:${quoteFieldValue(name)}` });
}

/** Traces page filtered on a service. */
export function buildServiceTracesHref(service: string, scope: Partial<Scope>): string {
  return scopedUrl('/dashboard/traces', scope, { service });
}

/**
 * Time aggregation a source metric card charts by catalog type: rate for
 * monotonic sums, p95 for histograms, avg for everything else (gauges,
 * non-monotonic sums, unknown metrics).
 */
export function aggregationForCatalogEntry(
  entry: Pick<MetricCatalogEntry, 'type' | 'isMonotonic'> | null | undefined,
): MetricTimeAggregation {
  if (!entry) return 'avg';
  if (entry.type === 'histogram' || entry.type === 'exp_histogram') return 'p95';
  if (entry.type === 'sum' && entry.isMonotonic === true) return 'rate';
  return 'avg';
}

/** metric name -> aggregation, from a catalog listing. */
export function aggregationsByMetric(entries: MetricCatalogEntry[]): Map<string, MetricTimeAggregation> {
  const out = new Map<string, MetricTimeAggregation>();
  for (const e of entries) {
    const agg = aggregationForCatalogEntry(e);
    // a name can exist with several types: a non-default choice wins over avg
    if (!out.has(e.name) || out.get(e.name) === 'avg') out.set(e.name, agg);
  }
  return out;
}
