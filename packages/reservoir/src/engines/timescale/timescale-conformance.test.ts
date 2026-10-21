// ============================================================================
// TimescaleDB conformance harness (R-TS)
// ============================================================================
// Runs the F3 conformance suite against a real TimescaleDB, then the
// Timescale-specific integration cases. No pg mocks here.
//
// Database: ux16_rts on localhost:5433 by default; RESERVOIR_TIMESCALE_URL
// overrides it. The suite owns the schema `reservoir_conformance` (dropped
// and recreated per run by the F3 targets); each Timescale-specific describe
// owns one `reservoir_ts_*` schema, so its rows never touch the corpus.
//
//   cd packages/reservoir
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/timescale/timescale-conformance.test.ts
//
// Without RESERVOIR_CONFORMANCE_REQUIRED=1 an unreachable server skips.

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Reservoir } from '../../client.js';
import {
  createConformanceReservoir,
  describeReservoirConformance,
  isConformanceRequired,
  probeConformanceTarget,
  resolveConformanceTarget,
  resolveSubject,
  type ConformanceTarget,
} from '../../conformance/index.js';
import type {
  LogRecord,
  MetadataFilter,
  QueryParams,
  SpanQueryParams,
  SpanRecord,
  TextQuery,
  TraceQueryParams,
  TraceRecord,
} from '../../core/types.js';
import { TimescaleEngine } from './timescale-engine.js';

export const TS_TEST_URL = 'postgresql://logtide_test:test_password@localhost:5433/ux16_rts';

const SPECIFICS_PROJECT = 'ts-specifics';
const SPECIFICS_BASE = Date.UTC(2026, 0, 5, 10, 0, 0);
const SPECIFICS_WINDOW = { from: new Date(SPECIFICS_BASE - 60_000), to: new Date(SPECIFICS_BASE + 3_600_000) };

/** The process env with RESERVOIR_TIMESCALE_URL defaulted to the R-TS database. */
export function timescaleTestEnv(): NodeJS.ProcessEnv {
  return { ...process.env, RESERVOIR_TIMESCALE_URL: process.env.RESERVOIR_TIMESCALE_URL || TS_TEST_URL };
}

async function withClient<T>(target: ConformanceTarget, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const { config } = target;
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
  });
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

let ctypeLogged = false;

/**
 * Probes the server, makes sure the extensions the engine relies on exist
 * and logs the database ctype once (word boundaries of non-ASCII letters
 * follow it, plan S2).
 */
async function prepareDatabase(target: ConformanceTarget): Promise<void> {
  await probeConformanceTarget(target);
  await withClient(target, async (client) => {
    await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    if (!ctypeLogged) {
      ctypeLogged = true;
      const { rows } = await client.query('SELECT datctype FROM pg_database WHERE datname = current_database()');
      console.info(`[timescale conformance] ${target.redactedUrl} datctype=${String(rows[0]?.datctype)}`);
    }
  });
}

/** The F3 bootstrap (probe, schema reset, initialize) after the extension check. */
export async function createTimescaleConformanceReservoir(): Promise<Reservoir> {
  const env = timescaleTestEnv();
  await prepareDatabase(resolveConformanceTarget('timescale', env));
  return createConformanceReservoir('timescale', env);
}

/**
 * A fresh Reservoir over its own schema for engine-specific cases: the
 * schema is dropped, then created by `initialize()`.
 */
