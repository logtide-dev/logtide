// 1.8 metrics query service: the one evaluator behind the explorer
// (POST /api/v1/metrics/query), the `metrics` dashboard panel, the source
// views (POST /api/v1/metrics/panels/data) and the sources headline signals.
//
// CONTRACT (fixed by the lead; the implementation replaces the bodies):
// - resolveProjectScope: projectIds null -> every non-deleted project of the
//   organization; explicit ids must all belong to it and the user must be a
//   member of the organization, else MetricScopeError (routes map it to 403).
// - metricQueryService.run: evaluates an already-authorized query, semantics
//   in docs/superpowers/specs/2026-11-25-metrics-1.8-design.md ("Query service").
//
// Per query: the engine aggregates per series (time aggregation), grouped by
// the requested groupBy plus the series identity (metric label keys and the
// host/service resource keys); this service then turns counters into rates,
// combines the series of each group (space aggregation), keeps the top N and
// folds the rest. Formulas and compareTo copies work on those results.
//
// Histograms (catalog type histogram / exp_histogram) take their own path:
// the engine returns one histogram per bucket and series (hist_last for
// cumulative temporality, then diffed here; hist_sum for delta), series are
// merged per group and reduced to the requested aggregation (histogram.ts).
// Sums use their temporality for `rate`: cumulative = diff of the last value
// per bucket, delta = bucket sum / bucket seconds.

import type {
  MetricAttrFilter,
  MetricAttrRef,
  MetricFormulaSpec,
  MetricQueryInfo,
  MetricQueryRequest,
  MetricQueryResponse,
  MetricQuerySpec,
  MetricSeries,
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
  computeStats,
  foldTopN,
  labelKey,
  OTHER_LABEL,
  spaceAggregate,
  type GridSeries,
} from './series-fold.js';
import { evaluateFormula, formulaRefs, formulaUnit, parseFormula, FormulaError, type FormulaNode } from './formula.js';
import { compareOffsetMs, shiftWindow } from './compare.js';
import { resolveFilterVariables } from './variables.js';
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
  foldTopNHistograms,
  histBucketsToSeries,
  histSeriesToScalar,
  mergeHistSeries,
} from './histogram.js';

export { MetricScopeError, MetricQueryValidationError, resolveProjectScope };

/** A query whose project scope is already resolved and authorized. */
export interface ResolvedMetricQuery extends Omit<MetricQueryRequest, 'projectIds'> {
  projectIds: string[];
}

/** Above this many raw series a query is aggregated by the engine in one step. */
export const MAX_RAW_SERIES = 500;
/** Metric attribute keys used to tell series apart. */
export const MAX_IDENTITY_METRIC_KEYS = 10;
/** Resource keys that identify who sent a series. */
export const IDENTITY_RESOURCE_KEYS = ['host.name', 'service.name', 'service.instance.id'];

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
}

interface QueryResult {
  series: GridSeries[];
  seriesTotal: number;
  seriesShown: number;
  metricType: string | null;
  warnings: string[];
}

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

async function labelKeys(ctx: WindowContext, metricName: string, scope: 'metric' | 'resource'): Promise<string[]> {
  try {
    const result = await reservoir.getMetricLabelKeys({
      organizationId: ctx.organizationId,
      projectId: ctx.projectIds,
      metricName,
      from: ctx.from,
      to: ctx.to,
      limit: scope === 'metric' ? MAX_IDENTITY_METRIC_KEYS : 100,
      scope,
    });
    return result?.keys ?? [];
  } catch {
    // An engine without resource-scope discovery still answers the query,
    // only less finely split.
    return [];
  }
}

async function aggregate(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  filters: MetricAttrFilter[],
  aggregation: MetricAggregationFn,
  groupByAttrs: MetricAttrRef[],
): Promise<{ timeseries: MetricTimeBucket[]; metricType: string | null }> {
  const result = await reservoir.aggregateMetrics({
    organizationId: ctx.organizationId,
    projectId: ctx.projectIds,
    metricName: spec.metricName,
    from: ctx.from,
    to: ctx.to,
    interval: ctx.interval,
    aggregation,
    groupByAttrs: groupByAttrs.length > 0 ? groupByAttrs : undefined,
    filters: filters.length > 0 ? filters : undefined,
  });
  const timeseries = result?.timeseries ?? [];
  return { timeseries, metricType: timeseries.length > 0 ? (result?.metricType ?? null) : null };
}

