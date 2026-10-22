// Limits and defaults of the 1.6 reservoir contract (spec 6.4, plan D6).
// The client enforces them before any engine call; engines may rely on them.

import type { SpanKind } from './types.js';

/** Most buckets one histogram call may return. */
export const MAX_HISTOGRAM_BUCKETS = 1000;

export const FACETS_DEFAULT_LIMIT = 10;
export const FACETS_MAX_LIMIT = 50;
export const FACETS_MAX_FIELDS = 20;

export const DISCOVER_DEFAULT_SAMPLE_SIZE = 1000;
export const DISCOVER_MAX_SAMPLE_SIZE = 5000;
/** Most keys one discoverMetadataKeys call returns (busiest first, then key byte order). */
export const DISCOVER_MAX_KEYS = 500;

export const OPERATION_STATS_DEFAULT_LIMIT = 100;
export const OPERATION_STATS_MAX_LIMIT = 500;

/** Entry span kinds used by getOperationStats and getLatencyHistogram when `kinds` is omitted. */
export const DEFAULT_OPERATION_KINDS: readonly SpanKind[] = Object.freeze(['SERVER', 'CONSUMER'] as SpanKind[]);

/** Upper-inclusive latency bucket bounds in milliseconds (log scaled, 1 ms to 60 s). */
export const LATENCY_HISTOGRAM_BOUNDS_MS: readonly number[] = Object.freeze([
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000,
]);

/** Largest sessions page. */
export const SESSIONS_MAX_LIMIT = 200;