export async function createTimescaleSpecificsReservoir(schema: string): Promise<Reservoir> {
  const target = resolveConformanceTarget('timescale', timescaleTestEnv());
  await prepareDatabase(target);
  await withClient(target, (client) => client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
  const reservoir = Reservoir.fromEngine(new TimescaleEngine({ ...target.config, schema }));
  await reservoir.initialize();
  return reservoir;
}

describeReservoirConformance('timescale', { create: createTimescaleConformanceReservoir });

/** Logs for the engine-specific cases: one per message, a second apart, in SPECIFICS_WINDOW. */
function specificsLogs(rows: { message: string; metadata?: Record<string, unknown> }[]): LogRecord[] {
  return rows.map((row, i) => ({
    time: new Date(SPECIFICS_BASE + i * 1000),
    projectId: SPECIFICS_PROJECT,
    service: 'api',
    level: 'info',
    message: row.message,
    metadata: row.metadata ?? {},
  }));
}

/** Records of an engine-specific describe; a bare array is logs only. */
interface SpecificsSeed {
  logs?: LogRecord[];
  spans?: SpanRecord[];
  traces?: TraceRecord[];
}

/**
 * A describe over its own schema and records. An unreachable server skips
 * the block, or fails it with RESERVOIR_CONFORMANCE_REQUIRED=1.
 */
function describeTimescaleSpecifics(
  name: string,
  schema: string,
  records: LogRecord[] | SpecificsSeed,
  body: (subject: () => Reservoir) => void,
): void {
  const seed: SpecificsSeed = Array.isArray(records) ? { logs: records } : records;
  describe(name, () => {
    let reservoir: Reservoir | null = null;

    beforeAll(async () => {
      reservoir = await resolveSubject('timescale', () => createTimescaleSpecificsReservoir(schema), isConformanceRequired());
      if (!reservoir) return;
      if (seed.logs?.length) {
        const result = await reservoir.ingest(seed.logs);
        if (result.failed > 0) throw new Error(`Seeding ${name} failed: ${JSON.stringify(result.errors ?? [])}`);
      }
      if (seed.spans?.length) {
        const result = await reservoir.ingestSpans(seed.spans);
        if (result.failed > 0) throw new Error(`Seeding ${name} spans failed: ${JSON.stringify(result.errors ?? [])}`);
      }
      for (const trace of seed.traces ?? []) await reservoir.upsertTrace(trace);
    }, 60_000);

    beforeEach(({ skip }) => {
      if (!reservoir) skip();
    });

    afterAll(async () => {
      if (reservoir) await reservoir.close();
    });

    body(() => {
      if (!reservoir) throw new Error(`${name}: no Timescale subject`);
      return reservoir;
    });
  });
}

/** Sorted messages of the specifics project matching `params` (count must agree). */
async function messagesOf(subject: Reservoir, params: Partial<QueryParams>): Promise<string[]> {
  const base = { projectId: SPECIFICS_PROJECT, ...SPECIFICS_WINDOW, ...params };
  const result = await subject.query({ ...base, limit: 1000 } as QueryParams);
  const { count } = await subject.count(base as QueryParams);
  expect(count, 'count equals the number of returned logs').toBe(result.logs.length);
  return result.logs.map((l) => l.message).sort();
}

const words = (...values: string[]): TextQuery => ({ all: values.map((value) => ({ kind: 'word' as const, value })), anyOf: [], none: [] });
const phrases = (...values: string[]): TextQuery => ({ all: values.map((value) => ({ kind: 'phrase' as const, value })), anyOf: [], none: [] });

describeTimescaleSpecifics(
  'timescale text specifics',
  'reservoir_ts_text',
  specificsLogs([
    { message: 'service down' },
    { message: 'GET https://api.timeout.com/v1 failed' },
    { message: 'read /var/log/timeout.log' },
    { message: 'user_id missing' },
    { message: 'user id missing' },
    { message: 'connection refused' },
    { message: 'install c++ (beta) now' },
    { message: 'discount 50%_off today' },
  ]),
  (subject) => {
    it('everyday tokens match like the other engines', async () => {
      expect(await messagesOf(subject(), { textQuery: words('down') })).toEqual(['service down']);
      expect(await messagesOf(subject(), { textQuery: words('timeout') })).toEqual([
        'GET https://api.timeout.com/v1 failed',
        'read /var/log/timeout.log',
      ]);
      expect(await messagesOf(subject(), { textQuery: words('user_id') })).toEqual(['user_id missing']);
    });

    it('a word is not split out of an underscore token', async () => {
      // The full-text parser splits user_id into user and id; the word must not match it.
      expect(await messagesOf(subject(), { textQuery: words('user') })).toEqual(['user id missing']);
      expect(await messagesOf(subject(), { textQuery: words('id') })).toEqual(['user id missing']);
    });

    it('stemming is the documented difference', async () => {
      expect(await messagesOf(subject(), { textQuery: words('connections') })).toEqual(['connection refused']);
    });

    it('phrase metacharacters match literally', async () => {
      expect(await messagesOf(subject(), { textQuery: phrases('c++ (beta)') })).toEqual(['install c++ (beta) now']);
      expect(await messagesOf(subject(), { textQuery: phrases('50%_off') })).toEqual(['discount 50%_off today']);
      expect(await messagesOf(subject(), { textQuery: phrases('50%off') })).toEqual([]);
      expect(await messagesOf(subject(), { textQuery: phrases('c+') })).toEqual(['install c++ (beta) now']);
    });

    it('legacy fulltext search goes through the same token rules', async () => {
      expect(await messagesOf(subject(), { search: 'service down' })).toEqual(['service down']);
      expect(await messagesOf(subject(), { search: 'user', searchMode: 'fulltext' })).toEqual(['user id missing']);
    });
  },
);

type FilterInput = Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean };
/** Filters as the shared schema emits them: include_missing defaults to true for negative operators. */
const filters = (...list: FilterInput[]): MetadataFilter[] =>
  list.map((f) => ({ include_missing: f.op === 'not_equals' || f.op === 'not_in' || f.op === 'not_exists', ...f }) as MetadataFilter);

