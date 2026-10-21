import { QueryTranslator, type NativeQuery } from '../../core/query-translator.js';
import { GLOBAL_SCOPE } from '../../core/types.js';
import type {
  AggregateParams,
  AggregationInterval,
  CountParams,
  DeleteByTimeRangeParams,
  DistinctParams,
  LogFilterParams,
  LogHistogramParams,
  QueryParams,
  TopValuesParams,
} from '../../core/types.js';
import { compileTextQuery, resolveTextQuery } from './text-query.js';
import { compileJsonFilters } from './json-path.js';

const INTERVAL_MAP: Record<AggregationInterval, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '1d': '1 day',
  '1w': '1 week',
};

const HOSTNAME_EXPR = "metadata->>'hostname'";

export class TimescaleQueryTranslator extends QueryTranslator {
  private schema: string;
  private tableName: string;

  constructor(schema = 'public', tableName = 'logs') {
    super();
    this.schema = schema;
    this.tableName = tableName;
  }

  private get table(): string {
    return `${this.schema}.${this.tableName}`;
  }

  /**
   * The WHERE conditions every log filter consumer shares (query, count,
   * countEstimate, histogram, facets), in a fixed order: project, service,
   * level, hostname, traceId, sessionId, spanId, time bounds, text,
   * metadata, exclude. Values are bound from `startIdx`.
   */
  buildLogConditions(
    params: LogFilterParams,
    startIdx: number,
  ): { conditions: string[]; values: unknown[]; nextIdx: number } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = startIdx;

