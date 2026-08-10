// ============================================================================
// Metadata path resolution (Log Search custom columns + log_table panel)
// ============================================================================
// Semantics: an exact metadata key match wins first (so a literal key
// "geo.city" beats traversal), then the path is split on "." and walked
// through nested objects. Shared so backend fetchers, dashboard panels and
// the Search page resolve columns identically.

export function resolveMetadataPath(
  metadata: Record<string, unknown> | null | undefined,
  path: string
): unknown {
  if (!metadata) return undefined;
  if (Object.prototype.hasOwnProperty.call(metadata, path)) return metadata[path];
  let current: unknown = metadata;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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
