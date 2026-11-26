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
import { OPERATION_STATS_MAX_LIMIT, type MetricSource, type OperationStat } from '@logtide/reservoir';
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
import { HTTP_SERVER_METRICS, mixturePercentile, redFromSeries, sliceWindow, type MetricRed } from './red.js';

export interface SourcesContext {
  organizationId: string;
  /** Already resolved and authorized (resolveProjectScope). */
  projectIds: string[];
  from: Date;
  to: Date;
}

const SOURCE_LIMIT = 5000;
const CONCURRENCY = 6;
/** Names one source can send; far above anything real, there is no pagination in the engines. */
const MAX_METRIC_NAMES = 10_000;
/** Spans read per round when looking for the newest span of each service. */
const LAST_SPAN_BATCH = 100;
/** Rounds of the newest-span lookup per project; keeps the call count constant. */
const LAST_SPAN_ROUNDS = 5;

/** Hosts or services per grouped query (MAX_INTERNAL_SERIES_LIMIT is 2000, one series each). */
const SOURCE_CHUNK = 500;
/** Raw series one internal query may read before space aggregation is skipped (query service internal.maxRawSeries, up to 20000). */
const SOURCE_MAX_RAW_SERIES = 20_000;
/** Spans looked up one by one per project once the batched rounds left services unresolved. */
const LAST_SPAN_SINGLE_LOOKUPS = 100;

/** Internal options of a grouped query over `limit` sources: every source its own series, no raw series cap. */
function sourceInternal(limit: number): ResolvedMetricQuery['internal'] {
  return { maxSeries: limit, maxRawSeries: SOURCE_MAX_RAW_SERIES };
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
 * Metric names a source sent in the window: one reservoir call that keeps the
 * names with at least one point whose resource attribute equals the source.
 */
export async function sourceMetricNames(ctx: SourcesContext, key: string, value: string): Promise<string[]> {
  if (ctx.projectIds.length === 0) return [];
  const res = await reservoir.getMetricNames({
    organizationId: ctx.organizationId,
    projectId: ctx.projectIds,
    from: ctx.from,
    to: ctx.to,
    limit: MAX_METRIC_NAMES,
    filters: [{ scope: 'resource', key, op: 'eq', values: [value] }],
  });
  return [...new Set(res.names.map((n) => n.name))].sort();
}

// ---------------------------------------------------------------------------
// Host signals
// ---------------------------------------------------------------------------

type SignalMap = Map<string, SourceSignalValue>;

async function runSignal(
  ctx: SourcesContext,
  def: SourceSignalDef,
  hostNames: string[],
  /** hostNames is not every host of the scope (a single host page). */
  subset: boolean,
): Promise<SignalMap> {
  const out: SignalMap = new Map();
  const interval = pickInterval(ctx.to.getTime() - ctx.from.getTime(), SOURCE_SPARK_POINTS);
  const label = 'resource.host.name';
  const chunks = chunked(hostNames, SOURCE_CHUNK);

  // One grouped query per chunk of hosts (a single one up to SOURCE_CHUNK hosts).
  await mapLimit(chunks, 2, async (chunk) => {
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
          // With `limit` an unscoped query keeps the busiest hosts of the scope, so a
          // subset (one host page) or a chunk must name its hosts.
          filters: [
            ...(def.filters ?? []),
            ...(subset || chunks.length > 1 ? [{ scope: 'resource' as const, key: 'host.name', op: 'in' as const, values: chunk }] : []),
          ],
          groupBy: [{ scope: 'resource', key: 'host.name' }],
          limit: chunk.length,
        },
      ],
      // Every host is its own series and every raw series (hosts x mountpoints, interfaces) is read,
      // so the space aggregation (max of disks, sum of interfaces) is never skipped.
      internal: sourceInternal(chunk.length),
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

async function loadHostSignals(
  ctx: SourcesContext,
  hostNames: string[],
  subset: boolean,
): Promise<Record<HostSignal, SignalMap>> {
  const keys = Object.keys(HOST_SIGNALS) as HostSignal[];
  const maps = await Promise.all(keys.map((k) => runSignal(ctx, HOST_SIGNALS[k], hostNames, subset)));
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
    loadHostSignals(ctx, names, only !== undefined),
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
    // The os-release name (agent 1.2.0+) reads better than the kernel version.
    const os =
      hw.map((h) => infoString(h.info, 'os')).find(Boolean) ??
      hw.map((h) => infoString(h.info, 'kernel')).find(Boolean) ??
      null;
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
      hardwareHosts: hw.map((h) => ({ projectId: h.projectId, id: h.id, isVirtual: h.isVirtual })),
      services: (s.co['service.name'] ?? []).filter((n) => real.has(n)),
      os,
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
    info.os ??= infoString(h.info, 'os');
    if (h.isVirtual !== null) info.virtual ??= h.isVirtual;
  }
  if (!info.os && info.kernel) info.os = info.kernel;

  // Memory size, uptime and CPU count ride on one query run (last value in the window).
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
        // agent 1.2.0+
        { id: 'C', metricName: 'system.cpu.logical.count', aggregation: 'last', spaceAggregation: 'max', filters: [hostFilter], groupBy: [] },
      ],
    });
    const pick = (id: string): number | null =>
      res.series.find((s) => s.queryId === id && !s.comparison)?.stats.last ?? null;
    const mem = pick('A');
    const up = pick('B');
    const cpus = pick('C');
    if (mem !== null) info.memoryBytes = mem;
    if (up !== null) info.uptimeSeconds = up;
    if (cpus !== null && cpus > 0) info.cpuCount = Math.round(cpus);
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

