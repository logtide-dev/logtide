// 1.8 metrics query service: the one evaluator behind the explorer
// (POST /api/v1/metrics/query), the `metrics` dashboard panel, the source
// views (POST /api/v1/metrics/panels/data), metric alerts and the sources
// headline signals.
//
// CONTRACT (fixed by the lead; the implementation replaces the bodies):
// - resolveProjectScope: projectIds null -> every non-deleted project of the
//   organization; explicit ids must all belong to it and the user must be a
//   member of the organization, else MetricScopeError (routes map it to 403).
// - metricQueryService.run: evaluates an already-authorized query, semantics
//   in docs/superpowers/specs/2026-11-25-metrics-1.8-design.md ("Query service").
//
// Per query: the engine aggregates per series (time aggregation), grouped by
// the requested groupBy plus the series identity (project, metric label keys
// and the resource keys that identify a sender); this service then turns
// counters into rates, combines the series of each group (space
// aggregation), keeps the top N and folds the rest. Formulas work on the
// unfolded groups and fold their own result. compareTo copies run the same.
//
// When the time and space aggregations compose exactly (sum/sum, count/sum,
// min/min, max/max) the per-series step changes nothing, so the engine
// aggregates each group directly: no identity discovery, and the engine can
// answer from its rollups when the query has no group by and no filters.
//
// Histograms (catalog or engine type histogram / exp_histogram) take their
// own path: the engine returns one histogram per bucket and series
// (hist_last for cumulative temporality, then diffed here; hist_sum for
// delta), series are merged per group and reduced to the requested
// aggregation (histogram.ts). Sums use their temporality for `rate`:
// cumulative = diff of the last value per bucket, delta = bucket sum /
// bucket seconds.

import type {
  MetricAttrFilter,
  MetricAttrRef,
  MetricFormulaSpec,
  MetricQueryInfo,
  MetricQueryRequest,
  MetricQueryResponse,
  MetricQuerySpec,
  MetricSeries,
  MetricSpaceAggregation,
  MetricTimeAggregation,
} from '@logtide/shared';
import { defaultSpaceAggregation, metricAttrLabel, METRIC_DEFAULT_SERIES_LIMIT, METRIC_MAX_SERIES_LIMIT } from '@logtide/shared';
import type { MetricAggregationFn, MetricTimeBucket } from '@logtide/reservoir';
import { reservoir } from '../../../database/reservoir.js';
import { MetricQueryValidationError, MetricScopeError } from './errors.js';
import { resolveProjectScope } from './scope.js';
import { buildGrid, QUERY_INTERVAL_MS, resolveInterval, type QueryInterval } from './interval.js';
import {
  applyDeltaRate,
  applyRate,
  bucketsToSeries,
  combineSeries,
  computeStats,
  foldTopNWith,
  labelKey,
  lastValue,
  OTHER_LABEL,
  pickLabels,
  spaceAggregate,
  topByRecent,
  type FoldResult,
  type GridSeries,
} from './series-fold.js';
import {
  evaluateFormulaFolded,
  formulaRefs,
  formulaUnit,
  parseFormula,
  FormulaError,
  type FormulaNode,
  type FormulaOperand,
} from './formula.js';
import { compareOffsetMs, shiftWindow } from './compare.js';
import { resolveFilterVariables } from './variables.js';
import { windowError } from './schema.js';
import {
  effectiveTemporality,
  isHistogramType,
  loadCatalog,
  queryResultUnit,
  resolveUnit,
  type CatalogInfo,
  type CatalogLookup,
} from './units.js';
import {
  cumulativeToDelta,
  dropOpenBuckets,
  histBucketsToSeries,
  histogramScalar,
  histSeriesToScalar,
  mergeHistSeries,
  type HistSeries,
} from './histogram.js';

export { MetricScopeError, MetricQueryValidationError, resolveProjectScope };

/** Highest per-query series limit an internal caller may ask for. */
export const MAX_INTERNAL_SERIES_LIMIT = 2000;
/** Most groups an unfolded query or formula returns; the rest are dropped with a warning. */
export const MAX_UNFOLDED_GROUPS = 1000;

/** A query whose project scope is already resolved and authorized. */
export interface ResolvedMetricQuery extends Omit<MetricQueryRequest, 'projectIds'> {
  projectIds: string[];
  /**
   * Server-side callers only (sources signals, metric alerts): never
   * accepted from an HTTP body (the request schemas strip it).
   * - maxSeries raises the per-query series limit cap from
   *   METRIC_MAX_SERIES_LIMIT up to MAX_INTERNAL_SERIES_LIMIT, so `limit`
   *   can cover every host or service.
   * - unfoldedGroups returns every group of a grouped query or formula, with
   *   no top-N cap and no folded "Other" series (metric alerts evaluate every
   *   group before ranking them by the alert direction). At most
   *   MAX_UNFOLDED_GROUPS groups are returned (first ones by labels), the
   *   rest are dropped with a warning (the most extreme ones in the `rank`
   *   direction are kept, else the first ones by labels).
   * - maxRawSeries raises MAX_RAW_SERIES for this query, up to
   *   MAX_INTERNAL_RAW_SERIES, on every cap path (counter rates, cumulative
   *   histograms, the one-step fallback), so the per-series path and its
   *   space aggregation run for every series up to that many.
   * - rank (metric alerts): the direction the caller watches. Series are
   *   then never dropped by a recent value and the query never switches to
   *   the one-step aggregation: above the raw series cap every group is
   *   still computed per series and the groups kept are the most extreme
   *   ones in that direction (mean of the points from `rank.from` on). Any
   *   dropped group is reported by a partial result warning
   *   (isPartialResultWarning).
   */
  internal?: {
    maxSeries?: number;
    unfoldedGroups?: boolean;
    maxRawSeries?: number;
    rank?: { direction: 'highest' | 'lowest'; from?: string };
  };
}

