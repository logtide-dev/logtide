// Sources service (1.8): who sends metrics, with status and headline signals.
//
// Hosts come from the resource attribute host.name, services from
// service.name (metrics) UNION services that have spans. Signals go through
// the shared metric query service, RED comes from spans.

import { randomUUID } from 'node:crypto';
import {
  HOST_METRIC_PREFIXES,
  HOST_SIGNALS,
  SOURCE_SPARK_POINTS,
  SOURCE_STATUS_RANK,
  SOURCE_TEMPLATES,
  type HostSignal,
  type HostSourceDetail,
  type HostSourceInfo,
  type HostSourceSummary,
  type MetricSourceKind,
  type MetricSourceStatus,
  type PanelInstance,
  type DashboardVariable,
  type ServiceSourceDetail,
  type ServiceSourceSummary,
  type SourceSignalValue,
  type SourceSignalDef,
} from '@logtide/shared';
import { OPERATION_STATS_MAX_LIMIT, type MetricSource } from '@logtide/reservoir';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { customDashboardsService } from '../../custom-dashboards/service.js';
import { metricQueryService, type ResolvedMetricQuery } from '../query/service.js';
import {
  buildDashboardPanels,
  computeHostStatus,
  computeServiceStatus,
  lastNonNull,
  pickInterval,
  type HardwareStatusInput,
} from './status.js';
import { HTTP_SERVER_METRICS, histogramPercentile, redFromSeries, type MetricRed } from './red.js';

export interface SourcesContext {
  organizationId: string;
  /** Already resolved and authorized (resolveProjectScope). */
  projectIds: string[];
  from: Date;
  to: Date;
}

const SOURCE_LIMIT = 5000;
const SERIES_CHUNK = 50;
const CONCURRENCY = 6;
const PROBE_CONCURRENCY = 8;
const MAX_METRIC_NAMES = 1000;

const EMPTY_SIGNAL = (unit: string | null): SourceSignalValue => ({ value: null, unit, spark: [] });

/** Run `fn` over `items` with a bounded number of calls in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function ref(ctx: SourcesContext): number {
  return Math.min(Date.now(), ctx.to.getTime());
}

// ---------------------------------------------------------------------------
// Reservoir lookups
// ---------------------------------------------------------------------------

async function fetchSources(
  ctx: SourcesContext,
  key: string,
  extra: { coKeys?: string[]; excludeMetricPrefixes?: string[]; includeMetricPrefixes?: string[] } = {},
): Promise<MetricSource[]> {
  if (ctx.projectIds.length === 0) return [];
  const res = await reservoir.getMetricSources({
    organizationId: ctx.organizationId,
    projectId: ctx.projectIds,
    from: ctx.from,
    to: ctx.to,
    key,
    limit: SOURCE_LIMIT,
    ...extra,
  });
  return res.sources;
}

/**
 * Metric names a source sent in the window.
 *
 * The reservoir has no "names of one source" call, so: take every metric name
 * of the projects (getMetricNames), then probe getMetricSources with a prefix
 * filter. A first-segment family probe ("system.") discards whole families the
 * source never sent; inside a present family each name is probed alone, with
 * the longer names that share its prefix excluded so a prefix match cannot
 * leak ("system.cpu.utilization" vs "system.cpu.utilization.total").
 */
