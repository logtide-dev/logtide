import { QueryTranslator, type NativeQuery } from '../../core/query-translator.js';
import { GLOBAL_SCOPE } from '../../core/types.js';
import type {
  AggregateParams,
  AggregationInterval,
  CountParams,
  DeleteByTimeRangeParams,
  DiscoverMetadataKeysParams,
  DistinctParams,
  HasSessionsParams,
  ListSessionsParams,
  LogFacetsParams,
  LogFilterParams,
  LogHistogramParams,
  QueryParams,
  TopValuesParams,
} from '../../core/types.js';
import { compileTextQuery, resolveTextQuery } from './text-query.js';
import { compileJsonFilters, jsonValueExpr, scalarTextExpr } from './json-path.js';
import { DISCOVER_DEFAULT_SAMPLE_SIZE, DISCOVER_MAX_KEYS } from '../../core/constants.js';


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

/** SQL of the built-in facet fields; anything else is rejected, never interpolated. */
const FACET_BUILTIN_EXPR: Record<string, string> = {
  level: 'level',
  service: 'service',
  hostname: HOSTNAME_EXPR,
};

export class TimescaleQueryTranslator extends QueryTranslator {
  private schema: string;
  private tableName: string;
  /** SQL type of `project_id`, for the casts of project lists that no column types. */
  private projectIdType: 'text' | 'uuid';

