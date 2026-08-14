import { QueryTranslator, type NativeQuery } from '../../core/query-translator.js';
import { GLOBAL_SCOPE } from '../../core/types.js';
import type {
  AggregateParams,
  AggregationInterval,
  CountParams,
  DeleteByTimeRangeParams,
  DistinctParams,
  MetadataFilter,
  QueryParams,
  TopValuesParams,
} from '../../core/types.js';

/** ClickHouse can't parse 0 as DateTime64(3) - clamp to 1ms after epoch */
export function toDateTime64(date: Date): number {
  return Math.max(date.getTime() / 1000, 0.001);
}

/** hasToken() rejects needles with non-alphanumeric (separator) characters */
function hasTokenSeparator(search: string): boolean {
  return /[^a-zA-Z0-9]/.test(search);
}

const INTERVAL_MAP: Record<AggregationInterval, string> = {
  '1m': '1 MINUTE',
  '5m': '5 MINUTE',
  '15m': '15 MINUTE',
  '1h': '1 HOUR',
  '6h': '6 HOUR',
  '1d': '1 DAY',
  '1w': '1 WEEK',
};

export class ClickHouseQueryTranslator extends QueryTranslator {
  private tableName: string;

  constructor(tableName = 'logs') {
    super();
    this.tableName = tableName;
  }

  translateQuery(params: QueryParams): NativeQuery {
    this.validatePagination(params.limit, params.offset);

    const prewhere: string[] = [];
    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    // High-selectivity filters go in PREWHERE
    if (params.projectId !== GLOBAL_SCOPE) {
      this.pushClickHouseFilter(prewhere, queryParams, 'project_id', params.projectId);
    }

    prewhere.push(`time ${params.fromExclusive ? '>' : '>='} {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    prewhere.push(`time ${params.toExclusive ? '<' : '<='} {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.traceId !== undefined) {
      prewhere.push(`trace_id = {p_trace_id:String}`);
      queryParams.p_trace_id = params.traceId;
    }
    if (params.sessionId !== undefined) {
      prewhere.push(`session_id = {p_session_id:String}`);
      queryParams.p_session_id = params.sessionId;
    }

    // Lower-selectivity filters go in WHERE
    if (params.service !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'service', params.service);
    }
    if (params.level !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'level', params.level);
    }

    if (params.hostname !== undefined) {
      this.validateArrayFilter('hostname', params.hostname);
      if (Array.isArray(params.hostname)) {
        conditions.push(`JSONExtractString(metadata, 'hostname') IN {p_hostname:Array(String)}`);
        queryParams.p_hostname = params.hostname;
      } else {
        conditions.push(`JSONExtractString(metadata, 'hostname') = {p_hostname:String}`);
        queryParams.p_hostname = params.hostname;
      }
    }

    if (params.search) {
      if (params.searchMode === 'substring' || hasTokenSeparator(params.search)) {
        conditions.push(`positionCaseInsensitive(message, {p_search:String}) > 0`);
        queryParams.p_search = params.search;
      } else {
        conditions.push(`hasToken(lower(message), {p_search:String})`);
        queryParams.p_search = params.search.toLowerCase();
      }
    }