interface SpanTrend {
  rate: Array<number | null>;
  errors: Array<number | null>;
  p95: Array<number | null>;
}

interface SpanData {
  /** Every service with spans in the window. */
  services: Set<string>;
  /** Entry-span stats (every span for a service the engine returned no entry stats for). */
  stats: Map<string, SpanStats>;
  trends: Map<string, SpanTrend>;
  /** ms of the newest span of each service. */
  lastSeen: Map<string, number>;
}

interface Acc {
  calls: number;
  errors: number;
  ops: OperationStat[];
}

function accumulate(into: Map<string, Acc>, rows: OperationStat[], only?: string, skip?: Set<string>): void {
  for (const r of rows) {
    if (only !== undefined && r.service !== only) continue;
    if (skip?.has(r.service)) continue;
    const cur = into.get(r.service) ?? { calls: 0, errors: 0, ops: [] };
    cur.calls += r.count;
    cur.errors += r.errorCount;
    cur.ops.push(r);
    into.set(r.service, cur);
  }
}

/**
 * Newest span time per service (spans are observed on end_time). The reservoir
 * has no "max end time per service" call, so each project is asked for its
 * newest spans of the services still unresolved, a few rounds at most (a round
 * resolves every service that shows up in the newest LAST_SPAN_BATCH spans).
 * Services the rounds did not resolve are looked up one by one (a bounded
 * number per project). Only past that bound a service is reported at the start
 * of its newest active slice, which can only make it look older, never fresher.
 */
