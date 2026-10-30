// ============================================================================
// Param normalization for the Reservoir client (spec 6.4, plan D4 and D6)
// ============================================================================
// Every function returns a NEW object and never mutates its input; invalid
// input throws RangeError before any engine sees it. Defaults and limits
// live here once, so engines receive the same shape on every backend.

import { isValidFieldKey, SPAN_KINDS } from '@logtide/shared';
import {
  MAX_HISTOGRAM_BUCKETS,
  FACETS_DEFAULT_LIMIT,
  FACETS_MAX_LIMIT,
  FACETS_MAX_FIELDS,
  DISCOVER_DEFAULT_SAMPLE_SIZE,
  DISCOVER_MAX_SAMPLE_SIZE,
  OPERATION_STATS_DEFAULT_LIMIT,
  OPERATION_STATS_MAX_LIMIT,
  SESSIONS_MAX_LIMIT,
} from './constants.js';
import { decodeSessionCursor, facetFieldName } from './aggregation-helpers.js';
import { isEmptyTextQuery, legacySearchToTextQuery } from './text-query.js';
import type {
  LogFilterParams,
  LogExclude,
  LogHistogramParams,
  LogFacetsParams,
  DiscoverMetadataKeysParams,
  OperationStatsParams,
  SpanQueryParams,
  SpanSortBy,
  TraceQueryParams,
  TraceSortBy,
  ListSessionsParams,
  TextQuery,
} from './types.js';

const fmt = (n: number): string => n.toLocaleString('en-US');

const WORD_ONLY = /^[\p{L}\p{N}_]+$/u;
const FACET_BUILTINS = new Set<string>(['level', 'service', 'hostname']);
const SPAN_SORTS = new Set<string>(['start_time', 'duration', 'end_time', 'duration_ms', 'service_name', 'operation_name'] satisfies SpanSortBy[]);
const TRACE_SORTS = new Set<string>(['start_time', 'duration'] satisfies TraceSortBy[]);
const SORT_ORDERS = new Set<string>(['asc', 'desc']);
const KINDS = new Set<string>(SPAN_KINDS);

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Rejects invalid dates and reversed ranges (new 1.6 methods only). */
export function assertTimeRange(from: Date, to: Date): void {
  if (!isValidDate(from) || !isValidDate(to)) throw new RangeError('from and to must be valid dates');
  if (from.getTime() > to.getTime()) throw new RangeError('from must not be after to');
}

/** Integer limit: undefined gives the default, the value is floored and clamped. */
function clampLimit(value: number | undefined, fallback: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value)) throw new RangeError(`${name} must be a number`);
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function checkTerm(term: unknown, where: string): void {
  if (typeof term !== 'object' || term === null) throw new RangeError(`Invalid text term in ${where}`);
  const { kind, value } = term as { kind?: unknown; value?: unknown };
  if (kind !== 'word' && kind !== 'phrase') throw new RangeError(`Invalid text term kind in ${where}`);
  if (typeof value !== 'string' || value === '') throw new RangeError(`Empty text term in ${where}`);
  // Engines rely on it: a word is one token of letters, digits and _ (plan D3).
  if (kind === 'word' && !WORD_ONLY.test(value)) {
    throw new RangeError(`Word terms contain only letters, digits and _ (got "${value}" in ${where})`);
  }
}

function checkTextQuery(q: TextQuery): void {
  if (typeof q !== 'object' || q === null || !Array.isArray(q.all) || !Array.isArray(q.anyOf) || !Array.isArray(q.none)) {
    throw new RangeError('textQuery needs all, anyOf and none arrays');
  }
  for (const term of q.all) checkTerm(term, 'textQuery.all');
  for (const term of q.none) checkTerm(term, 'textQuery.none');
  for (const group of q.anyOf) {
    if (!Array.isArray(group) || group.length === 0) throw new RangeError('Empty group in textQuery.anyOf');
    for (const term of group) checkTerm(term, 'textQuery.anyOf');
  }
}