describeTimescaleSpecifics(
  'timescale json specifics',
  'reservoir_ts_json',
  specificsLogs([
    { message: 'A', metadata: { 'http.status': 200 } },
    { message: 'B', metadata: { http: { status: 200 } } },
    { message: 'C', metadata: { 'http.status': 404, http: { status: 200 } } },
    { message: 'D', metadata: { status: 500, cached: true, env: 'prod' } },
    { message: 'E', metadata: { user: { id: 42 }, env: 'dev' } },
    { message: 'F', metadata: {} },
  ]),
  (subject) => {
    const match = (...list: FilterInput[]) => messagesOf(subject(), { metadataFilters: filters(...list) });

    it('literal dotted keys before nested paths', async () => {
      expect(await match({ key: 'http.status', op: 'equals', value: '200' })).toEqual(['A', 'B']);
      expect(await match({ key: 'http.status', op: 'equals', value: '404' })).toEqual(['C']);
      expect(await match({ key: 'http.status', op: 'exists' })).toEqual(['A', 'B', 'C']);
    });

    it('nested numeric path', async () => {
      expect(await match({ key: 'user.id', op: 'equals', value: '42' })).toEqual(['E']);
      expect(await match({ key: 'user.id', op: 'in', values: ['42', '43'] })).toEqual(['E']);
      expect(await match({ key: 'user.id', op: 'exists' })).toEqual(['E']);
      expect(await match({ key: 'user.id', op: 'contains', value: '4' })).toEqual(['E']);
    });

    it('numbers and booleans match by text', async () => {
      expect(await match({ key: 'status', op: 'equals', value: '500' })).toEqual(['D']);
      expect(await match({ key: 'cached', op: 'equals', value: 'true' })).toEqual(['D']);
      expect(await match({ key: 'status', op: 'in', values: ['500', '501'] })).toEqual(['D']);
    });

    it('negated clauses keep logs without the key', async () => {
      expect(await match({ key: 'env', op: 'not_equals', value: 'prod' })).toEqual(['A', 'B', 'C', 'E', 'F']);
      expect(await match({ key: 'env', op: 'not_in', values: ['prod', 'dev'] })).toEqual(['A', 'B', 'C', 'F']);
      expect(await match({ key: 'user.id', op: 'not_equals', value: '42' })).toEqual(['A', 'B', 'C', 'D', 'F']);
      expect(await match({ key: 'user.id', op: 'not_in', values: ['42'] })).toEqual(['A', 'B', 'C', 'D', 'F']);
      expect(await match({ key: 'env', op: 'not_exists' })).toEqual(['A', 'B', 'C', 'F']);
      expect(await match({ key: 'http.status', op: 'not_exists' })).toEqual(['D', 'E', 'F']);
    });

    it('include_missing false requires the key to resolve', async () => {
      expect(await match({ key: 'env', op: 'not_equals', value: 'prod', include_missing: false })).toEqual(['E']);
      expect(await match({ key: 'http.status', op: 'not_in', values: ['404'], include_missing: false })).toEqual(['A', 'B']);
    });
  },
);

