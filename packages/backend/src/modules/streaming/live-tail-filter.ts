// Live tail matcher: decides in memory whether a freshly ingested log goes to
// a live tail subscriber. Legacy service / level / hostname lists behave as
// before; the parsed query is evaluated with F3's `matchesLogSearch`, the
// same oracle the engines are checked against, so live tail and search agree.

import { matchesLogSearch, type FieldClause, type LogSearchQuery, type MetadataFilter } from '@logtide/shared';

export interface LiveTailLog {
  service: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  traceId?: string | null;
  sessionId?: string | null;
  spanId?: string | null;
  hostname?: string | null;
}

export interface LiveTailFilterOptions {
  services?: string[];
  levels?: string[];
  hostnames?: string[];
  query?: LogSearchQuery;
}

type MatchableLog = Parameters<typeof matchesLogSearch>[0];

/** Where ingestion stores the host: `metadata.hostname`, when it is a string. */
function metadataHostname(log: LiveTailLog): string | undefined {
  const value = log.metadata?.hostname;
  return typeof value === 'string' ? value : undefined;
}

/** The shape `matchesLogSearch` reads; `hostname` is the top-level host, else `metadata.hostname`. */
export function toMatchableLog(log: LiveTailLog): MatchableLog {
  return {
    message: log.message,
    level: log.level,
    service: log.service,
    hostname: log.hostname ?? metadataHostname(log) ?? null,
    traceId: log.traceId ?? null,
    sessionId: log.sessionId ?? null,
    spanId: log.spanId ?? null,
    metadata: log.metadata ?? null,
  };
}

/**
 * Legacy `metadata_filters` as query field clauses, so live tail evaluates them
 * with the same matcher as `q`. Negative operators keep missing keys (the same
 * default the REST adapter applies); an explicit `include_missing` that differs
 * from the operator default is not expressible here and is ignored.
 */
export function metadataFiltersToClauses(filters: MetadataFilter[]): FieldClause[] {
  return filters.map((f): FieldClause => {
    const field = { metadata: f.key };
    if (f.op === 'in' || f.op === 'not_in') return { field, op: f.op, values: [...(f.values ?? [])] };
    if (f.op === 'exists' || f.op === 'not_exists') return { field, op: f.op };
    return { field, op: f.op, value: f.value };
  });
}

const hasQuery = (query: LogSearchQuery | undefined): query is LogSearchQuery =>
  query !== undefined &&
  (query.fields.length > 0 || query.text.all.length > 0 || query.text.anyOf.length > 0 || query.text.none.length > 0);

/**
 * A predicate for live tail: every non-empty list must contain the log's
 * value (the host comes from `metadata.hostname`; a missing or non-string
 * host fails a hostname list) AND the log must match the query.
 */
export function createLiveTailFilter(opts: LiveTailFilterOptions): (log: LiveTailLog) => boolean {
  const services = opts.services && opts.services.length > 0 ? new Set(opts.services) : undefined;
  const levels = opts.levels && opts.levels.length > 0 ? new Set(opts.levels) : undefined;
  const hostnames = opts.hostnames && opts.hostnames.length > 0 ? new Set(opts.hostnames) : undefined;
  const query = hasQuery(opts.query) ? opts.query : undefined;

  return (log) => {
    if (services && !services.has(log.service)) return false;
    if (levels && !levels.has(log.level)) return false;
    if (hostnames) {
      const host = metadataHostname(log);
      if (!host || !hostnames.has(host)) return false;
    }
    return query ? matchesLogSearch(toMatchableLog(log), query) : true;
  };
}