    if (params.metadataFilters && params.metadataFilters.length > 0) {
      this.pushMetadataFilters(conditions, queryParams, params.metadataFilters);
    }

    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64').toString('utf-8');
        const commaIdx = decoded.indexOf(',');
        if (commaIdx > 0) {
          const cursorTime = decoded.slice(0, commaIdx);
          const cursorId = decoded.slice(commaIdx + 1);
          const parsedTime = new Date(cursorTime);
          if (cursorId && !isNaN(parsedTime.getTime())) {
            conditions.push(`(time, id) < ({p_cursor_time:DateTime64(3)}, {p_cursor_id:UUID})`);
            queryParams.p_cursor_time = toDateTime64(parsedTime);
            queryParams.p_cursor_id = cursorId;
          }
        }
      } catch {
        // invalid cursor - skip
      }
    }

    const prewhereClause = prewhere.length > 0 ? ` PREWHERE ${prewhere.join(' AND ')}` : '';
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const sortOrder = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let query = `SELECT * FROM ${this.tableName}${prewhereClause}${whereClause} ORDER BY time ${sortOrder}, id ${sortOrder} LIMIT {p_limit:UInt32}`;
    queryParams.p_limit = limit + 1;

    if (offset > 0) {
      query += ` OFFSET {p_offset:UInt32}`;
      queryParams.p_offset = offset;
    }

    return { query, parameters: [queryParams], metadata: { limit } };
  }

  translateAggregate(params: AggregateParams): NativeQuery {
    const prewhere: string[] = [];
    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    const interval = INTERVAL_MAP[params.interval];

    if (params.projectId !== GLOBAL_SCOPE) {
      this.pushClickHouseFilter(prewhere, queryParams, 'project_id', params.projectId);
    }

    prewhere.push(`time >= {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    prewhere.push(`time <= {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.service !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'service', params.service);
    }

    const prewhereClause = prewhere.length > 0 ? ` PREWHERE ${prewhere.join(' AND ')}` : '';
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const query = `SELECT toStartOfInterval(time, INTERVAL ${interval}) AS bucket, level, count() AS total FROM ${this.tableName}${prewhereClause}${whereClause} GROUP BY bucket, level ORDER BY bucket ASC`;

    return { query, parameters: [queryParams] };
  }

  translateCount(params: CountParams): NativeQuery {
    const prewhere: string[] = [];
    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    if (params.projectId !== GLOBAL_SCOPE) {
      this.pushClickHouseFilter(prewhere, queryParams, 'project_id', params.projectId);
    }

    prewhere.push(`time ${params.fromExclusive ? '>' : '>='} {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    prewhere.push(`time ${params.toExclusive ? '<' : '<='} {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.service !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'service', params.service);
    }
    if (params.level !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'level', params.level);
    }
    if (params.hostname !== undefined) {
      this.validateArrayFilter('hostname', params.hostname);
      if (Array.isArray(params.hostname)) {
        conditions.push(`JSONExtractString(metadata, 'hostname') IN {p_hostname:Array(String)}`);
        queryParams.p_hostname = params.hostname;
      } else {
        conditions.push(`JSONExtractString(metadata, 'hostname') = {p_hostname:String}`);
        queryParams.p_hostname = params.hostname;
      }
    }
    if (params.traceId !== undefined) {
      conditions.push(`trace_id = {p_trace_id:String}`);
      queryParams.p_trace_id = params.traceId;
    }
    if (params.sessionId !== undefined) {
      conditions.push(`session_id = {p_session_id:String}`);
      queryParams.p_session_id = params.sessionId;
    }

    if (params.search) {
      if (params.searchMode === 'substring' || hasTokenSeparator(params.search)) {
        conditions.push(`positionCaseInsensitive(message, {p_search:String}) > 0`);
        queryParams.p_search = params.search;
      } else {
        conditions.push(`hasToken(lower(message), {p_search:String})`);
        queryParams.p_search = params.search.toLowerCase();
      }
    }

    if (params.metadataFilters && params.metadataFilters.length > 0) {
      this.pushMetadataFilters(conditions, queryParams, params.metadataFilters);
    }

    const prewhereClause = prewhere.length > 0 ? ` PREWHERE ${prewhere.join(' AND ')}` : '';
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT count() AS count FROM ${this.tableName}${prewhereClause}${whereClause}`;
    return { query, parameters: [queryParams] };
  }

  translateDistinct(params: DistinctParams): NativeQuery {
    this.validateFieldName(params.field);
    this.validatePagination(params.limit);

    const prewhere: string[] = [];
    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    if (params.projectId !== GLOBAL_SCOPE) {
      this.pushClickHouseFilter(prewhere, queryParams, 'project_id', params.projectId);
    }

    prewhere.push(`time ${params.fromExclusive ? '>' : '>='} {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    prewhere.push(`time ${params.toExclusive ? '<' : '<='} {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.service !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'service', params.service);
    }
    if (params.level !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'level', params.level);
    }
    if (params.hostname !== undefined) {
      this.validateArrayFilter('hostname', params.hostname);
      if (Array.isArray(params.hostname)) {
        conditions.push(`JSONExtractString(metadata, 'hostname') IN {p_hostname:Array(String)}`);
        queryParams.p_hostname = params.hostname;
      } else {
        conditions.push(`JSONExtractString(metadata, 'hostname') = {p_hostname:String}`);
        queryParams.p_hostname = params.hostname;
      }
    }

    const prewhereClause = prewhere.length > 0 ? ` PREWHERE ${prewhere.join(' AND ')}` : '';
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = params.limit ? ` LIMIT {p_limit:UInt32}` : '';
    if (params.limit) queryParams.p_limit = params.limit;

    let query: string;
    if (params.field === 'metadata.hostname') {
      // Use the materialized `hostname` column - pre-computed at ingest, no JSON parsing at query time.
      // Fast path: ClickHouse reads only the native string column, skipping the entire metadata blob.
      const fullWhere = [...conditions, `hostname != ''`];
      const whereAll = fullWhere.length > 0 ? ` WHERE ${fullWhere.join(' AND ')}` : '';
      query = `SELECT DISTINCT hostname AS value FROM ${this.tableName}${prewhereClause}${whereAll} ORDER BY value ASC${limitClause}`;
    } else if (params.field.startsWith('metadata.')) {
      // For other metadata fields: extract JSON once in a subquery instead of 3x per row.
      // JSONExtractString always returns '' for missing keys - IS NOT NULL is redundant.
      const jsonKey = params.field.slice('metadata.'.length);
      const extract = `JSONExtractString(metadata, '${jsonKey}')`;
      query = `SELECT DISTINCT value FROM (SELECT ${extract} AS value FROM ${this.tableName}${prewhereClause}${whereClause}) WHERE value != '' ORDER BY value ASC${limitClause}`;
    } else {
      const selectExpr = params.field;
      conditions.push(`${selectExpr} IS NOT NULL`);
      conditions.push(`${selectExpr} != ''`);
      const fullWhere = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
      query = `SELECT DISTINCT ${selectExpr} AS value FROM ${this.tableName}${prewhereClause}${fullWhere} ORDER BY value ASC${limitClause}`;
    }

    return { query, parameters: [queryParams] };
  }

  translateTopValues(params: TopValuesParams): NativeQuery {
    this.validateFieldName(params.field);
    this.validatePagination(params.limit);

    const prewhere: string[] = [];
    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    if (params.projectId !== GLOBAL_SCOPE) {
      this.pushClickHouseFilter(prewhere, queryParams, 'project_id', params.projectId);
    }

    prewhere.push(`time ${params.fromExclusive ? '>' : '>='} {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    prewhere.push(`time ${params.toExclusive ? '<' : '<='} {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.service !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'service', params.service);
    }
    if (params.level !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'level', params.level);
    }
    if (params.hostname !== undefined) {
      this.validateArrayFilter('hostname', params.hostname);
      if (Array.isArray(params.hostname)) {
        conditions.push(`JSONExtractString(metadata, 'hostname') IN {p_hostname:Array(String)}`);
        queryParams.p_hostname = params.hostname;
      } else {
        conditions.push(`JSONExtractString(metadata, 'hostname') = {p_hostname:String}`);
        queryParams.p_hostname = params.hostname;
      }
    }

    let selectExpr: string;
    if (params.field.startsWith('metadata.')) {
      const jsonKey = params.field.slice('metadata.'.length);
      selectExpr = `JSONExtractString(metadata, '${jsonKey}')`;
    } else {
      selectExpr = params.field;
    }

    conditions.push(`${selectExpr} IS NOT NULL`);
    conditions.push(`${selectExpr} != ''`);

    const prewhereClause = prewhere.length > 0 ? ` PREWHERE ${prewhere.join(' AND ')}` : '';
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const lastSeenExpr = params.includeLastSeen ? ', max(time) AS last_seen' : '';
    let query = `SELECT ${selectExpr} AS value, count() AS count${lastSeenExpr} FROM ${this.tableName}${prewhereClause}${whereClause} GROUP BY value ORDER BY count DESC`;

    if (params.limit) {
      query += ` LIMIT {p_limit:UInt32}`;
      queryParams.p_limit = params.limit;
    }

    return { query, parameters: [queryParams] };
  }

  translateDelete(params: DeleteByTimeRangeParams): NativeQuery {
    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    if (Array.isArray(params.projectId)) {
      this.validateArrayFilter('project_id', params.projectId);
      conditions.push(`project_id IN {p_project_id:Array(String)}`);
      queryParams.p_project_id = params.projectId;
    } else {
      conditions.push(`project_id = {p_project_id:String}`);
      queryParams.p_project_id = params.projectId;
    }

    conditions.push(`time >= {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    conditions.push(`time < {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.service !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'service', params.service);
    }
    if (params.level !== undefined) {
      this.pushClickHouseFilter(conditions, queryParams, 'level', params.level);
    }

    const where = ` WHERE ${conditions.join(' AND ')}`;
    const query = `ALTER TABLE ${this.tableName} DELETE${where}`;
    return { query, parameters: [queryParams] };
  }

  /**
   * Translate metadata filters into ClickHouse predicates over the JSON `metadata` column.
   * JSONExtractString returns '' for missing keys, so JSONHas is used to distinguish
   * "key absent" from "key present but empty" when include_missing matters.
   */
  private pushMetadataFilters(
    conditions: string[],
    queryParams: Record<string, unknown>,
    filters: MetadataFilter[],
  ): void {
    filters.forEach((f, i) => {
      const keyParam = `p_mfk${i}`;
      const valParam = `p_mfv${i}`;
      queryParams[keyParam] = f.key;
      const extract = `JSONExtractString(metadata, {${keyParam}:String})`;
      const has = `JSONHas(metadata, {${keyParam}:String})`;

      switch (f.op) {
        case 'equals': {
          conditions.push(`${extract} = {${valParam}:String}`);
          queryParams[valParam] = f.value;
          break;
        }
        case 'not_equals': {
          queryParams[valParam] = f.value;
          if (f.include_missing) {
            conditions.push(`(${has} = 0 OR ${extract} != {${valParam}:String})`);
          } else {
            conditions.push(`(${has} = 1 AND ${extract} != {${valParam}:String})`);
          }
          break;
        }
        case 'in': {
          conditions.push(`${extract} IN ({${valParam}:Array(String)})`);
          queryParams[valParam] = f.values;
          break;
        }
        case 'not_in': {
          queryParams[valParam] = f.values;
          if (f.include_missing) {
            conditions.push(`(${has} = 0 OR ${extract} NOT IN ({${valParam}:Array(String)}))`);
          } else {
            conditions.push(`(${has} = 1 AND ${extract} NOT IN ({${valParam}:Array(String)}))`);
          }
          break;
        }
        case 'exists': {
          conditions.push(`${has} = 1`);
          break;
        }
        case 'not_exists': {
          conditions.push(`${has} = 0`);
          break;
        }
        case 'contains': {
          conditions.push(`positionCaseInsensitive(${extract}, {${valParam}:String}) > 0`);
          queryParams[valParam] = f.value ?? '';
          break;
        }
      }
    });
  }

  private pushClickHouseFilter(
    conditions: string[],
    queryParams: Record<string, unknown>,
    column: string,
    value: string | string[],
  ): void {
    this.validateArrayFilter(column, value);
    const paramName = `p_${column}`;
    if (Array.isArray(value)) {
      conditions.push(`${column} IN {${paramName}:Array(String)}`);
      queryParams[paramName] = value;
    } else {
      conditions.push(`${column} = {${paramName}:String}`);
      queryParams[paramName] = value;
    }
  }
}
