import {
  METRIC_ATTR_FILTER_OPS,
  METRIC_MAX_FILTERS,
  METRIC_MAX_FORMULAS,
  METRIC_MAX_GROUP_BY,
  METRIC_MAX_QUERIES,
  METRIC_MAX_SERIES_LIMIT,
  METRIC_QUERY_IDS,
  METRIC_SPACE_AGGREGATIONS,
  METRIC_TIME_AGGREGATIONS,
  type MetricAttrFilter,
  type MetricAttrRef,
  type MetricCompareTo,
  type MetricDisplay,
  type MetricExplorerQuery,
  type MetricFormulaSpec,
  type MetricQueryInterval,
  type MetricQuerySpec,
} from '@logtide/shared';

// URL codec and defaults for the Metrics explorer state. The whole
// MetricExplorerQuery travels in one compact param (base64url JSON) so
// "Copy link" is shareable. Parsing never throws: anything invalid falls back
// to a default, so a stale or hand-edited link still opens.

export const EXPLORER_URL_PARAM = 'q';

const DISPLAYS: readonly MetricDisplay[] = ['lines', 'area', 'bars', 'split', 'stat', 'table'];
const INTERVALS: readonly MetricQueryInterval[] = ['auto', '1m', '5m', '15m', '1h', '6h', '1d'];
const COMPARES: readonly MetricCompareTo[] = ['none', '1h', '1d', '1w'];
const FORMULA_IDS = ['F1', 'F2', 'F3', 'F4'] as const;
const MAX_URL_PARAM_LENGTH = 16_000;

/** Resource attributes that identify a source: grouping by one of them defaults the display to split. */
const SOURCE_ATTR_KEYS = new Set(['host.name', 'service.name', 'service.instance.id']);
const SOURCE_ATTR_PREFIXES = ['container.', 'k8s.'];

export function isSourceAttribute(ref: MetricAttrRef): boolean {
  if (ref.scope !== 'resource') return false;
  return SOURCE_ATTR_KEYS.has(ref.key) || SOURCE_ATTR_PREFIXES.some((p) => ref.key.startsWith(p));
}

/** Default display rule: split when any group by is a source attribute, lines otherwise. */
export function defaultDisplayFor(groupBys: MetricAttrRef[]): MetricDisplay {
  return groupBys.some(isSourceAttribute) ? 'split' : 'lines';
}

/** Default display for a whole explorer query (union of the group bys of its visible queries). */
export function defaultDisplayForQuery(q: Pick<MetricExplorerQuery, 'queries'>): MetricDisplay {
  return defaultDisplayFor(q.queries.flatMap((s) => s.groupBy));
}

export function emptyQuerySpec(id = 'A'): MetricQuerySpec {
  return { id, metricName: '', aggregation: 'avg', filters: [], groupBy: [] };
}

export function defaultExplorerQuery(): MetricExplorerQuery {
  return {
    projectIds: null,
    queries: [emptyQuerySpec('A')],
    formulas: [],
    interval: 'auto',
    compareTo: 'none',
    display: 'lines',
  };
}

// ---------------------------------------------------------------------------
// base64url (UTF-8 safe)
// ---------------------------------------------------------------------------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function cleanRef(v: unknown): MetricAttrRef | null {
  if (!isRecord(v)) return null;
  const scope = v.scope === 'resource' ? 'resource' : v.scope === 'metric' ? 'metric' : null;
  if (!scope || typeof v.key !== 'string' || v.key === '' || v.key.length > 200) return null;
  return { scope, key: v.key };
}

function cleanFilter(v: unknown): MetricAttrFilter | null {
  const ref = cleanRef(v);
  if (!ref || !isRecord(v)) return null;
  if (typeof v.op !== 'string' || !(METRIC_ATTR_FILTER_OPS as readonly string[]).includes(v.op)) return null;
  const filter: MetricAttrFilter = { ...ref, op: v.op as MetricAttrFilter['op'] };
  if (Array.isArray(v.values)) {
    filter.values = v.values.filter((x): x is string => typeof x === 'string').slice(0, 100);
  }
  return filter;
}

function cleanQuerySpec(v: unknown, id: string): MetricQuerySpec | null {
  if (!isRecord(v)) return null;
  const spec: MetricQuerySpec = {
    id,
    metricName: typeof v.metricName === 'string' ? v.metricName.slice(0, 300) : '',
    aggregation: oneOf(v.aggregation, METRIC_TIME_AGGREGATIONS, 'avg'),
    filters: (Array.isArray(v.filters) ? v.filters : [])
      .map(cleanFilter)
      .filter((f): f is MetricAttrFilter => f !== null)
      .slice(0, METRIC_MAX_FILTERS),
    groupBy: (Array.isArray(v.groupBy) ? v.groupBy : [])
      .map(cleanRef)
      .filter((r): r is MetricAttrRef => r !== null)
      .slice(0, METRIC_MAX_GROUP_BY),
  };
  if (typeof v.spaceAggregation === 'string' && (METRIC_SPACE_AGGREGATIONS as readonly string[]).includes(v.spaceAggregation)) {
    spec.spaceAggregation = v.spaceAggregation as MetricQuerySpec['spaceAggregation'];
  }
  if (typeof v.limit === 'number' && Number.isFinite(v.limit)) {
    spec.limit = Math.min(METRIC_MAX_SERIES_LIMIT, Math.max(1, Math.round(v.limit)));
  }
  if (v.hidden === true) spec.hidden = true;
  if (typeof v.label === 'string' && v.label !== '') spec.label = v.label.slice(0, 100);
  return spec;
}