async function seriesIdentity(
  ctx: WindowContext,
  spec: MetricQuerySpec,
): Promise<{ groupRefs: MetricAttrRef[]; groupLabels: string[]; identityRefs: MetricAttrRef[] }> {
  const groupRefs = dedupeRefs(spec.groupBy);
  const groupLabels = groupRefs.map(metricAttrLabel);
  const [metricKeys, resourceKeys] = await Promise.all([
    labelKeys(ctx, spec.metricName, 'metric'),
    labelKeys(ctx, spec.metricName, 'resource'),
  ]);
  const identityRefs = dedupeRefs([
    ...groupRefs,
    ...metricKeys.slice(0, MAX_IDENTITY_METRIC_KEYS).map((key) => ({ scope: 'metric' as const, key })),
    ...IDENTITY_RESOURCE_KEYS.filter((k) => resourceKeys.includes(k)).map((key) => ({ scope: 'resource' as const, key })),
  ]);
  return { groupRefs, groupLabels, identityRefs };
}

function seriesLimit(spec: MetricQuerySpec): number {
  return Math.min(Math.max(1, spec.limit ?? METRIC_DEFAULT_SERIES_LIMIT), METRIC_MAX_SERIES_LIMIT);
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
  const { groupRefs, groupLabels, identityRefs } = await seriesIdentity(ctx, spec);

  const perSeries = await aggregate(ctx, spec, filters, engineAgg, identityRefs);
  let metricType = perSeries.metricType;
  let series = histBucketsToSeries(perSeries.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);
  // Delta histograms add up, so above the raw-series cap the engine can sum
  // each group directly. Cumulative snapshots must be diffed per series and
  // are always read per series.
  if (series.length > MAX_RAW_SERIES && temporality === 'delta' && identityRefs.length > groupRefs.length) {
    warnings.push(`Query ${spec.id}: more than ${MAX_RAW_SERIES} series, histograms summed by the engine in one step`);
    const grouped = await aggregate(ctx, spec, filters, engineAgg, groupRefs);
    metricType = grouped.metricType ?? metricType;
    series = histBucketsToSeries(grouped.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);
  }
  if (series.length === 0) return { series: [], seriesTotal: 0, seriesShown: 0, metricType, warnings };

  if (temporality === 'cumulative') series = cumulativeToDelta(series, ctx.grid);

  if (isRate) {
    series = dropOpenBuckets(series, ctx.grid, ctx.stepMs, ctx.openAfterMs);
    const spaceAgg = spec.spaceAggregation ?? defaultSpaceAggregation('rate');
    const groups = spaceAggregate(histSeriesToScalar(series, 'rate'), groupLabels, spaceAgg, len);
    if (groupLabels.length === 0) return { series: groups, seriesTotal: 1, seriesShown: 1, metricType, warnings };
    return { ...foldTopN(groups, seriesLimit(spec), spaceAgg, len), metricType, warnings };
  }

  const merged = mergeHistSeries(series, groupLabels, len);
  if (groupLabels.length === 0) {
    const folded = foldTopNHistograms(merged, 1, spec.aggregation, len);
    return { series: folded.series, seriesTotal: 1, seriesShown: 1, metricType, warnings };
  }
  return { ...foldTopNHistograms(merged, seriesLimit(spec), spec.aggregation, len), metricType, warnings };
}

async function evaluateQuery(
  ctx: WindowContext,
  spec: MetricQuerySpec,
  filters: MetricAttrFilter[],
  info?: CatalogInfo,
): Promise<QueryResult> {
  if (info && isHistogramType(info.type)) return evaluateHistogramQuery(ctx, spec, filters, info);

  const warnings: string[] = [];
  const isRate = spec.aggregation === 'rate';
  // Delta sums: each point is already an increment, the rate is the bucket sum per second.
  const deltaRate = isRate && info?.type === 'sum' && effectiveTemporality(info) === 'delta';
  const engineAgg: MetricAggregationFn = isRate ? (deltaRate ? 'sum' : 'last') : (spec.aggregation as MetricAggregationFn);
  const spaceAgg = spec.spaceAggregation ?? defaultSpaceAggregation(spec.aggregation);
  const toRate = (s: GridSeries[]) =>
    deltaRate
      ? applyDeltaRate(s, ctx.grid, ctx.stepMs, ctx.openAfterMs)
      : applyRate(s, ctx.grid, ctx.stepMs, ctx.openAfterMs);
  const { groupRefs, groupLabels, identityRefs } = await seriesIdentity(ctx, spec);

  const perSeries = await aggregate(ctx, spec, filters, engineAgg, identityRefs);
  let metricType = perSeries.metricType;
  let series = bucketsToSeries(perSeries.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);
  let groups: GridSeries[];

  if (series.length > MAX_RAW_SERIES && identityRefs.length > groupRefs.length) {
    // Too many series to combine here: let the engine aggregate each group
    // directly (time aggregation only, no space step).
    warnings.push(
      `Query ${spec.id}: more than ${MAX_RAW_SERIES} series, aggregated in one step (space aggregation skipped)`,
    );
    const grouped = await aggregate(ctx, spec, filters, engineAgg, groupRefs);
    metricType = grouped.metricType ?? metricType;
    series = bucketsToSeries(grouped.timeseries, ctx.grid, ctx.stepMs, ctx.shiftMs);
    if (isRate) series = toRate(series);
    groups = spaceAggregate(series, groupLabels, spaceAgg, ctx.grid.length);
  } else {
    if (isRate) series = toRate(series);
    groups = spaceAggregate(series, groupLabels, spaceAgg, ctx.grid.length);
  }

  if (series.length === 0) return { series: [], seriesTotal: 0, seriesShown: 0, metricType, warnings };
  if (groupLabels.length === 0) return { series: groups, seriesTotal: 1, seriesShown: 1, metricType, warnings };

  const folded = foldTopN(groups, seriesLimit(spec), spaceAgg, ctx.grid.length);
  return { ...folded, metricType, warnings };
}

