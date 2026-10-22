// ============================================================================
// buildLogFilter: the single entry point from request params to reservoir
// filter params (REST search/count/histogram/facets, live tail, saved
// searches). It owns no compiler: the grammar is F3's `parseLogQuery`, the
// mapping is F3's `compileLogSearch` + `mergeCompiledSearch` from
// `@logtide/reservoir`. If a query parses and compiles incorrectly, the fix
// belongs there, not here.
// ============================================================================

import { legacySubstringQuery, metadataFiltersSchema, parseLogQuery } from '@logtide/shared';
import type { LogLevel, LogSearchQuery, MetadataFilter } from '@logtide/shared';
import { compileLogSearch, mergeCompiledSearch } from '@logtide/reservoir';
import type { QueryParams } from '@logtide/reservoir';

export type SearchMode = 'fulltext' | 'substring';

export const LOG_QUERY_MAX_LENGTH = 2000;
export const MAX_METADATA_FILTERS = 10;

export interface LogSearchInput {
  q?: string;
  searchMode?: SearchMode;
  service?: string | string[];
  level?: LogLevel | LogLevel[];
  hostname?: string | string[];
  traceId?: string;
  sessionId?: string;
  metadata_filters?: MetadataFilter[];
}

export type BuiltLogFilter = {
  filter: Pick<
    QueryParams,
    'service' | 'level' | 'hostname' | 'traceId' | 'sessionId' | 'spanId' | 'textQuery' | 'exclude' | 'metadataFilters'
  > & { matchNothing?: boolean };
  /** Parsed q (levels lowercased by the parser); an empty query when there is no q. */
  query: LogSearchQuery;
};

/** Any problem with `q` (syntax or semantics); the routes answer 400 `{ error, position }`. */
export class LogQueryError extends Error {
  readonly statusCode = 400;
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'LogQueryError';
    this.position = position;
  }
}

const emptyQuery = (): LogSearchQuery => ({ text: { all: [], anyOf: [], none: [] }, fields: [] });

const asList = <T>(value: T | T[]): T[] => (Array.isArray(value) ? [...value] : [value]);

function parseQuery(q: string | undefined, searchMode: SearchMode | undefined): LogSearchQuery {
  if (q === undefined || q === null) return emptyQuery();
  if (q.length > LOG_QUERY_MAX_LENGTH) {
    throw new LogQueryError(
      `Queries can be at most ${LOG_QUERY_MAX_LENGTH.toLocaleString('en-US')} characters`,
      LOG_QUERY_MAX_LENGTH,
    );
  }
  if (q.trim() === '') return emptyQuery();
  if (searchMode === 'substring') return legacySubstringQuery(q);
  const result = parseLogQuery(q);
  if (!result.ok) throw new LogQueryError(result.error.message, result.error.position);
  return result.query;
}

function legacyBase(input: LogSearchInput): Partial<QueryParams> {
  const base: Partial<QueryParams> = {};
  if (input.service !== undefined) base.service = asList(input.service);
  if (input.level !== undefined) base.level = asList(input.level);
  if (input.hostname !== undefined) base.hostname = asList(input.hostname);
  if (input.traceId !== undefined) base.traceId = input.traceId;
  if (input.sessionId !== undefined) base.sessionId = input.sessionId;
  if (input.metadata_filters !== undefined && input.metadata_filters.length > 0) {
    base.metadataFilters = [...input.metadata_filters];
  }
  return base;
}

/** Throws LogQueryError for an invalid or too long `q`, or too many metadata filters. */
export function buildLogFilter(input: LogSearchInput): BuiltLogFilter {
  const query = parseQuery(input.q, input.searchMode);
  const merged = mergeCompiledSearch(legacyBase(input), compileLogSearch(query));

  const filter: BuiltLogFilter['filter'] = {};
  if (merged.service !== undefined) filter.service = merged.service;
  if (merged.level !== undefined) filter.level = merged.level;
  if (merged.hostname !== undefined) filter.hostname = merged.hostname;
  if (merged.traceId !== undefined) filter.traceId = merged.traceId;
  if (merged.sessionId !== undefined) filter.sessionId = merged.sessionId;
  if (merged.spanId !== undefined) filter.spanId = merged.spanId;
  if (merged.textQuery !== undefined) filter.textQuery = merged.textQuery;
  if (merged.exclude !== undefined) filter.exclude = merged.exclude;
  if (merged.matchNothing) filter.matchNothing = true;

  if (merged.metadataFilters !== undefined && merged.metadataFilters.length > 0) {
    if (merged.metadataFilters.length > MAX_METADATA_FILTERS) {
      throw new LogQueryError(
        `At most ${MAX_METADATA_FILTERS.toLocaleString('en-US')} metadata filters are allowed per query`,
        0,
      );
    }
    const checked = metadataFiltersSchema.safeParse(merged.metadataFilters);
    if (!checked.success) throw new LogQueryError('Invalid metadata filters', 0);
    filter.metadataFilters = checked.data;
  }

  return { filter, query };
}