function cleanFormula(v: unknown, id: string): MetricFormulaSpec | null {
  if (!isRecord(v) || typeof v.expression !== 'string') return null;
  const f: MetricFormulaSpec = { id, expression: v.expression.slice(0, 500) };
  if (typeof v.label === 'string' && v.label !== '') f.label = v.label.slice(0, 100);
  if (v.hidden === true) f.hidden = true;
  return f;
}

/** Keeps a valid unique id when given, else the first unused one. */
function pickId(wanted: unknown, pool: readonly string[], used: Set<string>): string | null {
  if (typeof wanted === 'string' && pool.includes(wanted) && !used.has(wanted)) return wanted;
  return pool.find((id) => !used.has(id)) ?? null;
}

/**
 * Coerces any value into a valid MetricExplorerQuery: unknown or invalid
 * pieces are dropped or defaulted, limits are enforced, ids are made unique.
 * Always returns at least one query.
 */
export function sanitizeExplorerQuery(raw: unknown): MetricExplorerQuery {
  const base = defaultExplorerQuery();
  if (!isRecord(raw)) return base;

  const queries: MetricQuerySpec[] = [];
  const usedQ = new Set<string>();
  for (const item of Array.isArray(raw.queries) ? raw.queries : []) {
    if (queries.length >= METRIC_MAX_QUERIES) break;
    const id = pickId(isRecord(item) ? item.id : undefined, METRIC_QUERY_IDS, usedQ);
    if (!id) break;
    const spec = cleanQuerySpec(item, id);
    if (spec) {
      usedQ.add(id);
      queries.push(spec);
    }
  }

  const formulas: MetricFormulaSpec[] = [];
  const usedF = new Set<string>();
  for (const item of Array.isArray(raw.formulas) ? raw.formulas : []) {
    if (formulas.length >= METRIC_MAX_FORMULAS) break;
    const id = pickId(isRecord(item) ? item.id : undefined, FORMULA_IDS, usedF);
    if (!id) break;
    const f = cleanFormula(item, id);
    if (f) {
      usedF.add(id);
      formulas.push(f);
    }
  }

  const projectIds = Array.isArray(raw.projectIds)
    ? raw.projectIds.filter((p): p is string => typeof p === 'string' && p !== '').slice(0, 100)
    : null;

  const finalQueries = queries.length > 0 ? queries : base.queries;
  const out: MetricExplorerQuery = {
    projectIds: projectIds && projectIds.length > 0 ? projectIds : null,
    queries: finalQueries,
    formulas,
    interval: oneOf(raw.interval, INTERVALS, 'auto'),
    compareTo: oneOf(raw.compareTo, COMPARES, 'none'),
    display: DISPLAYS.includes(raw.display as MetricDisplay)
      ? (raw.display as MetricDisplay)
      : defaultDisplayForQuery({ queries: finalQueries }),
  };
  if (typeof raw.unitOverride === 'string' && raw.unitOverride !== '') out.unitOverride = raw.unitOverride.slice(0, 50);
  return out;
}

// ---------------------------------------------------------------------------
// codec
// ---------------------------------------------------------------------------

/** Drops fields equal to their default so links stay short. */
function compact(q: MetricExplorerQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {
    queries: q.queries.map((s) => {
      const c: Record<string, unknown> = { id: s.id, metricName: s.metricName, aggregation: s.aggregation };
      if (s.spaceAggregation) c.spaceAggregation = s.spaceAggregation;
      if (s.filters.length > 0) c.filters = s.filters;
      if (s.groupBy.length > 0) c.groupBy = s.groupBy;
      if (s.limit !== undefined) c.limit = s.limit;
      if (s.hidden) c.hidden = true;
      if (s.label) c.label = s.label;
      return c;
    }),
    display: q.display,
  };
  if (q.projectIds && q.projectIds.length > 0) out.projectIds = q.projectIds;
  if (q.formulas.length > 0) out.formulas = q.formulas;
  if (q.interval !== 'auto') out.interval = q.interval;
  if (q.compareTo !== 'none') out.compareTo = q.compareTo;
  if (q.unitOverride) out.unitOverride = q.unitOverride;
  return out;
}

/** Serializes a query to the compact URL value (base64url JSON). */
export function encodeExplorerQuery(q: MetricExplorerQuery): string {
  return toBase64Url(JSON.stringify(compact(q)));
}

/**
 * Parses a URL value. Returns null when it is missing or not decodable;
 * a decodable value is always sanitized into a valid query.
 */
export function decodeExplorerQuery(value: string | null | undefined): MetricExplorerQuery | null {
  if (!value || value.length > MAX_URL_PARAM_LENGTH) return null;
  try {
    return sanitizeExplorerQuery(JSON.parse(fromBase64Url(value)));
  } catch {
    return null;
  }
}

/** Reads the explorer query from URL params, falling back to the default query. */
export function readExplorerQuery(params: URLSearchParams): MetricExplorerQuery {
  return decodeExplorerQuery(params.get(EXPLORER_URL_PARAM)) ?? defaultExplorerQuery();
}

/** Returns a copy of `params` carrying the query. */
export function writeExplorerQuery(params: URLSearchParams, q: MetricExplorerQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(EXPLORER_URL_PARAM, encodeExplorerQuery(q));
  return next;
}
