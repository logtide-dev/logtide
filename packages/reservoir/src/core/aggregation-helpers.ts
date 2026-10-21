// ============================================================================
// Aggregation helpers shared by every engine (spec 6.4, plan D6)
// ============================================================================
// Engines run the grouping natively and hand the rows to these helpers, so
// zero filling, ordering, limits and cursor encoding are identical on
// TimescaleDB, ClickHouse and MongoDB.

import { LATENCY_HISTOGRAM_BOUNDS_MS } from './constants.js';
import type {
  LogLevel,
  LogHistogramParams,
  LogHistogramResult,
  LogHistogramBucket,
  LogFacetField,
  LogFacet,
  MetadataKeyOccurrence,
} from './types.js';

/**
 * UTF-8 byte order (equal to Unicode code point order), the tie-break order
 * of the contract. Plain `<` compares UTF-16 code units, which differs for
 * characters above U+FFFF against U+E000..U+FFFF.
 */
export function compareByteOrder(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    const xSurrogate = x >= 0xd800 && x <= 0xdfff;
    const ySurrogate = y >= 0xd800 && y <= 0xdfff;
    // A surrogate starts a supplementary character, above every BMP character.
    if (xSurrogate !== ySurrogate) return xSurrogate ? 1 : -1;
    return x - y;
  }
  return a.length - b.length;
}

// ----------------------------------------------------------------------------
// Histogram
// ----------------------------------------------------------------------------

function bucketMs(bucketSeconds: number): number {
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) {
    throw new RangeError(`bucketSeconds must be a positive integer, got ${bucketSeconds}`);
  }
  return bucketSeconds * 1000;
}

/**
 * Bucket starts covering [from, to] (or [from, to) with `toExclusive`):
 * multiples of `bucketSeconds` since the Unix epoch, from the bucket that
 * contains `from`.
 */
export function histogramBucketStarts(from: Date, to: Date, bucketSeconds: number, toExclusive?: boolean): Date[] {
  const b = bucketMs(bucketSeconds);
  const end = to.getTime();
  const starts: Date[] = [];
  for (let t = Math.floor(from.getTime() / b) * b; toExclusive ? t < end : t <= end; t += b) {
    starts.push(new Date(t));
  }
  return starts;
}

/**
 * Builds the zero-filled histogram from grouped `(bucket start, level, count)`
 * rows. Rows sharing a bucket and level are summed; zero counts are omitted
 * from `byLevel`. A row that is not one of the bucket starts throws.
 */
export function zeroFillHistogram(
  params: Pick<LogHistogramParams, 'from' | 'to' | 'toExclusive' | 'bucketSeconds'>,
  rows: { time: Date; level: LogLevel; count: number }[],
): LogHistogramResult {
  const starts = histogramBucketStarts(params.from, params.to, params.bucketSeconds, params.toExclusive);
  const buckets: LogHistogramBucket[] = starts.map((time) => ({ time, total: 0, byLevel: {} }));
  const index = new Map<number, number>();
  starts.forEach((d, k) => index.set(d.getTime(), k));
  for (const row of rows) {
    const k = index.get(row.time.getTime());
    if (k === undefined) throw new Error(`misaligned histogram bucket ${row.time.toISOString()}`);
    if (row.count === 0) continue;
    const bucket = buckets[k];
    bucket.total += row.count;
    bucket.byLevel[row.level] = (bucket.byLevel[row.level] ?? 0) + row.count;
  }
  return { buckets, bucketSeconds: params.bucketSeconds };
}

// ----------------------------------------------------------------------------
// Facets
// ----------------------------------------------------------------------------

/** `'level' | 'service' | 'hostname'`, or `'metadata.<key>'` for a metadata field. */
export function facetFieldName(field: LogFacetField): string {
  return 'builtin' in field ? field.builtin : `metadata.${field.metadata}`;
}

/**
 * One facet from per-value counts: empty values dropped, equal text forms
 * merged, ordered by count desc then byte order, cut to `limit`.
 * `otherCount` is `totalPresent` (matching logs with a present value) minus
 * the returned counts.
 */
export function buildFacet(
  field: LogFacetField,
  top: { value: string; count: number }[],
  totalPresent: number,
  limit: number,
): LogFacet {
  const merged = new Map<string, number>();
  for (const { value, count } of top) {
    if (value === '') continue;
    merged.set(value, (merged.get(value) ?? 0) + count);
  }
  const values = [...merged]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || compareByteOrder(a.value, b.value))
    .slice(0, Math.max(0, limit));
  const returned = values.reduce((sum, v) => sum + v.count, 0);
  return { field: facetFieldName(field), values, otherCount: Math.max(0, totalPresent - returned) };
}

// ----------------------------------------------------------------------------
// Metadata keys
// ----------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Key occurrences over sampled metadata: a top-level key whose value is not a
 * plain object counts as itself, a plain-object value counts `parent.child`
 * per child (not expanded further). A log counts once per key. Ordered by
 * occurrences desc, then key byte order.
 */
export function countMetadataKeys(metadatas: (Record<string, unknown> | null | undefined)[]): MetadataKeyOccurrence[] {
  const counts = new Map<string, number>();
  for (const metadata of metadatas) {
    if (!isPlainObject(metadata)) continue;
    const keys = new Set<string>();
    for (const [key, value] of Object.entries(metadata)) {
      if (isPlainObject(value)) {
        for (const child of Object.keys(value)) keys.add(`${key}.${child}`);
      } else {
        keys.add(key);
      }
    }
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, occurrences]) => ({ key, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences || compareByteOrder(a.key, b.key));
}

// ----------------------------------------------------------------------------
// Latency histogram
// ----------------------------------------------------------------------------

/**
 * Index into `counts` of LatencyHistogramResult: the first bound the duration
 * does not exceed (upper-inclusive, like Prometheus `le`), or the overflow
 * bucket after the last bound.
 */
export function latencyBucketIndex(durationMs: number): number {
  const bounds = LATENCY_HISTOGRAM_BOUNDS_MS;
  for (let i = 0; i < bounds.length; i++) {
    if (durationMs <= bounds[i]) return i;
  }
  return bounds.length;
}

// ----------------------------------------------------------------------------
// Sessions cursor
// ----------------------------------------------------------------------------

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Opaque, URL-safe cursor for the row `(lastEvent, sessionId)`. */
export function encodeSessionCursor(lastEvent: Date, sessionId: string): string {
  return Buffer.from(JSON.stringify({ t: lastEvent.toISOString(), s: sessionId }), 'utf8').toString('base64url');
}

/** Inverse of encodeSessionCursor; throws `RangeError('Invalid sessions cursor')` on anything else. */
export function decodeSessionCursor(cursor: string): { lastEvent: Date; sessionId: string } {
  const invalid = (): never => {
    throw new RangeError('Invalid sessions cursor');
  };
  if (typeof cursor !== 'string' || !BASE64URL.test(cursor)) return invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalid();
  }
  if (!isPlainObject(parsed)) return invalid();
  const { t, s } = parsed as { t?: unknown; s?: unknown };
  if (typeof t !== 'string' || !ISO_INSTANT.test(t) || typeof s !== 'string' || s === '') return invalid();
  const lastEvent = new Date(t);
  if (Number.isNaN(lastEvent.getTime()) || lastEvent.toISOString() !== t) return invalid();
  return { lastEvent, sessionId: s };
}