interface Evaluated {
  queries: Map<string, QueryResult>;
  queryErrors: Map<string, string>;
  formulas: Map<string, GridSeries[]>;
  formulaErrors: Map<string, string>;
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
  };
  const settled = await Promise.allSettled(queries.map((q) => evaluateQuery(ctx, q, filtersById.get(q.id) ?? [], catalog?.entries.get(q.metricName))));
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
      const operands = new Map<string, GridSeries[]>();
      for (const id of formulaRefs(f.ast)) {
        const r = out.queries.get(id);
        if (!r) {
          throw new FormulaError(out.queryErrors.has(id) ? `Query ${id} failed` : `Unknown query ${id}`);
        }
        operands.set(id, r.series);
      }
      out.formulas.set(f.spec.id, evaluateFormula(f.ast, operands, ctx.grid.length));
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
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.getTime() >= to.getTime()) {
    throw new MetricQueryValidationError('"from" must be before "to"');
  }

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

  // Units per query (override > catalog), formulas share a unit only when all operands do.
  const queryUnits = new Map<string, string | null>();
  for (const q of queries) queryUnits.set(q.id, queryResultUnit(catalog.entries.get(q.metricName), q.aggregation));
  const unitOf = (catalogUnit: string | null) => resolveUnit(query.unitOverride, catalogUnit);

  const infos: MetricQueryInfo[] = [];
  const series: MetricSeries[] = [];

  for (const q of queries) {
    const unit = unitOf(queryUnits.get(q.id) ?? null);
    const r = current.queries.get(q.id);
    const info: MetricQueryInfo = {
      id: q.id,
      seriesTotal: r?.seriesTotal ?? 0,
      seriesShown: r?.seriesShown ?? 0,
      metricType: r?.metricType ?? catalog.entries.get(q.metricName)?.type ?? null,
      unit,
    };
    const error = current.queryErrors.get(q.id);
    if (error) info.error = error;
    else if (r && r.series.length === 0 && catalog.available && !catalog.entries.has(q.metricName)) {
      info.error = `Unknown metric "${q.metricName}"`;
    }
    if (r) warnings.push(...r.warnings);
    infos.push(info);
    if (q.hidden || !r) continue;
    const name = q.label || q.metricName;
    for (const s of r.series) series.push(toSeries(q.id, s, grid, name, unit, false));
    const cmp = previous?.queries.get(q.id);
    if (cmp) for (const s of cmp.series) series.push(toSeries(q.id, s, grid, name, unit, true));
  }

  for (const f of formulas) {
    const refs = f.ast ? formulaRefs(f.ast) : [];
    const unit = unitOf(formulaUnit(refs, queryUnits));
    const result = current.formulas.get(f.spec.id);
    const info: MetricQueryInfo = {
      id: f.spec.id,
      seriesTotal: result?.length ?? 0,
      seriesShown: result?.length ?? 0,
      metricType: null,
      unit,
    };
    const error = current.formulaErrors.get(f.spec.id);
    if (error) info.error = error;
    infos.push(info);
    if (f.spec.hidden || !result) continue;
    const name = f.spec.label || f.spec.expression;
    for (const s of result) series.push(toSeries(f.spec.id, s, grid, name, unit, false));
    const cmp = previous?.formulas.get(f.spec.id);
    if (cmp) for (const s of cmp) series.push(toSeries(f.spec.id, s, grid, name, unit, true));
  }

  return { series, interval, queries: infos, warnings: [...new Set(warnings)] };
}

export const metricQueryService = {
  async run(query: ResolvedMetricQuery): Promise<MetricQueryResponse> {
    return runMetricQuery(query);
  },
};