/** Above this many raw series a query is capped or aggregated by the engine in one step. */
export const MAX_RAW_SERIES = 500;
/** Highest raw series cap an internal caller may ask for (internal.maxRawSeries). */
export const MAX_INTERNAL_RAW_SERIES = 20000;
/** Engine calls one request runs at the same time (partitions, queries and compare copies together). */
export const MAX_ENGINE_CONCURRENCY = 4;
/** Ends every warning that means groups or series are missing from a result. */
export const PARTIAL_RESULT_NOTE = '(partial result)';

/** Whether a warning says the result of query or formula `id` misses groups or series. */
export function isPartialResultWarning(warning: string, id: string): boolean {
  return (
    (warning.startsWith(`Query ${id}:`) || warning.startsWith(`Formula ${id}:`)) && warning.endsWith(PARTIAL_RESULT_NOTE)
  );
}

/** Runs async work with at most a fixed number of tasks in flight. */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** FIFO limiter: a released slot goes straight to the next waiter, so the bound is never exceeded. */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
/** Metric attribute keys used to tell series apart (the first ones in byte order). */
export const MAX_IDENTITY_METRIC_KEYS = 10;
/** Resource keys that identify who sent a series (used when present). */
export const IDENTITY_RESOURCE_KEYS = [
  'service.namespace',
  'service.name',
  'service.instance.id',
  'host.name',
  'host.id',
  'container.id',
  'k8s.namespace.name',
  'k8s.node.name',
  'k8s.pod.name',
  'k8s.pod.uid',
  'process.pid',
  'faas.instance',
];
/** Projects read one by one to tell their series apart; more share one read. */
export const MAX_PROJECT_PARTITIONS = 20;
/** Identity keys are discovered over the last part of the window only. */
export const KEY_DISCOVERY_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Series label carrying the project partition (never part of a group). */
export const PROJECT_IDENTITY_LABEL = '__project__';
const RESOURCE_KEY_DISCOVERY_LIMIT = 500;

interface WindowContext {
  organizationId: string;
  projectIds: string[];
  /** Window read from storage. */
  from: Date;
  to: Date;
  /** Current-window grid the results land on. */
  grid: number[];
  stepMs: number;
  interval: QueryInterval;
  /** Added to engine bucket times (compareTo copies). */
  shiftMs: number;
  /** Grid buckets ending after this are still open (partial). */
  openAfterMs: number;
  /** Cap of a query's series limit. */
  maxSeries: number;
  /** Keep every group (no top-N fold), up to MAX_UNFOLDED_GROUPS. */
  unfoldedGroups: boolean;
  /** Raw series above which a query is capped (MAX_RAW_SERIES unless raised). */
  maxRawSeries: number;
  /** Alert direction (internal.rank) with the grid index its mean starts at. */
  rank: { direction: 'highest' | 'lowest'; fromIndex: number } | null;
  /** Every engine call of the request goes through it. */
  engine: Limiter;
}

/** One query evaluated: its groups before the top-N fold. */
interface QueryResult {
  /** One series per group (unfolded); a single {} series when ungrouped. */
  groups: GridSeries[];
  /** Fold some groups into one series the way the query combines series. */
  combine: (members: GridSeries[]) => GridSeries;
  limit: number;
  grouped: boolean;
  metricType: string | null;
  /** Catalog info, or what the engine told about an uncatalogued metric. */
  info?: CatalogInfo;
  warnings: string[];
}

const OTHER_LABELS = { [OTHER_LABEL]: 'true' };