function normalizeExclude(exclude: LogExclude): LogExclude | undefined {
  const out: LogExclude = {};
  for (const key of ['service', 'level', 'hostname'] as const) {
    const list = exclude[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new RangeError(`exclude.${key} must be an array`);
    if (list.length > 0) (out as Record<string, unknown>)[key] = list;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The filter part of query, count, countEstimate, histogram and facets:
 * derives `textQuery` from legacy `search`/`searchMode` when absent (both are
 * passed down, plan D4), validates and drops an empty `textQuery`, and drops
 * empty `exclude` lists. `matchNothing` is kept for the client to answer.
 */
export function normalizeLogFilter<T extends LogFilterParams>(params: T): T {
  const out: LogFilterParams = { ...params };
  if (out.textQuery === undefined) {
    const derived = legacySearchToTextQuery(out.search, out.searchMode);
    if (derived) out.textQuery = derived;
  } else {
    checkTextQuery(out.textQuery);
    if (isEmptyTextQuery(out.textQuery)) delete out.textQuery;
  }
  if (out.exclude !== undefined) {
    const exclude = normalizeExclude(out.exclude);
    if (exclude) out.exclude = exclude;
    else delete out.exclude;
  }
  return out as T;
}

/** Histogram: positive integer `bucketSeconds`, at most MAX_HISTOGRAM_BUCKETS buckets, `from <= to`. */
export function normalizeHistogramParams<T extends LogHistogramParams>(params: T): T {
  assertTimeRange(params.from, params.to);
  const b = params.bucketSeconds;
  if (typeof b !== 'number' || !Number.isInteger(b) || b <= 0) {
    throw new RangeError(`bucketSeconds must be a positive integer (got ${String(b)})`);
  }
  const ms = b * 1000;
  const first = Math.floor(params.from.getTime() / ms);
  const last = params.toExclusive ? Math.ceil(params.to.getTime() / ms) - 1 : Math.floor(params.to.getTime() / ms);
  const buckets = last - first + 1;
  if (buckets > MAX_HISTOGRAM_BUCKETS) {
    throw new RangeError(
      `A histogram can have at most ${fmt(MAX_HISTOGRAM_BUCKETS)} buckets (this range needs ${fmt(buckets)} buckets of ${fmt(b)} s)`,
    );
  }
  return normalizeLogFilter(params);
}

/** Facets: 1 to FACETS_MAX_FIELDS distinct valid fields, `limit` defaulted and clamped. */
export function normalizeFacetsParams<T extends LogFacetsParams>(params: T): T {
  assertTimeRange(params.from, params.to);
  const fields = params.fields;
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > FACETS_MAX_FIELDS) {
    throw new RangeError(`fields must list 1 to ${fmt(FACETS_MAX_FIELDS)} facet fields`);
  }
  const seen = new Set<string>();
  for (const field of fields) {
    if (typeof field !== 'object' || field === null) throw new RangeError('Invalid facet field');
    if ('builtin' in field) {
      if (!FACET_BUILTINS.has(field.builtin)) throw new RangeError(`Unknown facet field ${String(field.builtin)}`);
    } else if ('metadata' in field) {
      if (typeof field.metadata !== 'string' || !isValidFieldKey(field.metadata)) {
        throw new RangeError(`Invalid metadata facet key ${JSON.stringify(field.metadata)}`);
      }
    } else {
      throw new RangeError('Invalid facet field');
    }
    const name = facetFieldName(field);
    if (seen.has(name)) throw new RangeError(`Duplicate facet field ${name}`);
    seen.add(name);
  }
  const out = normalizeLogFilter(params);
  return { ...out, fields: [...fields], limit: clampLimit(params.limit, FACETS_DEFAULT_LIMIT, FACETS_MAX_LIMIT, 'limit') };
}

/** Metadata key discovery: `sampleSize` defaulted and clamped, `from <= to`. */
export function normalizeDiscoverParams<T extends DiscoverMetadataKeysParams>(params: T): T {
  assertTimeRange(params.from, params.to);
  return {
    ...params,
    sampleSize: clampLimit(params.sampleSize, DISCOVER_DEFAULT_SAMPLE_SIZE, DISCOVER_MAX_SAMPLE_SIZE, 'sampleSize'),
  };
}

/** Operation stats: `limit` defaulted and clamped; `kinds` stays undefined when omitted, must be non-empty otherwise. */
export function normalizeOperationStatsParams<T extends OperationStatsParams>(params: T): T {
  assertTimeRange(params.from, params.to);
  const out: T = {
    ...params,
    limit: clampLimit(params.limit, OPERATION_STATS_DEFAULT_LIMIT, OPERATION_STATS_MAX_LIMIT, 'limit'),
  };
  if (params.kinds !== undefined) {
    if (!Array.isArray(params.kinds) || params.kinds.length === 0) {
      throw new RangeError('kinds must list at least one span kind (omit it for the default entry spans)');
    }
    for (const kind of params.kinds) {
      if (!KINDS.has(kind)) throw new RangeError(`Unknown span kind ${String(kind)}`);
    }
    out.kinds = [...params.kinds];
  }
  return out;
}

/** Spans: `operation` becomes `operationName` (a different operationName is an error), `'duration'` sorts by `'duration_ms'`. */
export function normalizeSpanQueryParams<T extends SpanQueryParams>(params: T): T {
  const out: SpanQueryParams = { ...params };
  if (out.operation !== undefined) {
    const operation = out.operation;
    const existing = out.operationName;
    if (existing === undefined) {
      out.operationName = operation;
    } else {
      const same = typeof existing === 'string' ? existing === operation : existing.length === 1 && existing[0] === operation;
      if (!same) throw new RangeError('operation and operationName must not differ');
    }
    delete out.operation;
  }
  if (out.sortBy !== undefined) {
    if (!SPAN_SORTS.has(out.sortBy)) throw new RangeError(`Unknown span sortBy ${String(out.sortBy)}`);
    if (out.sortBy === 'duration') out.sortBy = 'duration_ms';
  }
  return out as T;
}

/** Traces: `sortBy` is `'start_time' | 'duration'`, `sortOrder` is `'asc' | 'desc'`. */
export function normalizeTraceQueryParams<T extends TraceQueryParams>(params: T): T {
  if (params.sortBy !== undefined && !TRACE_SORTS.has(params.sortBy)) {
    throw new RangeError(`Unknown trace sortBy ${String(params.sortBy)} (use start_time or duration)`);
  }
  if (params.sortOrder !== undefined && !SORT_ORDERS.has(params.sortOrder)) {
    throw new RangeError(`Unknown sortOrder ${String(params.sortOrder)} (use asc or desc)`);
  }
  return { ...params };
}

/** Sessions: positive integer `limit` clamped to SESSIONS_MAX_LIMIT, a valid cursor, `from <= to`. */
export function normalizeListSessionsParams<T extends ListSessionsParams>(params: T): T {
  assertTimeRange(params.from, params.to);
  const limit = params.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive integer (got ${String(limit)})`);
  }
  if (params.cursor !== undefined) decodeSessionCursor(params.cursor);
  return { ...params, limit: Math.min(limit, SESSIONS_MAX_LIMIT) };
}