async function loadLastSeen(
  ctx: SourcesContext,
  perProject: Map<string, string[]>,
  fallback: Map<string, number>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await mapLimit([...perProject.entries()], CONCURRENCY, async ([projectId, services]) => {
    const remaining = new Set(services);
    const newest = (serviceNames: string[], limit: number) =>
      reservoir.querySpans({
        projectId,
        serviceName: serviceNames,
        from: ctx.from,
        to: ctx.to,
        sortBy: 'end_time',
        sortOrder: 'desc',
        limit,
      });
    for (let round = 0; round < LAST_SPAN_ROUNDS && remaining.size > 0; round++) {
      let rows;
      try {
        rows = await newest([...remaining], LAST_SPAN_BATCH);
      } catch {
        break;
      }
      let progressed = false;
      for (const span of rows.spans) {
        if (!remaining.has(span.serviceName)) continue;
        // Sorted newest first: the first span of a service is its newest.
        out.set(span.serviceName, Math.max(out.get(span.serviceName) ?? 0, span.endTime.getTime()));
        remaining.delete(span.serviceName);
        progressed = true;
      }
      if (!progressed) break;
    }
    // Quiet services the newest-span rounds never reached: one bounded lookup each.
    await mapLimit([...remaining].slice(0, LAST_SPAN_SINGLE_LOOKUPS), CONCURRENCY, async (svc) => {
      try {
        const rows = await newest([svc], 1);
        const span = rows.spans.find((x) => x.serviceName === svc);
        if (span) {
          out.set(svc, Math.max(out.get(svc) ?? 0, span.endTime.getTime()));
          remaining.delete(svc);
        }
      } catch {
        // Stays unresolved: falls back to the slice start below.
      }
    });
    for (const svc of remaining) {
      const f = fallback.get(svc);
      if (f !== undefined) out.set(svc, Math.max(out.get(svc) ?? 0, f));
    }
  });
  return out;
}

/**
 * Span data of every service with a bounded number of reservoir calls per
 * project (health stats, entry stats of the window, one entry stats call per
 * spark slice, a few newest-span rounds), whatever the number of services.
 * Entry spans (server/consumer kinds, roots when a scope has none) feed the
 * headline and the spark alike; getServiceHealthStats (every span) discovers
 * the services and covers any the entry stats missed.
 */