function dedupeRefs(refs: MetricAttrRef[]): MetricAttrRef[] {
  const seen = new Set<string>();
  const out: MetricAttrRef[] = [];
  for (const r of refs) {
    const key = `${r.scope}:${r.key}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function labelKeys(
  ctx: WindowContext,
  metricName: string,
  scope: 'metric' | 'resource',
  limit: number,
  from: Date,
  to: Date,
): Promise<string[]> {
  try {
    const result = await ctx.engine(() =>
      reservoir.getMetricLabelKeys({
        organizationId: ctx.organizationId,
        projectId: ctx.projectIds,
        metricName,
        from,
        to,
        limit,
        scope,
      }),
    );
    return [...(result?.keys ?? [])].sort(byteOrder);
  } catch {
    // An engine without resource-scope discovery still answers the query,
    // only less finely split.
    return [];
  }
}

/**
 * Identity keys of a metric over the whole window: the last
 * KEY_DISCOVERY_WINDOW_MS and, when the window is longer, the earlier part,
 * unioned (a key seen only early in the window still tells series apart;
 * without it they would be merged). Each read is bounded by key count: the
 * first MAX_IDENTITY_METRIC_KEYS + 1 metric keys in byte order (enough to
 * pick the first ones of the union and to know there are more) and
 * RESOURCE_KEY_DISCOVERY_LIMIT resource keys.
 */
async function discoverKeys(ctx: WindowContext, metricName: string): Promise<{ metric: string[]; resource: string[] }> {
  const read = (from: Date, to: Date) =>
    Promise.all([
      labelKeys(ctx, metricName, 'metric', MAX_IDENTITY_METRIC_KEYS + 1, from, to),
      labelKeys(ctx, metricName, 'resource', RESOURCE_KEY_DISCOVERY_LIMIT, from, to),
    ]);
  const recentFrom = new Date(Math.max(ctx.from.getTime(), ctx.to.getTime() - KEY_DISCOVERY_WINDOW_MS));
  const reads = [read(recentFrom, ctx.to)];
  if (recentFrom.getTime() > ctx.from.getTime()) reads.push(read(ctx.from, recentFrom));
  const parts = await Promise.all(reads);
  const union = (lists: string[][]) => [...new Set(lists.flat())].sort(byteOrder);
  return { metric: union(parts.map((p) => p[0])), resource: union(parts.map((p) => p[1])) };
}

async function seriesIdentity(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  groupRefs: MetricAttrRef[],
  warnings: string[],
): Promise<MetricAttrRef[]> {
  const keys = await discoverKeys(ctx, spec.metricName);
  if (keys.metric.length > MAX_IDENTITY_METRIC_KEYS) {
    warnings.push(
      `Query ${spec.id}: more than ${MAX_IDENTITY_METRIC_KEYS} attribute keys, series are told apart by the first ${MAX_IDENTITY_METRIC_KEYS}`,
    );
  }
  const resource = new Set(keys.resource);
  return dedupeRefs([
    ...groupRefs,
    ...keys.metric.slice(0, MAX_IDENTITY_METRIC_KEYS).map((key) => ({ scope: 'metric' as const, key })),
    ...IDENTITY_RESOURCE_KEYS.filter((k) => resource.has(k)).map((key) => ({ scope: 'resource' as const, key })),
  ]);
}

/**
 * Project partitions of a per-series read: the projects the catalog lists
 * for the metric are read one by one (their series never mix), the others
 * together. Without catalog rows the projects are read together.
 */
function projectPartitions(ctx: WindowContext, spec: MetricQuerySpec, info: CatalogInfo | undefined, warnings: string[]): string[][] {
  if (ctx.projectIds.length <= 1) return [ctx.projectIds];
  const inScope = new Set(ctx.projectIds);
  const known = (info?.projectIds ?? []).filter((p) => inScope.has(p));
  if (known.length === 0) return [ctx.projectIds];
  if (known.length > MAX_PROJECT_PARTITIONS) {
    warnings.push(
      `Query ${spec.id}: sent by more than ${MAX_PROJECT_PARTITIONS} projects, series of the least recent ones are read together`,
    );
  }
  const own = known.slice(0, MAX_PROJECT_PARTITIONS);
  const ownSet = new Set(own);
  const rest = ctx.projectIds.filter((p) => !ownSet.has(p));
  return [...own.map((p) => [p]), ...(rest.length > 0 ? [rest] : [])];
}

async function aggregate(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  filters: MetricAttrFilter[],
  aggregation: MetricAggregationFn,
  groupByAttrs: MetricAttrRef[],
  projectIds: string[] = ctx.projectIds,
): Promise<{ timeseries: MetricTimeBucket[]; metricType: string | null }> {
  const result = await ctx.engine(() =>
    reservoir.aggregateMetrics({
      organizationId: ctx.organizationId,
      projectId: projectIds,
      metricName: spec.metricName,
      from: ctx.from,
      to: ctx.to,
      interval: ctx.interval,
      aggregation,
      groupByAttrs: groupByAttrs.length > 0 ? groupByAttrs : undefined,
      filters: filters.length > 0 ? filters : undefined,
    }),
  );
  const timeseries = result?.timeseries ?? [];
  return { timeseries, metricType: timeseries.length > 0 ? (result?.metricType ?? null) : null };
}

/** Per-series read: one engine call per project partition, partitions labelled apart. */
async function fetchPerSeries(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  filters: MetricAttrFilter[],
  aggregation: MetricAggregationFn,
  identityRefs: MetricAttrRef[],
  partitions: string[][],
): Promise<{ timeseries: MetricTimeBucket[]; metricType: string | null }> {
  if (partitions.length <= 1) return aggregate(ctx, spec, filters, aggregation, identityRefs);
  const parts = await Promise.all(partitions.map((p) => aggregate(ctx, spec, filters, aggregation, identityRefs, p)));
  const timeseries: MetricTimeBucket[] = [];
  parts.forEach((part, i) => {
    for (const b of part.timeseries) {
      timeseries.push({ ...b, labels: { ...(b.labels ?? {}), [PROJECT_IDENTITY_LABEL]: String(i) } });
    }
  });
  return { timeseries, metricType: parts.find((p) => p.metricType)?.metricType ?? null };
}

/** The cap of the series limit: the public one unless an internal caller raised it. */
export function seriesLimitCap(internal: ResolvedMetricQuery['internal']): number {
  const asked = internal?.maxSeries;
  if (typeof asked !== 'number' || !Number.isFinite(asked)) return METRIC_MAX_SERIES_LIMIT;
  return Math.min(Math.max(Math.floor(asked), METRIC_MAX_SERIES_LIMIT), MAX_INTERNAL_SERIES_LIMIT);
}

/** The raw series cap: MAX_RAW_SERIES unless an internal caller raised it (never lowered). */
export function rawSeriesCap(internal: ResolvedMetricQuery['internal']): number {
  const asked = internal?.maxRawSeries;
  if (typeof asked !== 'number' || !Number.isFinite(asked)) return MAX_RAW_SERIES;
  return Math.min(Math.max(Math.floor(asked), MAX_RAW_SERIES), MAX_INTERNAL_RAW_SERIES);
}

/** internal.rank on the grid: the first bucket at or after `rank.from` (0 without one). */
function rankOf(rank: NonNullable<ResolvedMetricQuery['internal']>['rank'], grid: number[]): WindowContext['rank'] {
  if (!rank || (rank.direction !== 'highest' && rank.direction !== 'lowest')) return null;
  const fromMs = rank.from ? Date.parse(rank.from) : Number.NaN;
  let fromIndex = 0;
  if (Number.isFinite(fromMs)) {
    fromIndex = grid.findIndex((t) => t >= fromMs);
    if (fromIndex < 0) fromIndex = grid.length;
  }
  return { direction: rank.direction, fromIndex };
}

/** Mean of the non-null values from `fromIndex` on. */
function meanFrom(values: Array<number | null>, fromIndex: number): number | null {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, fromIndex); i < values.length; i++) {
    const v = values[i];
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}

/**
 * Groups most extreme first in the rank direction (highest mean first, or
 * lowest first), groups without a value last, ties by labels.
 */
export function rankGroups(
  groups: GridSeries[],
  rank: { direction: 'highest' | 'lowest'; fromIndex: number },
): GridSeries[] {
  const sign = rank.direction === 'highest' ? -1 : 1;
  return groups
    .map((g) => ({ g, mean: meanFrom(g.values, rank.fromIndex), key: labelKey(g.labels) }))
    .sort((a, b) => {
      if (a.mean !== b.mean) {
        if (a.mean === null) return 1;
        if (b.mean === null) return -1;
        return sign * (a.mean - b.mean);
      }
      return byteOrder(a.key, b.key);
    })
    .map((r) => r.g);
}

/**
 * Raw series cap of a ranked (alert) query: every group was computed from
 * all its series; keep the most extreme groups whose raw series fit in the
 * cap (the first one always), drop the rest with a partial result warning.
 * A kept group is never computed from a subset of its series.
 */
function capRankedGroups(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  result: QueryResult,
  rawLabels: Array<Record<string, string>>,
  groupLabels: string[],
): QueryResult {
  const rank = ctx.rank!;
  const perGroup = new Map<string, number>();
  for (const labels of rawLabels) {
    const key = labelKey(pickLabels(labels, groupLabels));
    perGroup.set(key, (perGroup.get(key) ?? 0) + 1);
  }
  const kept: GridSeries[] = [];
  let used = 0;
  for (const g of rankGroups(result.groups, rank)) {
    const n = perGroup.get(labelKey(g.labels)) ?? 0;
    if (kept.length > 0 && used + n > ctx.maxRawSeries) continue;
    kept.push(g);
    used += n;
  }
  if (kept.length < result.groups.length) {
    result.warnings.push(
      `Query ${spec.id}: more than ${ctx.maxRawSeries} series, only the ${kept.length} ${rank.direction} groups are evaluated ${PARTIAL_RESULT_NOTE}`,
    );
  }
  return { ...result, groups: kept };
}

function seriesLimit(ctx: WindowContext, spec: MetricQuerySpec): number {
  return Math.min(Math.max(1, spec.limit ?? METRIC_DEFAULT_SERIES_LIMIT), ctx.maxSeries);
}

/**
 * Whether aggregating each group directly gives the same numbers as the
 * per-series time aggregation followed by the space aggregation.
 */
export function singleLevelIsExact(time: MetricTimeAggregation, space: MetricSpaceAggregation): boolean {
  return (
    (time === 'sum' && space === 'sum') ||
    (time === 'count' && space === 'sum') ||
    (time === 'min' && space === 'min') ||
    (time === 'max' && space === 'max')
  );
}

function nullSeries(labels: Record<string, string>, length: number): GridSeries {
  return { labels, values: new Array(length).fill(null) };
}

/** Last non-null histogram count of a series (cap ranking). */
function lastHistCount(s: HistSeries): number | null {
  for (let i = s.values.length - 1; i >= 0; i--) {
    const h = s.values[i];
    if (h) return h.count;
  }
  return null;
}

/**
 * Histogram metrics: per-series histograms from the engine, cumulative
 * snapshots diffed into per-bucket deltas, merged per group (union of bounds)
 * and reduced to the aggregation. `rate` is count / seconds per series, then
 * combined with the space aggregation like counters. Other aggregations
 * merge histograms, so the space aggregation does not apply to them.
 */
async function evaluateHistogramQuery(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  filters: MetricAttrFilter[],
  info: CatalogInfo,
): Promise<QueryResult> {
  const warnings: string[] = [];
  const temporality = effectiveTemporality(info) ?? 'cumulative';
  const engineAgg: MetricAggregationFn = temporality === 'delta' ? 'hist_sum' : 'hist_last';
  const isRate = spec.aggregation === 'rate';
  const len = ctx.grid.length;
  const groupRefs = dedupeRefs(spec.groupBy);
  const groupLabels = groupRefs.map(metricAttrLabel);
  const identityRefs = await seriesIdentity(ctx, spec, groupRefs, warnings);
  const partitions = projectPartitions(ctx, spec, info, warnings);

  const perSeries = await fetchPerSeries(ctx, spec, filters, engineAgg, identityRefs, partitions);
  let metricType = perSeries.metricType;
  let series = histBucketsToSeries(perSeries.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);
  const hasIdentity = identityRefs.length > groupRefs.length || partitions.length > 1;
  const cap = ctx.maxRawSeries;
  // Ranked (alert) queries keep every series here and cap whole groups at the end.
  const rankedCap = series.length > cap && hasIdentity && ctx.rank !== null;
  if (series.length > cap && hasIdentity && !rankedCap) {
    if (temporality === 'delta') {
      // Delta histograms add up, so the engine can sum each group directly.
      warnings.push(`Query ${spec.id}: more than ${cap} series, histograms summed by the engine in one step`);
      const grouped = await aggregate(ctx, spec, filters, engineAgg, groupRefs);
      metricType = grouped.metricType ?? metricType;
      series = histBucketsToSeries(grouped.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);
    } else {
      // Cumulative snapshots must be diffed per series: keep the busiest ones.
      warnings.push(
        `Query ${spec.id}: more than ${cap} series, showing the ${cap} with the highest recent count ${PARTIAL_RESULT_NOTE}`,
      );
      series = topByRecent(series, cap, lastHistCount);
    }
  }
  const rawLabels = rankedCap ? series.map((s) => s.labels) : [];
  const finish = (r: QueryResult): QueryResult => (rankedCap ? capRankedGroups(ctx, spec, r, rawLabels, groupLabels) : r);
  const base = { limit: seriesLimit(ctx, spec), grouped: groupLabels.length > 0, metricType, info, warnings };
  if (series.length === 0) return { ...base, groups: [], combine: () => nullSeries(OTHER_LABELS, len) };

  if (temporality === 'cumulative') series = cumulativeToDelta(series, ctx.grid);

  if (isRate) {
    series = dropOpenBuckets(series, ctx.grid, ctx.stepMs, ctx.openAfterMs);
    const spaceAgg = spec.spaceAggregation ?? defaultSpaceAggregation('rate');
    return finish({
      ...base,
      groups: spaceAggregate(histSeriesToScalar(series, 'rate'), groupLabels, spaceAgg, len),
      combine: (members) => combineSeries(members, OTHER_LABELS, spaceAgg, len),
    });
  }

  const merged = mergeHistSeries(series, groupLabels, len);
  const byKey = new Map(merged.map((g) => [labelKey(g.labels), g]));
  const scalar = (g: HistSeries): Array<number | null> =>
    g.values.map((h, i) => histogramScalar(h, spec.aggregation, g.seconds[i]));
  return finish({
    ...base,
    groups: merged.map((g) => ({ labels: g.labels, values: scalar(g) })),
    // The rest of a histogram query is one merged histogram (a percentile of
    // the rest, not a sum of percentiles).
    combine: (members) => {
      const hs = members
        .map((m) => byKey.get(labelKey(m.labels)))
        .filter((h): h is HistSeries => !!h)
        .map((h) => ({ ...h, labels: {} }));
      const [one] = mergeHistSeries(hs, [], len);
      return one ? { labels: OTHER_LABELS, values: scalar(one) } : nullSeries(OTHER_LABELS, len);
    },
  });
}

async function evaluateQuery(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  filters: MetricAttrFilter[],
  info?: CatalogInfo,
): Promise<QueryResult> {
  if (info && isHistogramType(info.type)) return evaluateHistogramQuery(ctx, spec, filters, info);

  const warnings: string[] = [];
  const len = ctx.grid.length;
  const isRate = spec.aggregation === 'rate';
  // Delta sums: each point is already an increment, the rate is the bucket sum per second.
  const deltaRate = isRate && info?.type === 'sum' && effectiveTemporality(info) === 'delta';
  const engineAgg: MetricAggregationFn = isRate ? (deltaRate ? 'sum' : 'last') : (spec.aggregation as MetricAggregationFn);
  const spaceAgg = spec.spaceAggregation ?? defaultSpaceAggregation(spec.aggregation);
  const groupRefs = dedupeRefs(spec.groupBy);
  const groupLabels = groupRefs.map(metricAttrLabel);
  const done = (series: GridSeries[], metricType: string | null): QueryResult => ({
    groups: spaceAggregate(series, groupLabels, spaceAgg, len),
    combine: (members) => combineSeries(members, OTHER_LABELS, spaceAgg, len),
    limit: seriesLimit(ctx, spec),
    grouped: groupLabels.length > 0,
    metricType,
    info,
    warnings,
  });
  // A metric missing from the catalog may still be a histogram: the engine
  // tells its type, and histograms need their own math.
  const asHistogram = (metricType: string | null) =>
    !info && isHistogramType(metricType)
      ? evaluateHistogramQuery(ctx, spec, filters, { unit: null, type: metricType, temporality: null, isMonotonic: null })
      : null;

  if (!isRate && singleLevelIsExact(spec.aggregation as MetricTimeAggregation, spaceAgg)) {
    const direct = await aggregate(ctx, spec, filters, engineAgg, groupRefs);
    const hist = asHistogram(direct.metricType);
    if (hist) return hist;
    return done(bucketsToSeries(direct.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs), direct.metricType);
  }

  const identityRefs = await seriesIdentity(ctx, spec, groupRefs, warnings);
  const partitions = projectPartitions(ctx, spec, info, warnings);
  const perSeries = await fetchPerSeries(ctx, spec, filters, engineAgg, identityRefs, partitions);
  const hist = asHistogram(perSeries.metricType);
  if (hist) return hist;
  let metricType = perSeries.metricType;
  let series = bucketsToSeries(perSeries.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);

  const hasIdentity = identityRefs.length > groupRefs.length || partitions.length > 1;
  const cap = ctx.maxRawSeries;
  // Ranked (alert) queries keep every series here and cap whole groups at the end.
  const rankedCap = series.length > cap && hasIdentity && ctx.rank !== null;
  const rawLabels = rankedCap ? series.map((s) => s.labels) : [];
  if (series.length > cap && hasIdentity && !rankedCap) {
    if (isRate && !deltaRate) {
      // A counter rate is a diff per series: values of different series must
      // never be diffed against each other, so keep the busiest series.
      warnings.push(
        `Query ${spec.id}: more than ${cap} series, the rate covers the ${cap} with the highest recent value ${PARTIAL_RESULT_NOTE}`,
      );
      series = topByRecent(series, cap, (s) => lastValue(s.values));
    } else {
      // Let the engine aggregate each group directly (time aggregation
      // only, no space step).
      warnings.push(`Query ${spec.id}: more than ${cap} series, aggregated in one step (space aggregation skipped)`);
      const grouped = await aggregate(ctx, spec, filters, engineAgg, groupRefs);
      metricType = grouped.metricType ?? metricType;
      series = bucketsToSeries(grouped.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);
    }
  }

  if (isRate) {
    series = deltaRate
      ? applyDeltaRate(series, ctx.grid, ctx.stepMs, ctx.openAfterMs)
      : applyRate(series, ctx.grid, ctx.stepMs, ctx.openAfterMs);
  }
  const result = done(series, metricType);
  return rankedCap ? capRankedGroups(ctx, spec, result, rawLabels, groupLabels) : result;
}

/**
 * Every group, capped at MAX_UNFOLDED_GROUPS. With a rank (metric alerts)
 * the kept ones are the most extreme in the alert direction; without one,
 * the first by labels (byte order). Dropping groups is a partial result.
 */
function unfoldGroups(groups: GridSeries[], id: string, warnings: string[], rank: WindowContext['rank']): FoldResult {
  if (groups.length <= MAX_UNFOLDED_GROUPS) return { series: groups, seriesTotal: groups.length, seriesShown: groups.length };
  const ordered = rank
    ? rankGroups(groups, rank)
    : groups
        .map((g) => ({ g, key: labelKey(g.labels) }))
        .sort((a, b) => byteOrder(a.key, b.key))
        .map((x) => x.g);
  const which = rank ? `the ${MAX_UNFOLDED_GROUPS} ${rank.direction}` : `the first ${MAX_UNFOLDED_GROUPS}`;
  warnings.push(`${id}: more than ${MAX_UNFOLDED_GROUPS} groups, only ${which} are evaluated ${PARTIAL_RESULT_NOTE}`);
  const kept = ordered.slice(0, MAX_UNFOLDED_GROUPS);
  return { series: kept, seriesTotal: groups.length, seriesShown: kept.length };
}

/** Top-N fold of a query's groups for display (or every group when unfolded). */
function foldQuery(r: QueryResult, id: string, ctx: WindowContext, warnings: string[]): FoldResult {
  if (!r.grouped) return { series: r.groups, seriesTotal: r.groups.length, seriesShown: r.groups.length };
  if (ctx.unfoldedGroups) return unfoldGroups(r.groups, `Query ${id}`, warnings, ctx.rank);
  return foldTopNWith(r.groups, r.limit, r.combine);
}

interface Evaluated {
  queries: Map<string, QueryResult>;
  queryErrors: Map<string, string>;
  formulas: Map<string, FoldResult>;
  formulaErrors: Map<string, string>;
  warnings: string[];
}

async function evaluateWindow(
  ctx: WindowContext,
  queries: MetricQuerySpec[],
  filtersById: Map<string, MetricAttrFilter[]>,
  formulas: Array<{ spec: MetricFormulaSpec; ast: FormulaNode | null; error?: string }>,
  catalog?: CatalogLookup,
): Promise<Evaluated> {
  const out: Evaluated = {
    queries: new Map(),
    queryErrors: new Map(),
    formulas: new Map(),
    formulaErrors: new Map(),
    warnings: [],
  };
  const settled = await Promise.allSettled(
    queries.map((q) => evaluateQuery(ctx, q, filtersById.get(q.id) ?? [], catalog?.entries.get(q.metricName))),
  );
  queries.forEach((q, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') out.queries.set(q.id, r.value);
    else out.queryErrors.set(q.id, r.reason instanceof Error ? r.reason.message : 'Query failed');
  });

  for (const f of formulas) {
    if (!f.ast) {
      out.formulaErrors.set(f.spec.id, f.error ?? 'Invalid formula');
      continue;
    }
    try {
      // Operands are unfolded: the formula folds its own result.
      const operands = new Map<string, FormulaOperand>();
      let limit = 0;
      for (const id of formulaRefs(f.ast)) {
        const r = out.queries.get(id);
        if (!r) {
          throw new FormulaError(out.queryErrors.has(id) ? `Query ${id} failed` : `Unknown query ${id}`);
        }
        operands.set(id, { groups: r.groups, combine: r.combine });
        if (r.grouped) limit = Math.max(limit, r.limit);
        if (r.warnings.some((w) => isPartialResultWarning(w, id))) {
          out.warnings.push(`Formula ${f.spec.id}: query ${id} misses groups or series ${PARTIAL_RESULT_NOTE}`);
        }
      }
      if (ctx.unfoldedGroups) {
        const all = evaluateFormulaFolded(f.ast, operands, Number.MAX_SAFE_INTEGER, ctx.grid.length, f.spec.missingAsZero === true);
        out.formulas.set(f.spec.id, unfoldGroups(all.series, `Formula ${f.spec.id}`, out.warnings, ctx.rank));
      } else {
        out.formulas.set(
          f.spec.id,
          evaluateFormulaFolded(f.ast, operands, limit || METRIC_DEFAULT_SERIES_LIMIT, ctx.grid.length, f.spec.missingAsZero === true),
        );
      }
    } catch (err) {
      out.formulaErrors.set(f.spec.id, err instanceof Error ? err.message : 'Formula failed');
    }
  }
  return out;
}

function seriesName(labels: Record<string, string>, fallback: string): string {
  if (labels[OTHER_LABEL] === 'true') return 'Other';
  const values = Object.keys(labels).map((k) => (labels[k] === '' ? '(none)' : labels[k]));
  return values.length > 0 ? values.join(' · ') : fallback;
}

function toSeries(
  queryId: string,
  s: GridSeries,
  grid: number[],
  fallbackName: string,
  unit: string | null,
  comparison: boolean,
): MetricSeries {
  const key = labelKey(s.labels);
  return {
    id: `${queryId}|${key}${comparison ? '|cmp' : ''}`,
    queryId,
    labels: s.labels,
    name: seriesName(s.labels, fallbackName),
    unit,
    comparison,
    points: grid.map((t, i) => ({ t: new Date(t).toISOString(), v: s.values[i] })),
    stats: computeStats(s.values),
  };
}

function emptyInfo(id: string): MetricQueryInfo {
  return { id, seriesTotal: 0, seriesShown: 0, metricType: null, unit: null };
}

export async function runMetricQuery(query: ResolvedMetricQuery, now: Date = new Date()): Promise<MetricQueryResponse> {
  const from = new Date(query.from);
  const to = new Date(query.to);
  const badWindow = windowError(from.getTime(), to.getTime());
  if (badWindow) throw new MetricQueryValidationError(badWindow);

  const warnings: string[] = [];
  const { interval, warning } = resolveInterval(query.interval ?? 'auto', from.getTime(), to.getTime());
  if (warning) warnings.push(warning);
  const stepMs = QUERY_INTERVAL_MS[interval];
  const grid = buildGrid(from.getTime(), to.getTime(), stepMs);

  const queries = query.queries ?? [];
  const formulaSpecs = query.formulas ?? [];

  // Variables first: an unknown variable fails the whole request (400).
  const filtersById = new Map<string, MetricAttrFilter[]>();
  for (const q of queries) filtersById.set(q.id, resolveFilterVariables(q.filters ?? [], query.variables));

  const formulas = formulaSpecs.map((spec) => {
    try {
      return { spec, ast: parseFormula(spec.expression) as FormulaNode | null };
    } catch (err) {
      return { spec, ast: null, error: err instanceof Error ? err.message : 'Invalid formula' };
    }
  });

  if (query.projectIds.length === 0) {
    return {
      series: [],
      interval,
      queries: [...queries.map((q) => emptyInfo(q.id)), ...formulaSpecs.map((f) => emptyInfo(f.id))],
      warnings,
    };
  }

  const catalog: CatalogLookup = await loadCatalog(query.projectIds, [...new Set(queries.map((q) => q.metricName))]);

  const baseCtx: WindowContext = {
    organizationId: query.organizationId,
    projectIds: query.projectIds,
    from,
    to,
    grid,
    stepMs,
    interval,
    shiftMs: 0,
    openAfterMs: now.getTime(),
    maxSeries: seriesLimitCap(query.internal),
    unfoldedGroups: query.internal?.unfoldedGroups === true,
    maxRawSeries: rawSeriesCap(query.internal),
    rank: rankOf(query.internal?.rank, grid),
    // One limiter for the whole request: partitions, queries, key discovery
    // and the compareTo copy all share it.
    engine: createLimiter(MAX_ENGINE_CONCURRENCY),
  };

  const offset = compareOffsetMs(query.compareTo);
  const visibleQueries = queries.filter((q) => !q.hidden);
  const visibleFormulas = formulas.filter((f) => !f.spec.hidden);

  const currentPromise = evaluateWindow(baseCtx, queries, filtersById, formulas, catalog);
  let comparePromise: Promise<Evaluated> | null = null;
  if (offset > 0 && (visibleQueries.length > 0 || visibleFormulas.length > 0)) {
    // Only what the visible items need: visible queries plus the operands of visible formulas.
    const needed = new Set(visibleQueries.map((q) => q.id));
    for (const f of visibleFormulas) if (f.ast) for (const id of formulaRefs(f.ast)) needed.add(id);
    const shifted = shiftWindow(from, to, offset);
    comparePromise = evaluateWindow(
      { ...baseCtx, from: shifted.from, to: shifted.to, shiftMs: offset, openAfterMs: now.getTime() + offset },
      queries.filter((q) => needed.has(q.id)),
      filtersById,
      visibleFormulas,
      catalog,
    );
  }
  const [current, previous] = await Promise.all([currentPromise, comparePromise]);

  // Units per query (override > catalog, or the engine type of an
  // uncatalogued histogram); formulas share a unit only when all operands do.
  const queryUnits = new Map<string, string | null>();
  for (const q of queries) {
    const info = current.queries.get(q.id)?.info ?? catalog.entries.get(q.metricName);
    queryUnits.set(q.id, queryResultUnit(info, q.aggregation));
  }
  const unitOf = (catalogUnit: string | null) => resolveUnit(query.unitOverride, catalogUnit);

  const infos: MetricQueryInfo[] = [];
  const series: MetricSeries[] = [];

  for (const q of queries) {
    const unit = unitOf(queryUnits.get(q.id) ?? null);
    const r = current.queries.get(q.id);
    const folded = r ? foldQuery(r, q.id, baseCtx, warnings) : null;
    const info: MetricQueryInfo = {
      id: q.id,
      seriesTotal: folded?.seriesTotal ?? 0,
      seriesShown: folded?.seriesShown ?? 0,
      metricType: r?.metricType ?? catalog.entries.get(q.metricName)?.type ?? null,
      unit,
    };
    const error = current.queryErrors.get(q.id);
    if (error) info.error = error;
    else if (r && r.groups.length === 0 && catalog.available && !catalog.entries.has(q.metricName)) {
      info.error = `Unknown metric "${q.metricName}"`;
    }
    if (r) warnings.push(...r.warnings);
    infos.push(info);
    if (q.hidden || !folded) continue;
    const name = q.label || q.metricName;
    for (const s of folded.series) series.push(toSeries(q.id, s, grid, name, unit, false));
    const cmp = previous?.queries.get(q.id);
    if (cmp) for (const s of foldQuery(cmp, q.id, baseCtx, warnings).series) series.push(toSeries(q.id, s, grid, name, unit, true));
  }

  warnings.push(...current.warnings);
  for (const f of formulas) {
    const refs = f.ast ? formulaRefs(f.ast) : [];
    const unit = unitOf(formulaUnit(refs, queryUnits));
    const result = current.formulas.get(f.spec.id);
    const info: MetricQueryInfo = {
      id: f.spec.id,
      seriesTotal: result?.seriesTotal ?? 0,
      seriesShown: result?.seriesShown ?? 0,
      metricType: null,
      unit,
    };
    const error = current.formulaErrors.get(f.spec.id);
    if (error) info.error = error;
    infos.push(info);
    if (f.spec.hidden || !result) continue;
    const name = f.spec.label || f.spec.expression;
    for (const s of result.series) series.push(toSeries(f.spec.id, s, grid, name, unit, false));
    const cmp = previous?.formulas.get(f.spec.id);
    if (cmp) for (const s of cmp.series) series.push(toSeries(f.spec.id, s, grid, name, unit, true));
  }

  return { series, interval, queries: infos, warnings: [...new Set(warnings)] };
}

export const metricQueryService = {
  async run(query: ResolvedMetricQuery): Promise<MetricQueryResponse> {
    return runMetricQuery(query);
  },
};