describeTimescaleSpecifics(
  'timescale facets specifics',
  'reservoir_ts_facets',
  specificsLogs([
    { message: 'A', metadata: { code: 500 } },
    { message: 'B', metadata: { code: '500' } },
    { message: 'C', metadata: { code: { a: 1 } } },
    { message: 'D', metadata: { ok: true } },
    { message: 'E', metadata: { code: '', http: { method: 'GET' } } },
    { message: 'F', metadata: { 'http.method': 'POST', http: { method: 'GET' } } },
  ]),
  (subject) => {
    it('numeric and boolean metadata facet as text, objects excluded', async () => {
      const { facets } = await subject().facets({
        projectId: SPECIFICS_PROJECT,
        ...SPECIFICS_WINDOW,
        fields: [{ metadata: 'code' }, { metadata: 'ok' }],
      });
      expect(facets).toEqual([
        { field: 'metadata.code', values: [{ value: '500', count: 2 }], otherCount: 0 },
        { field: 'metadata.ok', values: [{ value: 'true', count: 1 }], otherCount: 0 },
      ]);
    });

    it('a dotted key prefers the literal key, then the nested path', async () => {
      const { facets } = await subject().facets({
        projectId: SPECIFICS_PROJECT,
        ...SPECIFICS_WINDOW,
        fields: [{ metadata: 'http.method' }],
        limit: 1,
      });
      expect(facets).toEqual([{ field: 'metadata.http.method', values: [{ value: 'GET', count: 1 }], otherCount: 1 }]);
    });

    it('the log filter applies to facets', async () => {
      const { facets } = await subject().facets({
        projectId: SPECIFICS_PROJECT,
        ...SPECIFICS_WINDOW,
        fields: [{ builtin: 'service' }, { metadata: 'code' }],
        metadataFilters: [{ key: 'code', op: 'equals', value: '500', include_missing: false }],
        textQuery: { all: [], anyOf: [], none: [{ kind: 'phrase', value: 'B' }] },
      });
      expect(facets).toEqual([
        { field: 'service', values: [{ value: 'api', count: 1 }], otherCount: 0 },
        { field: 'metadata.code', values: [{ value: '500', count: 1 }], otherCount: 0 },
      ]);
    });
  },
);

const KEYS_OTHER_PROJECT = 'ts-specifics-other';
const KEYS_BARE_PROJECT = 'ts-specifics-bare';
const keyLog = (projectId: string, second: number, metadata?: Record<string, unknown>): LogRecord => ({
  time: new Date(SPECIFICS_BASE + second * 1000),
  projectId,
  service: 'api',
  level: 'info',
  message: `keys ${second}`,
  ...(metadata ? { metadata } : {}),
});