async function loadSpanData(ctx: SourcesContext, only?: string): Promise<SpanData> {
  const health = new Map<string, SpanStats>();
  const perProject = new Map<string, string[]>();
  await mapLimit(ctx.projectIds, CONCURRENCY, async (projectId) => {
    const rows = await reservoir.getServiceHealthStats(projectId, ctx.from, ctx.to);
    const names: string[] = [];
    for (const r of rows) {
      if (only !== undefined && r.serviceName !== only) continue;
      names.push(r.serviceName);
      const cur = health.get(r.serviceName) ?? { calls: 0, errors: 0, p95: null };
      cur.calls += r.totalCalls;
      cur.errors += r.totalErrors;
      // Percentiles do not add across projects: keep the worst one.
      if (r.p95LatencyMs !== null && (cur.p95 === null || r.p95LatencyMs > cur.p95)) cur.p95 = r.p95LatencyMs;
      health.set(r.serviceName, cur);
    }
    if (names.length > 0) perProject.set(projectId, names);
  });
  const result: SpanData = { services: new Set(health.keys()), stats: new Map(), trends: new Map(), lastSeen: new Map() };
  if (health.size === 0) return result;
  const activeProjects = [...perProject.keys()];

  const opParams = (projectId: string, from: Date, to: Date) => ({
    projectId,
    ...(only !== undefined ? { service: only } : {}),
    from,
    to,
    limit: OPERATION_STATS_MAX_LIMIT,
  });

  // Headline: entry spans over the whole window, one call per project.
  // The entry-span scope (and its root span fallback) is the whole project call, so a project that has
  // server spans for some services returns nothing for the others, and a project with more than the
  // operation limit truncates. Those services are computed one by one (same call as the detail view,
  // so list and detail agree).
  const entry = new Map<string, Acc>();
  const perService = new Map<string, Set<string>>();
  await mapLimit(activeProjects, CONCURRENCY, async (projectId) => {
    let rows: OperationStat[];
    try {
      rows = await reservoir.getOperationStats(opParams(projectId, ctx.from, ctx.to));
    } catch {
      // Engine without entry-span stats: its services fall back to every span below.
      return;
    }
    const names = perProject.get(projectId) ?? [];
    const seen = new Set(rows.map((r) => r.service));
    const truncated = rows.length >= OPERATION_STATS_MAX_LIMIT;
    // With a service filter the project call already is the per service call.
    const need = new Set(only !== undefined ? [] : names.filter((n) => truncated || !seen.has(n)));
    perService.set(projectId, need);
    accumulate(entry, rows, only, need);
    await mapLimit([...need], CONCURRENCY, async (svc) => {
      try {
        accumulate(
          entry,
          await reservoir.getOperationStats({ projectId, service: svc, from: ctx.from, to: ctx.to, limit: OPERATION_STATS_MAX_LIMIT }),
          svc,
        );
      } catch {
        // This service falls back to every span.
      }
    });
  });
  for (const [svc, h] of health) {
    const e = entry.get(svc);
    result.stats.set(
      svc,
      e && e.calls > 0 ? { calls: e.calls, errors: e.errors, p95: mixturePercentile(e.ops, 0.95) } : h,
    );
  }

  // Spark: the same entry spans, one call per project and slice for all services at once.
  const slices = sliceWindow(ctx.from.getTime(), ctx.to.getTime(), SOURCE_SPARK_POINTS);
  const perSlice: Array<Map<string, Acc>> = slices.map(() => new Map());
  const jobs: Array<{ projectId: string; slice: number }> = [];
  for (const projectId of activeProjects) for (let i = 0; i < slices.length; i++) jobs.push({ projectId, slice: i });
  if (entry.size > 0) {
    await mapLimit(jobs, CONCURRENCY, async ({ projectId, slice }) => {
      try {
        const rows = await reservoir.getOperationStats(
          opParams(projectId, new Date(slices[slice].from), new Date(slices[slice].to)),
        );
        accumulate(perSlice[slice], rows, only, perService.get(projectId));
      } catch {
        // A slice that fails stays empty: the spark shows a gap, the headline is unaffected.
      }
    });
    // Services computed one by one for the headline get their spark the same way.
    const singles: Array<{ projectId: string; svc: string; slice: number }> = [];
    for (const [projectId, need] of perService) {
      for (const svc of need) for (let i = 0; i < slices.length; i++) singles.push({ projectId, svc, slice: i });
    }
    await mapLimit(singles, CONCURRENCY, async ({ projectId, svc, slice }) => {
      try {
        const rows = await reservoir.getOperationStats({
          projectId,
          service: svc,
          from: new Date(slices[slice].from),
          to: new Date(slices[slice].to),
          limit: OPERATION_STATS_MAX_LIMIT,
        });
        accumulate(perSlice[slice], rows, svc);
      } catch {
        // Gap in the spark.
      }
    });
  }
  const sliceSeconds = slices.map((s) => Math.max(1, (s.to - s.from + 1) / 1000));
  const lastActive = new Map<string, number>();
  for (const svc of entry.keys()) {
    const rate: Array<number | null> = [];
    const errors: Array<number | null> = [];
    const p95: Array<number | null> = [];
    perSlice.forEach((m, i) => {
      const acc = m.get(svc);
      if (!acc || acc.calls === 0) {
        rate.push(0);
        errors.push(null);
        p95.push(null);
        return;
      }
      lastActive.set(svc, slices[i].from);
      rate.push(acc.calls / sliceSeconds[i]);
      errors.push((acc.errors / acc.calls) * 100);
      p95.push(mixturePercentile(acc.ops, 0.95));
    });
    result.trends.set(svc, { rate, errors, p95 });
  }

  result.lastSeen = await loadLastSeen(ctx, perProject, lastActive);
  return result;
}

