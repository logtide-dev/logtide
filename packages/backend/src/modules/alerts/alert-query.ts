import { parseLogQuery, type LogLevel, type MetadataFilter } from '@logtide/shared';
import { compileLogSearch, mergeCompiledSearch, type CountParams } from '@logtide/reservoir';

/**
 * Thin adapter between an alert rule and the shared log query compiler (F3).
 * W8 adds no grammar rules and no rejections of its own: every restriction is
 * a parser error with a position, and a contradiction between the query and
 * the rule's own filters merges to `matchNothing` (count 0, never breaches).
 */

const FILTER_KEYS = [
  'level',
  'service',
  'hostname',
  'traceId',
  'sessionId',
  'spanId',
  'textQuery',
  'exclude',
  'metadataFilters',
] as const;

export type AlertLogFilter = Pick<CountParams, (typeof FILTER_KEYS)[number]> & { matchNothing?: boolean };

export interface AlertQueryInput {
  query: string | null;
  level: LogLevel[];
  service: string | null;
  metadataFilters: MetadataFilter[];
}

export type CompileAlertQueryResult =
  | { ok: true; filter: AlertLogFilter }
  | { ok: false; error: { message: string; position: number } };

/** Trim; blank (or missing) becomes null. */
export function normalizeAlertQuery(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function compileAlertQuery(input: AlertQueryInput): CompileAlertQueryResult {
  // Base params exactly as rules were evaluated before 1.6: rule levels, the
  // legacy [service, 'unknown'] list and the rule's metadata filters.
  const base: AlertLogFilter = {
    level: [...input.level],
    ...(input.service ? { service: [input.service, 'unknown'] } : {}),
    metadataFilters: [...input.metadataFilters],
  };

  const query = normalizeAlertQuery(input.query);
  if (query === null) return { ok: true, filter: base };

  const parsed = parseLogQuery(query);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const merged = mergeCompiledSearch(base, compileLogSearch(parsed.query));
  const filter: AlertLogFilter = {};
  for (const key of FILTER_KEYS) {
    if (merged[key] !== undefined) (filter as Record<string, unknown>)[key] = merged[key];
  }
  if (merged.matchNothing) filter.matchNothing = true;
  return { ok: true, filter };
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((v) => isEmpty(v));
  }
  return false;
}

/**
 * Drops undefined and empty keys, so a rule without a query sends exactly
 * the params it sent before 1.6. `matchNothing` passes through when set.
 */
export function filterToReservoirParams(filter: AlertLogFilter): AlertLogFilter {
  const out: AlertLogFilter = {};
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (typeof value === 'string' ? value.length === 0 : isEmpty(value)) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  if (filter.matchNothing) out.matchNothing = true;
  return out;
}
