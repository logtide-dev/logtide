// Which keys the facet sidebar shows: the three built-ins, then up to eight
// metadata keys (the user's pins first, then the most frequent discovered
// keys). Facet keys are grammar keys, so a click on a value can always be
// written into `q` as `key:value`.

import { resolveFieldKey } from '@logtide/shared';
import type { LogFieldInfo } from '$lib/api/logs';
import { isQueryableKey } from './query-edit';

export const BUILTIN_FACET_KEYS = ['level', 'service', 'host'] as const;
export const MAX_METADATA_FACETS = 8;
/** Values per facet asked from `GET /api/v1/logs/facets` (`limit`). */
export const FACET_VALUE_LIMIT = 10;

const EXCLUDED_KEYS = new Set(['hostname', 'breadcrumbs']);

/** A metadata key a facet can filter on: queryable and not a built-in or one of its aliases. */
function isMetadataFacetKey(key: string): boolean {
  if (EXCLUDED_KEYS.has(key) || key.startsWith('breadcrumbs.')) return false;
  if (!isQueryableKey(key)) return false;
  const ref = resolveFieldKey(key);
  return ref !== null && !('builtin' in ref);
}

/**
 * Discovered metadata keys usable as facets, most frequent first (ties by
 * key). Keys that are the parent of another discovered key (`geo` next to
 * `geo.city`) hold objects, not values, so they are dropped.
 */
export function facetCandidates(discovered: LogFieldInfo[]): string[] {
  const keys = discovered.map((f) => f.key);
  const isParent = (key: string) => keys.some((other) => other.startsWith(`${key}.`));
  const best = new Map<string, number>();
  for (const { key, occurrences } of discovered) {
    if (!isMetadataFacetKey(key) || isParent(key)) continue;
    best.set(key, Math.max(best.get(key) ?? 0, occurrences));
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key]) => key);
}

/** Pins (in pin order, queryable only) then candidates, deduped, at most `MAX_METADATA_FACETS`. */
export function selectMetadataFacetKeys(pinned: string[], discovered: LogFieldInfo[]): string[] {
  const out: string[] = [];
  for (const key of [...pinned.filter(isMetadataFacetKey), ...facetCandidates(discovered)]) {
    if (out.length >= MAX_METADATA_FACETS) break;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}