export async function sourceMetricNames(ctx: SourcesContext, key: string, value: string): Promise<string[]> {
  if (ctx.projectIds.length === 0) return [];
  const all = await reservoir.getMetricNames({
    organizationId: ctx.organizationId,
    projectId: ctx.projectIds,
    from: ctx.from,
    to: ctx.to,
    limit: MAX_METRIC_NAMES,
  });
  const names = [...new Set(all.names.map((n) => n.name))].sort();
  const has = async (include: string[], exclude: string[]): Promise<boolean> => {
    const found = await fetchSources(ctx, key, {
      includeMetricPrefixes: include,
      ...(exclude.length > 0 ? { excludeMetricPrefixes: exclude } : {}),
    });
    return found.some((s) => s.value === value);
  };

  const families = new Map<string, string[]>();
  const loners: string[] = [];
  for (const name of names) {
    const dot = name.indexOf('.');
    if (dot < 0) loners.push(name);
    else {
      const fam = name.slice(0, dot + 1);
      families.set(fam, [...(families.get(fam) ?? []), name]);
    }
  }

  const presentFamilies = (
    await mapLimit([...families.keys()], PROBE_CONCURRENCY, async (fam) => ((await has([fam], [])) ? fam : null))
  ).filter((f): f is string => f !== null);

  const toProbe: Array<{ name: string; alone: boolean }> = [];
  for (const fam of presentFamilies) {
    const list = families.get(fam) as string[];
    for (const name of list) toProbe.push({ name, alone: list.length === 1 });
  }
  for (const name of loners) toProbe.push({ name, alone: false });

  const result: string[] = [];
  await mapLimit(toProbe, PROBE_CONCURRENCY, async ({ name, alone }) => {
    if (alone) {
      result.push(name);
      return;
    }
    const longer = names.filter((n) => n !== name && n.startsWith(name));
    if (await has([name], longer)) result.push(name);
  });
  return result.sort();
}

// ---------------------------------------------------------------------------
// Host signals
// ---------------------------------------------------------------------------

type SignalMap = Map<string, SourceSignalValue>;

async function runSignal(
  ctx: SourcesContext,
  def: SourceSignalDef,
  hostNames: string[],
): Promise<SignalMap> {
  const out: SignalMap = new Map();
  const interval = pickInterval(ctx.to.getTime() - ctx.from.getTime(), SOURCE_SPARK_POINTS);
  const chunks: string[][] = [];
  for (let i = 0; i < hostNames.length; i += SERIES_CHUNK) chunks.push(hostNames.slice(i, i + SERIES_CHUNK));
  const label = 'resource.host.name';

  await mapLimit(chunks, CONCURRENCY, async (chunk) => {
    const query: ResolvedMetricQuery = {
      organizationId: ctx.organizationId,
      projectIds: ctx.projectIds,
      from: ctx.from.toISOString(),
      to: ctx.to.toISOString(),
      interval,
      compareTo: 'none',
      display: 'lines',
      formulas: [],
      queries: [
        {
          id: 'A',
          metricName: def.metricName,
          aggregation: def.aggregation,
          spaceAggregation: def.spaceAggregation,
          filters: [
            ...(def.filters ?? []),
            ...(hostNames.length > SERIES_CHUNK
              ? [{ scope: 'resource' as const, key: 'host.name', op: 'in' as const, values: chunk }]
              : []),
          ],
          groupBy: [{ scope: 'resource', key: 'host.name' }],
          limit: SERIES_CHUNK,
        },
      ],
    };
    const res = await metricQueryService.run(query);
    for (const s of res.series) {
      const host = s.labels[label];
      if (!host || s.comparison || s.queryId !== 'A') continue;
      const spark = s.points.map((p) => p.v);
      out.set(host, { value: lastNonNull(spark), unit: def.unit, spark });
    }
  });
  return out;
}

async function loadHostSignals(ctx: SourcesContext, hostNames: string[]): Promise<Record<HostSignal, SignalMap>> {
  const keys = Object.keys(HOST_SIGNALS) as HostSignal[];
  const maps = await Promise.all(keys.map((k) => runSignal(ctx, HOST_SIGNALS[k], hostNames)));
  return Object.fromEntries(keys.map((k, i) => [k, maps[i]])) as Record<HostSignal, SignalMap>;
}

// ---------------------------------------------------------------------------
// Hardware join
// ---------------------------------------------------------------------------

interface HardwareRow {
  id: string;
  projectId: string;
  hostName: string;
  status: HardwareStatusInput['status'];
  isVirtual: boolean | null;
  info: Record<string, unknown>;
  findingMessage: string | null;
}