describeTimescaleSpecifics(
  'timescale metadata keys specifics',
  'reservoir_ts_keys',
  [
    keyLog(SPECIFICS_PROJECT, 1, { a: 1, http: { method: 'GET', 'x.y': 1 } }),
    keyLog(SPECIFICS_PROJECT, 2, { a: 2, old: true }),
    keyLog(SPECIFICS_PROJECT, 3, { a: 3, b: null }),
    keyLog(KEYS_OTHER_PROJECT, 4, { z: 'x', geo: {} }),
    keyLog(KEYS_BARE_PROJECT, 5),
  ],
  (subject) => {
    const discover = (projectId: string | string[], sampleSize?: number) =>
      subject().discoverMetadataKeys({ projectId, ...SPECIFICS_WINDOW, ...(sampleSize !== undefined ? { sampleSize } : {}) });

    it('the sample is the newest logs of the project', async () => {
      expect(await discover(SPECIFICS_PROJECT, 2)).toEqual([
        { key: 'a', occurrences: 2 },
        { key: 'b', occurrences: 1 },
        { key: 'old', occurrences: 1 },
      ]);
    });

    it('object values count their children, not themselves', async () => {
      expect(await discover(SPECIFICS_PROJECT, 3)).toEqual([
        { key: 'a', occurrences: 3 },
        { key: 'b', occurrences: 1 },
        { key: 'http.method', occurrences: 1 },
        { key: 'http.x.y', occurrences: 1 },
        { key: 'old', occurrences: 1 },
      ]);
    });

    it('a log without metadata still takes a sample slot', async () => {
      expect(await discover([SPECIFICS_PROJECT, KEYS_BARE_PROJECT], 1)).toEqual([]);
      expect(await discover([SPECIFICS_PROJECT, KEYS_OTHER_PROJECT, KEYS_BARE_PROJECT], 2)).toEqual([{ key: 'z', occurrences: 1 }]);
    });

    it('a log stored without metadata matches not_exists', async () => {
      const params = {
        projectId: KEYS_BARE_PROJECT,
        ...SPECIFICS_WINDOW,
        metadataFilters: [
          { key: 'env', op: 'not_exists', include_missing: true },
          { key: 'http.method', op: 'not_exists', include_missing: true },
        ] as MetadataFilter[],
      };
      expect((await subject().query(params)).logs.map((l) => l.message)).toEqual(['keys 5']);
      expect((await subject().count(params)).count).toBe(1);
    });
  },
);

/** A span of the specifics project starting `second` seconds after SPECIFICS_BASE. */
function specificsSpan(
  spanId: string,
  traceId: string,
  second: number,
  extra: Partial<SpanRecord> & Pick<SpanRecord, 'serviceName' | 'operationName' | 'durationMs'>,
): SpanRecord {
  const start = new Date(SPECIFICS_BASE + second * 1000);
  return {
    time: start,
    spanId,
    traceId,
    projectId: SPECIFICS_PROJECT,
    startTime: start,
    endTime: new Date(start.getTime() + extra.durationMs),
    statusCode: 'OK',
    ...extra,
  };
}

function specificsTrace(traceId: string, second: number, serviceName: string, durationMs: number, spanCount: number): TraceRecord {
  const start = new Date(SPECIFICS_BASE + second * 1000);
  return {
    traceId,
    projectId: SPECIFICS_PROJECT,
    serviceName,
    rootServiceName: serviceName,
    startTime: start,
    endTime: new Date(start.getTime() + durationMs),
    durationMs,
    spanCount,
    error: false,
  };
}

