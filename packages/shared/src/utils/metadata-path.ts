// ============================================================================
// Metadata path resolution (log search, live tail, columns, dashboard panels)
// ============================================================================
// One rule for the matcher, the reference engine and the three storage
// engines (which compile the same candidate list from
// `metadataPathCandidates`), so a key resolves to the same value everywhere.
//
// A key is split on "." into segments. It resolves through the first of these
// key sequences that exists, in this order:
// 1. the whole key as one literal key ("geo.city" beats geo -> city);
// 2. a leading key, zero or more plain segments, then a trailing key, where
//    the leading and trailing keys may span several segments: longest
//    leading key first, then longest trailing key. So OTLP resource
//    attributes (`resource` -> "service.name") and structured bodies
//    ("otel.body" -> user -> id) resolve, and the plain nested walk
//    (a -> b -> c) comes last.
// Keys with more than METADATA_PATH_MAX_SPLIT_SEGMENTS segments only try the
// literal key and the plain nested walk, which bounds the generated queries.
// Every step reads an own property of a plain object; a JSON null stops the
// resolution with the value null.

/** Segment count up to which a key also tries the leading/trailing literal splits. */
export const METADATA_PATH_MAX_SPLIT_SEGMENTS = 8;

const candidateCache = new Map<string, readonly (readonly string[])[]>();
const CANDIDATE_CACHE_LIMIT = 1000;

function buildCandidates(path: string): string[][] {
  const segments = path.split('.');
  const n = segments.length;
  if (n === 1) return [[path]];
  const out: string[][] = [[path]];
  if (n > METADATA_PATH_MAX_SPLIT_SEGMENTS) {
    out.push(segments);
    return out;
  }
  for (let lead = n - 1; lead >= 1; lead--) {
    for (let tail = n - lead; tail >= 1; tail--) {
      out.push([
        segments.slice(0, lead).join('.'),
        ...segments.slice(lead, n - tail),
        segments.slice(n - tail).join('.'),
      ]);
    }
  }
  return out;
}

/**
 * The key sequences `path` may resolve through, in precedence order (see the
 * header). Engines compile exactly this list; the first sequence that exists
 * decides the value. Returns fresh arrays.
 */
export function metadataPathCandidates(path: string): string[][] {
  return cachedCandidates(path).map((keys) => [...keys]);
}

function cachedCandidates(path: string): readonly (readonly string[])[] {
  let cached = candidateCache.get(path);
  if (!cached) {
    cached = buildCandidates(path);
    if (candidateCache.size >= CANDIDATE_CACHE_LIMIT) candidateCache.clear();
    candidateCache.set(path, cached);
  }
  return cached;
}

const MISSING = Symbol('missing');

function walk(root: unknown, keys: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return MISSING;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return MISSING;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function resolveMetadataPath(
  metadata: Record<string, unknown> | null | undefined,
  path: string
): unknown {
  if (!metadata) return undefined;
  if (Object.prototype.hasOwnProperty.call(metadata, path)) return metadata[path];
  if (!path.includes('.')) return undefined;
  const candidates = cachedCandidates(path);
  // Candidate 0 is the literal key, checked above.
  for (let i = 1; i < candidates.length; i++) {
    const value = walk(metadata, candidates[i]);
    if (value !== MISSING) return value;
  }
  return undefined;
}

/**
 * Project a resolved metadata value into a table cell string.
 * null/undefined -> null (callers render their own placeholder);
 * objects/arrays -> JSON; scalars -> String().
 */
export function formatMetadataCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