  constructor(schema = 'public', tableName = 'logs', projectIdType: 'text' | 'uuid' = 'text') {
    super();
    this.schema = schema;
    this.tableName = tableName;
    this.projectIdType = projectIdType === 'uuid' ? 'uuid' : 'text';
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

  /**
   * Top values per facet field in one pass over the filtered logs (S8). Each
   * field is a `(position, text value)` pair of a LATERAL VALUES list, so
   * one scan feeds every field; metadata keys and dotted paths are bound
   * parameters and resolve like metadata filters (literal key first, then
   * the nested path), with the scalar text form of numbers and booleans.
   * Per field: values ranked by count desc, then byte order, cut to the
   * last parameter `limit`, plus the field's present total.
   */
  translateFacets(params: LogFacetsParams, limit: number): NativeQuery {
    const { conditions, values, nextIdx } = this.buildLogConditions(params, 1);
    let idx = nextIdx;
    const pairs = params.fields.map((field, position) => {
      let expr: string;
      if ('builtin' in field) {
        if (!Object.hasOwn(FACET_BUILTIN_EXPR, field.builtin)) {
          throw new Error(`Unknown facet field ${String(field.builtin)}`);
        }
        expr = FACET_BUILTIN_EXPR[field.builtin];
      } else {
        const keyIdx = idx++;
        values.push(field.metadata);
        let pathIdx: number | null = null;
        if (field.metadata.includes('.')) {
          pathIdx = idx++;
          values.push(field.metadata.split('.'));
        }
        expr = scalarTextExpr(jsonValueExpr('metadata', keyIdx, pathIdx));
      }
      return `(${position}, ${expr})`;
    });
    const limitIdx = idx++;
    values.push(limit);

    const query =
      `WITH base AS (SELECT level, service, metadata FROM ${this.table} WHERE ${conditions.join(' AND ')}) ` +
      `SELECT f, v, cnt, total FROM (` +
      `SELECT kv.f, kv.v, COUNT(*)::bigint AS cnt, ` +
      `(SUM(COUNT(*)) OVER (PARTITION BY kv.f))::bigint AS total, ` +
      `ROW_NUMBER() OVER (PARTITION BY kv.f ORDER BY COUNT(*) DESC, kv.v COLLATE "C" ASC) AS rn ` +
      `FROM base CROSS JOIN LATERAL (VALUES ${pairs.join(', ')}) AS kv(f, v) ` +
      `WHERE kv.v IS NOT NULL AND kv.v <> '' ` +
      `GROUP BY kv.f, kv.v) r ` +
      `WHERE rn <= $${limitIdx} ORDER BY f, rn`;
    return { query, parameters: values };
  }

  /**
   * Metadata key occurrences over the newest `sampleSize` logs (S9, F3
   * `countMetadataKeys`). Every sampled log takes a slot, whatever its
   * metadata; a top-level key counts as itself unless its value is an
   * object, whose children count as `parent.child` instead (one level).
   * A log counts once per key, so a literal `a.b` and a nested `a: { b }`
   * in the same log are one occurrence. The CASE guards are required:
   * jsonb_each errors on anything but an object.
   *
   * The sample is the newest `sampleSize` logs of each project (an ordered
   * scan of the composite project/time/id index, stopped at the limit),
   * then the newest of those: the same rows as one global top-N, without
   * the time-index walk over every tenant's logs that `project_id = ANY`
   * plus `ORDER BY time` gets (an array qual gives no index order).
   */
  translateDiscoverKeys(params: DiscoverMetadataKeysParams): NativeQuery {
    const projects = [...new Set(Array.isArray(params.projectId) ? params.projectId : [params.projectId])];
    this.validateArrayFilter('project_id', projects);
    const query =
      `WITH recent AS (SELECT metadata, row_number() OVER () AS rid FROM (` +
      `SELECT x.metadata FROM unnest($1::${this.projectIdType}[]) AS p(pid) CROSS JOIN LATERAL (` +
      `SELECT l.metadata, l.time, l.id FROM ${this.table} l WHERE l.project_id = p.pid AND l.time >= $2 AND l.time <= $3 ` +
      `ORDER BY l.time DESC, l.id DESC LIMIT $4) x ORDER BY x.time DESC, x.id DESC LIMIT $4) sample) ` +
      `SELECT k.key, COUNT(DISTINCT r.rid)::bigint AS occurrences FROM recent r ` +
      `CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(r.metadata) = 'object' THEN r.metadata ELSE '{}'::jsonb END) t ` +
      `CROSS JOIN LATERAL (` +
      `SELECT t.key AS key WHERE jsonb_typeof(t.value) <> 'object' ` +
      `UNION ALL ` +
      `SELECT t.key || '.' || n.key FROM jsonb_each(CASE WHEN jsonb_typeof(t.value) = 'object' THEN t.value ELSE '{}'::jsonb END) n` +
      `) k ` +
      `GROUP BY k.key ORDER BY occurrences DESC, k.key COLLATE "C" ASC LIMIT ${DISCOVER_MAX_KEYS}`;
    return {
      query,
      parameters: [projects, params.from, params.to, params.sampleSize ?? DISCOVER_DEFAULT_SAMPLE_SIZE],
    };
  }

  /**
   * Sessions of one project (S14, F3 contract): rows with a non-empty
   * session id in the window (and service, before grouping), grouped by
   * session id, ordered by last event desc then session id in byte order.
   * The last event is compared and ordered at millisecond precision, the
   * precision of the cursor, so a page never skips a row whose last event
   * differs from the cursor only below the millisecond. Fetches `limit + 1`
   * groups so the caller knows whether another page exists.
   */
  translateListSessions(
    params: Pick<ListSessionsParams, 'projectId' | 'from' | 'to' | 'service'>,
    limit: number,
    cursor: { lastEvent: Date; sessionId: string } | null,
  ): NativeQuery {
    const { conditions, values } = this.sessionConditions(params);
    let idx = values.length + 1;
    if (params.service !== undefined) {
      conditions.push(`service = $${idx++}`);
      values.push(params.service);
    }
    const lastMs = "date_trunc('milliseconds', MAX(time))";
    let having = '';
    if (cursor) {
      having = ` HAVING ${lastMs} < $${idx} OR (${lastMs} = $${idx} AND session_id COLLATE "C" > $${idx + 1})`;
      values.push(cursor.lastEvent, cursor.sessionId);
      idx += 2;
    }
    values.push(limit + 1);
    const query =
      `SELECT session_id, MIN(service COLLATE "C") AS service, ` +
      `date_trunc('milliseconds', MIN(time)) AS first_event, ${lastMs} AS last_event, ` +
      `COUNT(*)::bigint AS event_count, ` +
      `(COUNT(*) FILTER (WHERE level IN ('error', 'critical')))::bigint AS error_count ` +
      `FROM ${this.table} WHERE ${conditions.join(' AND ')} GROUP BY session_id${having} ` +
      `ORDER BY ${lastMs} DESC, session_id COLLATE "C" ASC LIMIT $${idx}`;
    return { query, parameters: values };
  }

  /** Whether the project has one log with a non-empty session id in the window (`LIMIT 1`, no grouping). */
  translateHasSessions(params: HasSessionsParams): NativeQuery {
    const { conditions, values } = this.sessionConditions(params);
    return { query: `SELECT 1 FROM ${this.table} WHERE ${conditions.join(' AND ')} LIMIT 1`, parameters: values };
  }

  private sessionConditions(params: { projectId: string; from: Date; to: Date }): { conditions: string[]; values: unknown[] } {
    return {
      conditions: ['project_id = $1', 'time >= $2', 'time <= $3', 'session_id IS NOT NULL', "session_id <> ''"],
      values: [params.projectId, params.from, params.to],
    };
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