/** RED from HTTP server metrics for services without spans (newest semconv first, legacy name for the rest). */
async function loadMetricRed(ctx: SourcesContext, candidates: string[]): Promise<Map<string, MetricRed>> {
  const out = new Map<string, MetricRed>();
  let remaining = candidates;
  const interval = pickInterval(ctx.to.getTime() - ctx.from.getTime(), SOURCE_SPARK_POINTS);
  for (const variant of HTTP_SERVER_METRICS) {
    if (remaining.length === 0) break;
    // One query per semconv variant and chunk of remaining services.
    await mapLimit(chunked(remaining, SOURCE_CHUNK), 2, async (chunk) => {
      const svc = { scope: 'resource' as const, key: 'service.name', op: 'in' as const, values: chunk };
      const groupBy = [{ scope: 'resource' as const, key: 'service.name' }];
      const limit = chunk.length;
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
            { id: 'A', metricName: variant.metricName, aggregation: 'rate', spaceAggregation: 'sum', filters: [svc], groupBy, limit },
            {
              id: 'B',
              metricName: variant.metricName,
              aggregation: 'rate',
              spaceAggregation: 'sum',
              filters: [svc, { scope: 'metric', key: variant.statusKey, op: 'gte', values: ['500'] }],
              groupBy,
              limit,
            },
            { id: 'C', metricName: variant.metricName, aggregation: 'p95', spaceAggregation: 'avg', filters: [svc], groupBy, limit },
          ],
          internal: sourceInternal(limit),
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
  const [metricSources, spans] = await Promise.all([
    fetchSources(ctx, 'service.name', { coKeys: ['host.name'], excludeMetricPrefixes: [...HOST_METRIC_PREFIXES] }),
    loadSpanData(ctx, only),
  ]);
  const byName = new Map(metricSources.map((s) => [s.value, s]));
  let names = [...new Set([...byName.keys(), ...spans.services])].sort();
  if (only !== undefined) names = names.filter((n) => n === only);

  const windowSec = Math.max(1, (ctx.to.getTime() - ctx.from.getTime()) / 1000);
  const now = ref(ctx);

  const metricRed = await loadMetricRed(
    ctx,
    names.filter((n) => (spans.stats.get(n)?.calls ?? 0) === 0 && (byName.get(n)?.metricCount ?? 0) > 0),
  );

  return names.map((name): ServiceSourceSummary => {
    const m = byName.get(name);
    const st = spans.stats.get(name);
    const trend = spans.trends.get(name);
    const hasTraces = !!st && st.calls > 0;
    const red = hasTraces ? null : (metricRed.get(name) ?? null);
    const redSource: ServiceSourceSummary['redSource'] = hasTraces ? 'traces' : red ? 'metrics' : null;
    const errorPct = hasTraces ? (st.errors / st.calls) * 100 : (red?.errorRate.value ?? null);
    const lastSeenMs = Math.max(m?.lastSeen.getTime() ?? 0, spans.lastSeen.get(name) ?? 0) || ctx.from.getTime();
    const { status, reason } = computeServiceStatus({ now, lastSeen: lastSeenMs, errorRate: errorPct });
    return {
      kind: 'service',
      name,
      projectIds: m?.projectIds ?? ctx.projectIds,
      lastSeen: new Date(lastSeenMs).toISOString(),
      status,
      statusReason: reason,
      redSource,
      // Window rate: entry spans of the whole window over the window length.
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

export type DashboardCreateInput = Parameters<typeof customDashboardsService.create>[0];

export function createDashboard(input: DashboardCreateInput, userId: string) {
  return customDashboardsService.create(input, userId);
}

/** Dashboard names are capped at 200 characters by the dashboards API. */
const DASHBOARD_NAME_MAX = 200;

export function buildCustomizeInput(
  kind: MetricSourceKind,
  name: string,
  organizationId: string,
  metricNames: string[],
  projectIds: string[] | null,
): DashboardCreateInput & { variables: DashboardVariable[]; panels: PanelInstance[] } {
  const template = SOURCE_TEMPLATES[kind];
  // Concatenation, not String.replace: the source name is user data and "$&" style patterns must stay literal.
  const [head, tail = ''] = template.dashboardName.split('{name}');
  const room = Math.max(1, DASHBOARD_NAME_MAX - head.length - tail.length);
  const dashboardName = `${head}${name.slice(0, room)}${tail}`;
  return {
    organizationId,
    projectId: null,
    name: dashboardName,
    panels: buildDashboardPanels(template, metricNames, projectIds, () => `panel-${randomUUID()}`),
    variables: [{ ...template.variable, default: name }],
  };
}