async function loadHardware(ctx: SourcesContext, hostNames: string[]): Promise<Map<string, HardwareRow[]>> {
  const out = new Map<string, HardwareRow[]>();
  if (hostNames.length === 0 || ctx.projectIds.length === 0) return out;
  const rows = await db
    .selectFrom('hardware_hosts')
    .select(['id', 'project_id', 'host_name', 'status', 'is_virtual', 'info', 'findings'])
    .where('organization_id', '=', ctx.organizationId)
    .where('project_id', 'in', ctx.projectIds)
    .where('host_name', 'in', hostNames)
    .execute();
  for (const r of rows) {
    const findings = (Array.isArray(r.findings) ? r.findings : []) as Array<{ severity?: string; message?: string }>;
    const top = findings.find((f) => f.severity === 'critical') ?? findings[0];
    const row: HardwareRow = {
      id: r.id,
      projectId: r.project_id,
      hostName: r.host_name,
      status: r.status,
      isVirtual: r.is_virtual,
      info: (r.info ?? {}) as Record<string, unknown>,
      findingMessage: top?.message ?? null,
    };
    out.set(r.host_name, [...(out.get(r.host_name) ?? []), row]);
  }
  return out;
}

function worstHardware(rows: HardwareRow[]): HostSourceSummary['hardwareStatus'] {
  if (rows.length === 0) return null;
  return rows.reduce<MetricSourceStatus>((acc, r) => (SOURCE_STATUS_RANK[r.status] > SOURCE_STATUS_RANK[acc] ? r.status : acc), 'ok') as HostSourceSummary['hardwareStatus'];
}