    if (params.projectId !== GLOBAL_SCOPE) {
      idx = this.pushFilter(conditions, values, idx, 'project_id', params.projectId);
    }
    if (params.service !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'service', params.service);
    }
    if (params.level !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'level', params.level);
    }
    if (params.hostname !== undefined) {
      // Same expression as the backend expression index idx_logs_project_hostname.
      this.validateArrayFilter('hostname', params.hostname);
      idx = this.pushFilter(conditions, values, idx, HOSTNAME_EXPR, params.hostname);
    }
    if (params.traceId !== undefined) {
      conditions.push(`trace_id = $${idx++}`);
      values.push(params.traceId);
    }
    if (params.sessionId !== undefined) {
      conditions.push(`session_id = $${idx++}`);
      values.push(params.sessionId);
    }
    if (params.spanId !== undefined) {
      conditions.push(`span_id = $${idx++}`);
      values.push(params.spanId);
    }

    conditions.push(`time ${params.fromExclusive ? '>' : '>='} $${idx++}`);
    values.push(params.from);
    conditions.push(`time ${params.toExclusive ? '<' : '<='} $${idx++}`);
    values.push(params.to);

    const text = compileTextQuery(resolveTextQuery(params), idx);
    conditions.push(...text.conditions);
    values.push(...text.values);
    idx = text.nextIdx;

    if (params.metadataFilters && params.metadataFilters.length > 0) {
      const json = compileJsonFilters(params.metadataFilters, 'metadata', idx);
      conditions.push(...json.conditions);
      values.push(...json.values);
      idx = json.nextIdx;
    }

    const exclude = params.exclude;
    if (exclude?.service && exclude.service.length > 0) {
      conditions.push(`service <> ALL($${idx++})`);
      values.push(exclude.service);
    }
    if (exclude?.level && exclude.level.length > 0) {
      conditions.push(`level <> ALL($${idx++})`);
      values.push(exclude.level);
    }
    if (exclude?.hostname && exclude.hostname.length > 0) {
      // Logs without a hostname are kept (spec 5.3).
      conditions.push(`(${HOSTNAME_EXPR} IS NULL OR ${HOSTNAME_EXPR} <> ALL($${idx++}))`);
      values.push(exclude.hostname);
    }

    return { conditions, values, nextIdx: idx };
  }

  translateQuery(params: QueryParams): NativeQuery {
    this.validatePagination(params.limit, params.offset);

    const { conditions, values, nextIdx } = this.buildLogConditions(params, 1);
    let idx = nextIdx;

    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64').toString('utf-8');
        const commaIdx = decoded.indexOf(',');
        if (commaIdx > 0) {
          const cursorTime = decoded.slice(0, commaIdx);
          const cursorId = decoded.slice(commaIdx + 1);
          const parsedTime = new Date(cursorTime);
          if (cursorId && !isNaN(parsedTime.getTime())) {
            conditions.push(`(time, id) < ($${idx}, $${idx + 1})`);
            values.push(parsedTime, cursorId);
            idx += 2;
          }
        }
      } catch {
        // invalid cursor - skip
      }
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const sortOrder = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let query = `SELECT * FROM ${this.table}${where} ORDER BY time ${sortOrder}, id ${sortOrder} LIMIT $${idx}`;
    values.push(limit + 1);
    idx++;

    if (offset > 0) {
      query += ` OFFSET $${idx}`;
      values.push(offset);
      idx++;
    }

    return { query, parameters: values, metadata: { limit } };
  }

  translateAggregate(params: AggregateParams): NativeQuery {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const interval = INTERVAL_MAP[params.interval];
    values.push(interval);
    idx++;

    if (params.projectId !== GLOBAL_SCOPE) {
      idx = this.pushFilter(conditions, values, idx, 'project_id', params.projectId);
    }
    if (params.service !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'service', params.service);
    }

    conditions.push(`time >= $${idx}`);
    values.push(params.from);
    idx++;
    conditions.push(`time <= $${idx}`);
    values.push(params.to);
    idx++;

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const query = `SELECT time_bucket($1, time) AS bucket, level, COUNT(*) AS total FROM ${this.table}${where} GROUP BY bucket, level ORDER BY bucket ASC`;

    return { query, parameters: values };
  }

  translateCount(params: CountParams): NativeQuery {
    const { conditions, values } = this.buildLogConditions(params, 1);
    const query = `SELECT COUNT(*) AS count FROM ${this.table} WHERE ${conditions.join(' AND ')}`;
    return { query, parameters: values };
  }

  translateCountEstimate(params: CountParams): NativeQuery {
    const { conditions, values } = this.buildLogConditions(params, 1);
    const query = `SELECT 1 FROM ${this.table} WHERE ${conditions.join(' AND ')}`;
    return { query, parameters: values };
  }

  /**
   * Log counts per (bucket, level). Buckets start at multiples of
   * `bucketSeconds` since the Unix epoch (time_bucket would align some sizes
   * to its own origin instead). `$1` is the bucket size.
   */
  translateHistogram(params: LogHistogramParams): NativeQuery {
    const { conditions, values } = this.buildLogConditions(params, 2);
    const query =
      `SELECT (floor(extract(epoch FROM time) / $1) * $1)::bigint AS bucket_s, level, COUNT(*)::int AS n ` +
      `FROM ${this.table} WHERE ${conditions.join(' AND ')} GROUP BY 1, 2`;
    return { query, parameters: [params.bucketSeconds, ...values] };
  }

  translateDistinct(params: DistinctParams): NativeQuery {
    this.validateFieldName(params.field);
    this.validatePagination(params.limit);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.projectId !== GLOBAL_SCOPE) {
      idx = this.pushFilter(conditions, values, idx, 'project_id', params.projectId);
    }
    if (params.service !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'service', params.service);
    }
    if (params.level !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'level', params.level);
    }
    if (params.hostname !== undefined) {
      this.validateArrayFilter('hostname', params.hostname);
      if (Array.isArray(params.hostname)) {
        conditions.push(`metadata->>'hostname' = ANY($${idx})`);
        values.push(params.hostname);
        idx++;
      } else {
        conditions.push(`metadata->>'hostname' = $${idx}`);
        values.push(params.hostname);
        idx++;
      }
    }

    conditions.push(`time ${params.fromExclusive ? '>' : '>='} $${idx}`);
    values.push(params.from);
    idx++;
    conditions.push(`time ${params.toExclusive ? '<' : '<='} $${idx}`);
    values.push(params.to);
    idx++;

    const where = ` WHERE ${conditions.join(' AND ')}`;
    let query: string;

    if (params.field.startsWith('metadata.')) {
      // Extract JSONB once in a subquery instead of 3x per row (SELECT + IS NOT NULL + != '').
      const jsonKey = params.field.slice('metadata.'.length);
      const extract = `metadata->>'${jsonKey}'`;
      query = `SELECT DISTINCT value FROM (SELECT ${extract} AS value FROM ${this.table}${where}) sub WHERE value IS NOT NULL AND value != '' ORDER BY value ASC`;
    } else {
      const selectExpr = params.field;
      conditions.push(`${selectExpr} IS NOT NULL`);
      conditions.push(`${selectExpr} != ''`);
      const fullWhere = ` WHERE ${conditions.join(' AND ')}`;
      query = `SELECT DISTINCT ${selectExpr} AS value FROM ${this.table}${fullWhere} ORDER BY value ASC`;
    }

    if (params.limit) {
      query += ` LIMIT $${idx}`;
      values.push(params.limit);
    }

    return { query, parameters: values };
  }

  translateTopValues(params: TopValuesParams): NativeQuery {
    this.validateFieldName(params.field);
    this.validatePagination(params.limit);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.projectId !== GLOBAL_SCOPE) {
      idx = this.pushFilter(conditions, values, idx, 'project_id', params.projectId);
    }
    if (params.service !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'service', params.service);
    }
    if (params.level !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'level', params.level);
    }
    if (params.hostname !== undefined) {
      this.validateArrayFilter('hostname', params.hostname);
      if (Array.isArray(params.hostname)) {
        conditions.push(`metadata->>'hostname' = ANY($${idx})`);
        values.push(params.hostname);
        idx++;
      } else {
        conditions.push(`metadata->>'hostname' = $${idx}`);
        values.push(params.hostname);
        idx++;
      }
    }

    conditions.push(`time ${params.fromExclusive ? '>' : '>='} $${idx}`);
    values.push(params.from);
    idx++;
    conditions.push(`time ${params.toExclusive ? '<' : '<='} $${idx}`);
    values.push(params.to);
    idx++;

    let selectExpr: string;
    if (params.field.startsWith('metadata.')) {
      const jsonKey = params.field.slice('metadata.'.length);
      selectExpr = `metadata->>'${jsonKey}'`;
    } else {
      selectExpr = params.field;
    }

    conditions.push(`${selectExpr} IS NOT NULL`);
    conditions.push(`${selectExpr} != ''`);

    const where = ` WHERE ${conditions.join(' AND ')}`;
    const lastSeenExpr = params.includeLastSeen ? ', MAX(time) AS last_seen' : '';
    let query = `SELECT ${selectExpr} AS value, COUNT(*) AS count${lastSeenExpr} FROM ${this.table}${where} GROUP BY value ORDER BY count DESC`;

    if (params.limit) {
      query += ` LIMIT $${idx}`;
      values.push(params.limit);
    }

    return { query, parameters: values };
  }

  translateDelete(params: DeleteByTimeRangeParams): NativeQuery {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (Array.isArray(params.projectId)) {
      this.validateArrayFilter('project_id', params.projectId);
      conditions.push(`project_id = ANY($${idx})`);
      values.push(params.projectId);
    } else {
      conditions.push(`project_id = $${idx}`);
      values.push(params.projectId);
    }
    idx++;

    conditions.push(`time >= $${idx}`);
    values.push(params.from);
    idx++;
    conditions.push(`time < $${idx}`);
    values.push(params.to);
    idx++;

    if (params.service !== undefined) {
      idx = this.pushFilter(conditions, values, idx, 'service', params.service);
    }
    if (params.level !== undefined) {
      this.pushFilter(conditions, values, idx, 'level', params.level);
    }

    const where = ` WHERE ${conditions.join(' AND ')}`;
    const query = `DELETE FROM ${this.table}${where}`;
    return { query, parameters: values };
  }

  private pushFilter(
    conditions: string[],
    values: unknown[],
    idx: number,
    column: string,
    value: string | string[],
  ): number {
    this.validateArrayFilter(column, value);
    if (Array.isArray(value)) {
      conditions.push(`${column} = ANY($${idx})`);
      values.push(value);
    } else {
      conditions.push(`${column} = $${idx}`);
      values.push(value);
    }
    return idx + 1;
  }
}