describeTimescaleSpecifics(
  'timescale span specifics',
  'reservoir_ts_spans',
  {
    spans: [
      specificsSpan('a1', 'ta', 1, {
        serviceName: 'gateway', operationName: 'route', durationMs: 80, kind: 'SERVER',
        resourceAttributes: { 'service.version': '1.2' },
      }),
      specificsSpan('a2', 'ta', 2, {
        serviceName: 'api', operationName: 'GET /x', durationMs: 50, kind: 'SERVER', parentSpanId: 'a1',
        attributes: { 'http.method': 'GET', 'http.status_code': 500 }, resourceAttributes: { service: { version: '2.0' } },
      }),
      specificsSpan('b1', 'tb', 3, {
        serviceName: 'api', operationName: 'GET /x', durationMs: 50, kind: 'SERVER',
        attributes: { 'http.method': 'POST', 'http.status_code': 200 }, resourceAttributes: { 'service.version': '1.2' },
      }),
      specificsSpan('c0', 'tc', 10, { serviceName: 'api', operationName: 'job', durationMs: 20, attributes: {} }),
      specificsSpan('c2', 'tc', 7200, { serviceName: 'api', operationName: 'late op', durationMs: 5 }),
    ],
    traces: [
      specificsTrace('ta', 1, 'gateway', 80, 2),
      specificsTrace('tb', 3, 'api', 50, 1),
      specificsTrace('tc', 10, 'api', 7200 * 1000, 2),
    ],
  },
  (subject) => {
    const spanIds = async (params: Partial<SpanQueryParams>) =>
      (await subject().querySpans({ projectId: SPECIFICS_PROJECT, ...SPECIFICS_WINDOW, limit: 100, ...params })).spans.map((s) => s.spanId);
    const traceIds = async (params: Partial<TraceQueryParams>) =>
      (await subject().queryTraces({ projectId: SPECIFICS_PROJECT, ...SPECIFICS_WINDOW, limit: 100, ...params })).traces.map((t) => t.traceId);
    const eq = (key: string, value: string): MetadataFilter => ({ key, op: 'equals', value, include_missing: false });

    it('resource-prefixed keys filter resource attributes, literal key before nested path', async () => {
      expect(await spanIds({ attributeFilters: [eq('resource.service.version', '1.2')] })).toEqual(['a1', 'b1']);
      expect(await spanIds({ attributeFilters: [eq('resource.service.version', '2.0')] })).toEqual(['a2']);
      expect(await spanIds({ attributeFilters: [eq('service.version', '1.2')] })).toEqual([]);
    });

    it('not_exists matches spans stored without attributes', async () => {
      expect(await spanIds({ attributeFilters: [{ key: 'http.method', op: 'not_exists', include_missing: true }] })).toEqual(['a1', 'c0']);
      expect(await spanIds({ attributeFilters: [{ key: 'http.method', op: 'not_equals', value: 'GET', include_missing: true }] })).toEqual([
        'a1', 'b1', 'c0',
      ]);
    });

    it('numeric attributes match by text and the operation alias applies', async () => {
      expect(await spanIds({ operation: 'GET /x', attributeFilters: [eq('http.status_code', '500')] })).toEqual(['a2']);
    });

    it('duration sort breaks ties by span id', async () => {
      expect(await spanIds({ sortBy: 'duration', sortOrder: 'desc' })).toEqual(['a1', 'a2', 'b1', 'c0']);
      expect(await spanIds({ sortBy: 'duration', sortOrder: 'asc' })).toEqual(['c0', 'a2', 'b1', 'a1']);
    });

    it('trace serviceName stays trace level when an operation is given', async () => {
      expect(await traceIds({ serviceName: 'gateway', operation: 'GET /x' })).toEqual(['ta']);
      expect(await traceIds({ serviceName: 'api', operation: 'route' })).toEqual([]);
    });

    it('a trace matches a span that starts after the window', async () => {
      expect(await traceIds({ operation: 'late op' })).toEqual(['tc']);
      const { total } = await subject().queryTraces({ projectId: SPECIFICS_PROJECT, ...SPECIFICS_WINDOW, operation: 'late op' });
      expect(total).toBe(1);
    });

    it('trace attribute filters on resource attributes', async () => {
      expect(await traceIds({ attributeFilters: [eq('resource.service.version', '1.2')], sortBy: 'start_time', sortOrder: 'asc' })).toEqual([
        'ta', 'tb',
      ]);
    });
  },
);