function infoString(info: Record<string, unknown>, key: string): string | undefined {
  const v = info[key];
  return typeof v === 'string' && v ? v : undefined;
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

async function realServiceNames(ctx: SourcesContext): Promise<Set<string>> {
  const real = await fetchSources(ctx, 'service.name', { excludeMetricPrefixes: [...HOST_METRIC_PREFIXES] });
  return new Set(real.map((s) => s.value));
}

export async function listHosts(ctx: SourcesContext, only?: string): Promise<HostSourceSummary[]> {
  let sources = await fetchSources(ctx, 'host.name', { coKeys: ['service.name'] });
  if (only !== undefined) sources = sources.filter((s) => s.value === only);
  if (sources.length === 0) return [];

  const names = sources.map((s) => s.value);
  const [real, signals, hardware] = await Promise.all([
    realServiceNames(ctx),
    loadHostSignals(ctx, names),
    loadHardware(ctx, names),
  ]);
  const now = ref(ctx);

  return sources.map((s): HostSourceSummary => {
    const sig = (k: HostSignal): SourceSignalValue => signals[k].get(s.value) ?? EMPTY_SIGNAL(HOST_SIGNALS[k].unit);
    const cpu = sig('cpu');
    const memory = sig('memory');
    const disk = sig('disk');
    const hw = hardware.get(s.value) ?? [];
    const { status, reason } = computeHostStatus({
      now,
      lastSeen: s.lastSeen.getTime(),
      cpu: cpu.value,
      memory: memory.value,
      disk: disk.value,
      hardware: hw.map((h) => ({ status: h.status, findingMessage: h.findingMessage })),
    });
    const kernel = hw.map((h) => infoString(h.info, 'kernel')).find(Boolean) ?? null;
    return {
      kind: 'host',
      name: s.value,
      projectIds: s.projectIds,
      lastSeen: s.lastSeen.toISOString(),
      status,
      statusReason: reason,
      cpu,
      memory,
      disk,
      network: sig('network'),
      load: sig('load'),
      hardwareStatus: worstHardware(hw),
      hardwareHosts: hw.map((h) => ({ projectId: h.projectId, id: h.id })),
      services: (s.co['service.name'] ?? []).filter((n) => real.has(n)),
      os: kernel,
      metricCount: s.metricCount,
    };
  });
}

async function hostInfo(ctx: SourcesContext, name: string): Promise<HostSourceInfo> {
  const hw = (await loadHardware(ctx, [name])).get(name) ?? [];
  const info: HostSourceInfo = {};
  for (const h of hw) {
    info.kernel ??= infoString(h.info, 'kernel');
    info.vendor ??= infoString(h.info, 'vendor');
    info.model ??= infoString(h.info, 'model');
    info.agentVersion ??= infoString(h.info, 'agentVersion');
    if (h.isVirtual !== null) info.virtual ??= h.isVirtual;
  }
  if (info.kernel) info.os = info.kernel;

  // Memory size and uptime ride on one query run (last value in the window).
  const hostFilter = { scope: 'resource' as const, key: 'host.name', op: 'eq' as const, values: [name] };
  try {
    const res = await metricQueryService.run({
      organizationId: ctx.organizationId,
      projectIds: ctx.projectIds,
      from: ctx.from.toISOString(),
      to: ctx.to.toISOString(),
      interval: pickInterval(ctx.to.getTime() - ctx.from.getTime(), SOURCE_SPARK_POINTS),
      compareTo: 'none',
      display: 'stat',
      formulas: [],
      queries: [
        { id: 'A', metricName: 'hw.memory.size', aggregation: 'last', spaceAggregation: 'sum', filters: [hostFilter], groupBy: [] },
        { id: 'B', metricName: 'system.uptime', aggregation: 'max', spaceAggregation: 'max', filters: [hostFilter], groupBy: [] },
      ],
    });
    const pick = (id: string): number | null =>
      res.series.find((s) => s.queryId === id && !s.comparison)?.stats.last ?? null;
    const mem = pick('A');
    const up = pick('B');
    if (mem !== null) info.memoryBytes = mem;
    if (up !== null) info.uptimeSeconds = up;
  } catch {
    // Info is best effort: the detail still renders without memory/uptime.
  }
  return info;
}

export async function getHostDetail(ctx: SourcesContext, name: string): Promise<HostSourceDetail | null> {
  const [host] = await listHosts(ctx, name);
  if (!host) return null;
  const [info, metricNames] = await Promise.all([hostInfo(ctx, name), sourceMetricNames(ctx, 'host.name', name)]);
  return { ...host, info, metricNames };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

interface SpanStats {
  calls: number;
  errors: number;
  p95: number | null;
}

/**
 * RED from traces counts entry spans only (server/consumer kinds, roots when a
 * scope has none) through getOperationStats and getLatencyHistogram. Services
 * are discovered with getServiceHealthStats (every span), which is also the
 * fallback when an engine cannot answer the entry-span calls.
 */
async function loadSpanStats(ctx: SourcesContext): Promise<Map<string, SpanStats>> {
  const health = new Map<string, SpanStats>();
  await mapLimit(ctx.projectIds, CONCURRENCY, async (projectId) => {
    const rows = await reservoir.getServiceHealthStats(projectId, ctx.from, ctx.to);
    for (const r of rows) {
      const cur = health.get(r.serviceName) ?? { calls: 0, errors: 0, p95: null };
      cur.calls += r.totalCalls;
      cur.errors += r.totalErrors;
      // Percentiles do not add across projects: keep the worst one.
      if (r.p95LatencyMs !== null && (cur.p95 === null || r.p95LatencyMs > cur.p95)) cur.p95 = r.p95LatencyMs;
      health.set(r.serviceName, cur);
    }
  });

  const out = new Map<string, SpanStats>();
  await mapLimit([...health.keys()], CONCURRENCY, async (service) => {
    try {
      let calls = 0;
      let errors = 0;
      let bounds: number[] = [];
      let counts: number[] = [];
      for (const projectId of ctx.projectIds) {
        const ops = await reservoir.getOperationStats({
          projectId,
          service,
          from: ctx.from,
          to: ctx.to,
          limit: OPERATION_STATS_MAX_LIMIT,
        });
        if (ops.length === 0) continue;
        for (const o of ops) {
          calls += o.count;
          errors += o.errorCount;
        }
        const h = await reservoir.getLatencyHistogram({ projectId, service, from: ctx.from, to: ctx.to });
        bounds = h.bounds;
        counts = counts.length === 0 ? [...h.counts] : counts.map((c, i) => c + (h.counts[i] ?? 0));
      }
      out.set(service, { calls, errors, p95: histogramPercentile(bounds, counts, 0.95) });
    } catch {
      // Engine without entry-span stats: fall back to every span of the service.
      out.set(service, health.get(service) as SpanStats);
    }
  });
  return out;
}

interface SpanTrend {
  rate: Array<number | null>;
  errors: Array<number | null>;
  p95: Array<number | null>;
  /** ms of the end of the last non-empty bucket, capped at the window end. */
  lastSeen: number | null;
}

// The spark comes from getSpanTimeseries, which has no span kind filter: it
// counts every span of the service while the headline values count entry spans.
async function loadSpanTrend(ctx: SourcesContext, service: string): Promise<SpanTrend> {
  const windowMs = ctx.to.getTime() - ctx.from.getTime();
  const bucket = windowMs <= 7 * 86_400_000 ? 'hour' : 'day';
  const bucketMs = bucket === 'hour' ? 3_600_000 : 86_400_000;
  const rows = await reservoir.getSpanTimeseries({
    projectIds: ctx.projectIds,
    from: ctx.from,
    to: ctx.to,
    bucket,
    serviceName: service,
  });
  let lastSeen: number | null = null;
  for (const r of rows) {
    if (r.spanCount > 0) lastSeen = Math.min(r.time.getTime() + bucketMs, ctx.to.getTime());
  }
  return {
    rate: rows.map((r) => r.spanCount / (bucketMs / 1000)),
    errors: rows.map((r) => (r.spanCount > 0 ? (r.errorCount / r.spanCount) * 100 : null)),
    p95: rows.map((r) => r.p95),
    lastSeen,
  };
}

/** RED from HTTP server metrics for services without spans (newest semconv first, legacy name for the rest). */
async function loadMetricRed(ctx: SourcesContext, candidates: string[]): Promise<Map<string, MetricRed>> {
  const out = new Map<string, MetricRed>();
  let remaining = candidates;
  const interval = pickInterval(ctx.to.getTime() - ctx.from.getTime(), SOURCE_SPARK_POINTS);
  for (const variant of HTTP_SERVER_METRICS) {
    if (remaining.length === 0) break;
    const chunks: string[][] = [];
    for (let i = 0; i < remaining.length; i += SERIES_CHUNK) chunks.push(remaining.slice(i, i + SERIES_CHUNK));
    await mapLimit(chunks, CONCURRENCY, async (chunk) => {
      const svc = { scope: 'resource' as const, key: 'service.name', op: 'in' as const, values: chunk };
      const groupBy = [{ scope: 'resource' as const, key: 'service.name' }];
      try {
        const res = await metricQueryService.run({
          organizationId: ctx.organizationId,
          projectIds: ctx.projectIds,
          from: ctx.from.toISOString(),
          to: ctx.to.toISOString(),
          interval,
          compareTo: 'none',
          display: 'lines',
          formulas: [],
          queries: [
            { id: 'A', metricName: variant.metricName, aggregation: 'rate', spaceAggregation: 'sum', filters: [svc], groupBy, limit: SERIES_CHUNK },
            {
              id: 'B',
              metricName: variant.metricName,
              aggregation: 'rate',
              spaceAggregation: 'sum',
              filters: [svc, { scope: 'metric', key: variant.statusKey, op: 'gte', values: ['500'] }],
              groupBy,
              limit: SERIES_CHUNK,
            },
            { id: 'C', metricName: variant.metricName, aggregation: 'p95', spaceAggregation: 'avg', filters: [svc], groupBy, limit: SERIES_CHUNK },
          ],
        });
        for (const name of chunk) {
          const red = redFromSeries(res.series, name, variant.defaultUnit);
          if (red) out.set(name, red);
        }
      } catch {
        // Best effort: a failing query leaves these services without RED.
      }
    });
    remaining = remaining.filter((n) => !out.has(n));
  }
  return out;
}

export async function listServices(ctx: SourcesContext, only?: string): Promise<ServiceSourceSummary[]> {
  const [metricSources, spanStats] = await Promise.all([
    fetchSources(ctx, 'service.name', { coKeys: ['host.name'], excludeMetricPrefixes: [...HOST_METRIC_PREFIXES] }),
    loadSpanStats(ctx),
  ]);
  const byName = new Map(metricSources.map((s) => [s.value, s]));
  let names = [...new Set([...byName.keys(), ...spanStats.keys()])].sort();
  if (only !== undefined) names = names.filter((n) => n === only);

  const windowSec = Math.max(1, (ctx.to.getTime() - ctx.from.getTime()) / 1000);
  const now = ref(ctx);
  const trends = new Map<string, SpanTrend>();
  await mapLimit(
    names.filter((n) => (spanStats.get(n)?.calls ?? 0) > 0),
    CONCURRENCY,
    async (n) => {
      trends.set(n, await loadSpanTrend(ctx, n));
    },
  );

  const metricRed = await loadMetricRed(
    ctx,
    names.filter((n) => (spanStats.get(n)?.calls ?? 0) === 0 && (byName.get(n)?.metricCount ?? 0) > 0),
  );

  return names.map((name): ServiceSourceSummary => {
    const m = byName.get(name);
    const st = spanStats.get(name);
    const trend = trends.get(name);
    const hasTraces = !!st && st.calls > 0;
    const red = hasTraces ? null : (metricRed.get(name) ?? null);
    const redSource: ServiceSourceSummary['redSource'] = hasTraces ? 'traces' : red ? 'metrics' : null;
    const errorPct = hasTraces ? (st.errors / st.calls) * 100 : (red?.errorRate.value ?? null);
    const lastSeenMs = Math.max(m?.lastSeen.getTime() ?? 0, trend?.lastSeen ?? 0) || ctx.from.getTime();
    const { status, reason } = computeServiceStatus({ now, lastSeen: lastSeenMs, errorRate: errorPct });
    return {
      kind: 'service',
      name,
      projectIds: m?.projectIds ?? ctx.projectIds,
      lastSeen: new Date(lastSeenMs).toISOString(),
      status,
      statusReason: reason,
      redSource,
      requestRate: hasTraces
        ? { value: st.calls / windowSec, unit: 'req/s', spark: trend?.rate ?? [] }
        : (red?.requestRate ?? EMPTY_SIGNAL('req/s')),
      errorRate: hasTraces ? { value: errorPct, unit: '%', spark: trend?.errors ?? [] } : (red?.errorRate ?? EMPTY_SIGNAL('%')),
      p95: hasTraces ? { value: st.p95, unit: 'ms', spark: trend?.p95 ?? [] } : (red?.p95 ?? EMPTY_SIGNAL('ms')),
      hosts: m?.co['host.name'] ?? [],
      metricCount: m?.metricCount ?? 0,
      hasTraces,
    };
  });
}

export async function getServiceDetail(ctx: SourcesContext, name: string): Promise<ServiceSourceDetail | null> {
  const [svc] = await listServices(ctx, name);
  if (!svc) return null;
  const metricNames = svc.metricCount > 0 ? await sourceMetricNames(ctx, 'service.name', name) : [];
  return { ...svc, metricNames };
}

// ---------------------------------------------------------------------------
// Customize
// ---------------------------------------------------------------------------

/** The `variables` column arrives with the dashboards change; until the create path takes it, this is the one place to adapt. */
export interface DashboardCreateWithVariables {
  organizationId: string;
  projectId: null;
  name: string;
  panels: PanelInstance[];
  variables: DashboardVariable[];
}

export function createDashboard(input: DashboardCreateWithVariables, userId: string) {
  return customDashboardsService.create(input as Parameters<typeof customDashboardsService.create>[0], userId);
}

export function buildCustomizeInput(
  kind: MetricSourceKind,
  name: string,
  organizationId: string,
  metricNames: string[],
  projectIds: string[] | null,
): DashboardCreateWithVariables {
  const template = SOURCE_TEMPLATES[kind];
  return {
    organizationId,
    projectId: null,
    name: template.dashboardName.replace('{name}', name),
    panels: buildDashboardPanels(template, metricNames, projectIds, () => `panel-${randomUUID()}`),
    variables: [{ ...template.variable, default: name }],
  };
}
