import type { Document } from 'mongodb';
import { QueryTranslator, type NativeQuery } from '../../core/query-translator.js';
import { GLOBAL_SCOPE } from '../../core/types.js';
import type {
  AggregateParams,
  AggregationInterval,
  CountParams,
  DeleteByTimeRangeParams,
  DistinctParams,
  LogExclude,
  LogFilterParams,
  QueryParams,
  TopValuesParams,
} from '../../core/types.js';

import { compileTextQuery, resolveTextQuery } from './text-query.js';
import { compileJsonFilters } from './json-path.js';

/** Interval to milliseconds for $dateTrunc fallback */
const INTERVAL_MS: Record<AggregationInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export class MongoDBQueryTranslator extends QueryTranslator {
  constructor() {
    super();
  }

  translateQuery(params: QueryParams): NativeQuery {
    this.validatePagination(params.limit, params.offset);

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const sortDir = params.sortOrder === 'asc' ? 1 : -1;
    const sort = { time: sortDir, id: sortDir };
    const cursor = this.cursorClause(params.cursor, params.sortOrder);
    const filter = this.composeLogFilter(params, cursor ? [cursor] : []);

    return {
      query: filter,
      parameters: [],
      metadata: { limit, offset, sort },
    };
  }

  /** Keyset pagination clause for a `<iso time>,<id>` cursor; null when absent or undecodable. */
  private cursorClause(cursor: string | undefined, sortOrder: QueryParams['sortOrder']): Document | null {
    if (!cursor) return null;
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      const commaIdx = decoded.indexOf(',');
      if (commaIdx <= 0) return null;
      const parsedTime = new Date(decoded.slice(0, commaIdx));
      const cursorId = decoded.slice(commaIdx + 1);
      if (!cursorId || isNaN(parsedTime.getTime())) return null;
      const op = sortOrder === 'asc' ? '$gt' : '$lt';
      return { $or: [{ time: { [op]: parsedTime } }, { time: parsedTime, id: { [op]: cursorId } }] };
    } catch {
      return null;
    }
  }

  translateAggregate(params: AggregateParams): NativeQuery {
    const filter = this.buildBaseFilter(params);
    const intervalMs = INTERVAL_MS[params.interval];

    return {
      query: filter,
      parameters: [],
      metadata: { intervalMs, interval: params.interval },
    };
  }

  translateCount(params: CountParams): NativeQuery {
    const filter = this.buildLogFilter(params);
    return { query: filter, parameters: [] };
  }

  translateDistinct(params: DistinctParams): NativeQuery {
    this.validateFieldName(params.field);
    this.validatePagination(params.limit);

    const filter = this.buildBaseFilter(params);
    const mongoField = this.resolveMongoField(params.field);

    return {
      query: filter,
      parameters: [],
      metadata: { field: params.field, mongoField, limit: params.limit ?? 1000 },
    };
  }

  translateTopValues(params: TopValuesParams): NativeQuery {
    this.validateFieldName(params.field);
    this.validatePagination(params.limit);

    const filter = this.buildBaseFilter(params);
    const mongoField = this.resolveMongoField(params.field);

    return {
      query: filter,
      parameters: [],
      metadata: { field: params.field, mongoField, limit: params.limit ?? 10 },
    };
  }

  translateDelete(params: DeleteByTimeRangeParams): NativeQuery {
    const filter: Record<string, unknown> = {};

    // projectId
    if (Array.isArray(params.projectId)) {
      this.validateArrayFilter('project_id', params.projectId);
      filter.project_id = { $in: params.projectId };
    } else {
      filter.project_id = params.projectId;
    }

    // Time range: from inclusive, to exclusive (matches ClickHouse pattern)
    filter.time = { $gte: params.from, $lt: params.to };

    if (params.service !== undefined) {
      filter.service = this.toMongoFilter(params.service);
    }
    if (params.level !== undefined) {
      filter.level = this.toMongoFilter(params.level);
    }

    return { query: filter, parameters: [] };
  }

  /**
   * The log filter shared by query, count, countEstimate, histogram and
   * facets: equality fields at the top level plus ONE `$and` list that
   * receives every compound clause (cursor, text, metadata, exclude), so no
   * clause can overwrite another (an OR group next to a cursor `$or`, an
   * include next to an exclude on the same field).
   */
  buildLogFilter(params: LogFilterParams): Document {
    return this.composeLogFilter(params, []);
  }

  private composeLogFilter(params: LogFilterParams, leading: Document[]): Document {
    const filter: Document = this.buildBaseFilter(params);
    const and: Document[] = [...leading];

    if (params.traceId !== undefined) {
      filter.trace_id = params.traceId;
    }
    if (params.sessionId !== undefined) {
      filter.session_id = params.sessionId;
    }
    if (params.spanId !== undefined) {
      filter.span_id = params.spanId;
    }

    const text = resolveTextQuery(params);
    if (text) and.push(...compileTextQuery(text));

    // One clause per filter (repeated keys AND instead of overwriting), with
    // the dot-path and text-form rules of json-path.ts.
    if (params.metadataFilters && params.metadataFilters.length > 0) {
      and.push(...compileJsonFilters(params.metadataFilters, 'metadata'));
    }

    if (params.exclude) {
      and.push(...excludeClauses(params.exclude));
    }

    if (and.length > 0) filter.$and = and;
    return filter;
  }

  /**
   * Build base filter with projectId, time range, service, level, hostname.
   * Shared across query, aggregate, count, distinct, topValues.
   * When projectId === GLOBAL_SCOPE the project_id filter is omitted (admin queries).
   */
  private buildBaseFilter(params: {
    projectId: string | string[] | typeof GLOBAL_SCOPE;
    service?: string | string[];
    level?: string | string[];
    hostname?: string | string[];
    from: Date;
    to: Date;
    fromExclusive?: boolean;
    toExclusive?: boolean;
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (params.projectId !== GLOBAL_SCOPE) {
      filter.project_id = this.toMongoFilter(params.projectId);
    }

    // Time range
    const timeFilter: Record<string, Date> = {};
    timeFilter[params.fromExclusive ? '$gt' : '$gte'] = params.from;
    timeFilter[params.toExclusive ? '$lt' : '$lte'] = params.to;
    filter.time = timeFilter;

    if (params.service !== undefined) {
      filter.service = this.toMongoFilter(params.service);
    }
    if (params.level !== undefined) {
      filter.level = this.toMongoFilter(params.level);
    }
    // Ingestion stores the hostname in metadata.hostname (indexed with project and time).
    if (params.hostname !== undefined) {
      this.validateArrayFilter('hostname', params.hostname);
      filter['metadata.hostname'] = this.toMongoFilter(params.hostname);
    }

    return filter;
  }

  /**
   * Convert a string | string[] value to a MongoDB filter value.
   * Single string → exact match, array → $in.
   */
  private toMongoFilter(value: string | string[]): string | { $in: string[] } {
    if (Array.isArray(value)) {
      this.validateArrayFilter('filter', value);
      return { $in: value };
    }
    return value;
  }

  /** Resolve a field name to its MongoDB document path (dot notation works natively) */
  private resolveMongoField(field: string): string {
    return field;
  }
}

/**
 * Typed-field exclusions as `$nin` clauses. A bare `$nin` also matches
 * documents without the field, so logs without a hostname are kept; empty
 * lists add nothing.
 */
function excludeClauses(exclude: LogExclude): Document[] {
  const out: Document[] = [];
  if (exclude.service && exclude.service.length > 0) out.push({ service: { $nin: exclude.service } });
  if (exclude.level && exclude.level.length > 0) out.push({ level: { $nin: exclude.level } });
  if (exclude.hostname && exclude.hostname.length > 0) out.push({ 'metadata.hostname': { $nin: exclude.hostname } });
  return out;
}

export { INTERVAL_MS };
