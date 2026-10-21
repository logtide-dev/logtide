// ============================================================================
// MongoDB conformance: the F3 suite against a real server, plus MongoDB
// specific integration cases
// ============================================================================
// Needs the reservoir test containers (`docker compose -f
// packages/reservoir/docker-compose.test.yml up -d`, MongoDB 7 on 27017).
// The engine runs with default options, so MongoDB 7 creates a time-series
// `logs` collection exactly like production (no text index there).
//
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/mongodb/mongodb-conformance.test.ts
//
// The suite database (default `ux16_rmg`, override with RESERVOIR_MG_DATABASE)
// is dropped before the run and after it. The MongoDB specific cases use a
// second database, `<database>_specifics`, and seed their own rows.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { createConformanceReservoir, describeReservoirConformance, isConformanceRequired, resolveSubject } from '../../conformance/index.js';
import type { Reservoir } from '../../client.js';
import type { LogRecord, MetadataFilter, QueryParams, SpanKind, SpanRecord, StorageConfig, TextQuery } from '../../core/types.js';

const MG_TEST_CONFIG: StorageConfig = {
  host: 'localhost',
  port: 27017,
  database: process.env.RESERVOIR_MG_DATABASE ?? 'ux16_rmg',
  username: '',
  password: '',
};

const SERVER_URL = `mongodb://${MG_TEST_CONFIG.host}:${MG_TEST_CONFIG.port}/`;
const SUITE_DATABASE = MG_TEST_CONFIG.database;
const SPECIFICS_DATABASE = `${MG_TEST_CONFIG.database}_specifics`;

const envFor = (database: string): NodeJS.ProcessEnv => ({ ...process.env, RESERVOIR_MONGODB_URL: `${SERVER_URL}${database}` });

async function dropDatabases(...names: string[]): Promise<void> {
  const client = new MongoClient(SERVER_URL, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    for (const name of names) await client.db(name).dropDatabase();
  } catch {
    // Unreachable server: the suites already reported it (skip or failure).
  } finally {
    await client.close().catch(() => undefined);
  }
}

describeReservoirConformance('mongodb', { create: () => createConformanceReservoir('mongodb', envFor(SUITE_DATABASE)) });

afterAll(async () => {
  await dropDatabases(SUITE_DATABASE, SPECIFICS_DATABASE);
});

// ----------------------------------------------------------------------------
// MongoDB specific integration cases (own database, own rows per describe)
// ----------------------------------------------------------------------------

const SPEC_PROJECT = '00000000-0000-4000-8000-00000000d0a1';
const SPEC_BASE = Date.UTC(2026, 1, 2, 9, 0, 0);
const SPEC_WINDOW = { from: new Date(SPEC_BASE - 60_000), to: new Date(SPEC_BASE + 3_600_000) };

interface SpecLog {
  message: string;
  metadata?: Record<string, unknown>;
}

let specifics: Reservoir | null = null;
let raw: MongoClient | null = null;

function subject(): Reservoir {
  if (!specifics) throw new Error('MongoDB specifics reservoir is not available');
  return specifics;
}

/** Empties the specifics collections, then ingests `rows` one second apart. */
async function seedLogs(rows: SpecLog[]): Promise<void> {
  if (!specifics || !raw) return;
  const db = raw.db(SPECIFICS_DATABASE);
  for (const name of ['logs', 'spans', 'traces']) await db.collection(name).deleteMany({});
  const records: LogRecord[] = rows.map((row, i) => ({
    time: new Date(SPEC_BASE + i * 1000),
    projectId: SPEC_PROJECT,
    service: 'spec',
    level: 'info',
    message: row.message,
    metadata: structuredClone(row.metadata ?? {}),
  }));
  const result = await subject().ingest(records);
  if (result.failed > 0) throw new Error(`Seeding MongoDB specifics failed: ${JSON.stringify(result.errors ?? [])}`);
}

interface SpecSpan {
  id: string;
  durationMs: number;
  operation?: string;
  service?: string;
  kind?: SpanKind;
  parent?: string;
  trace?: string;
  status?: SpanRecord['statusCode'];
  attributes?: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
}

/** Empties the specifics collections, then ingests `rows` as spans one second apart (span id = row id). */
async function seedSpans(rows: SpecSpan[]): Promise<void> {
  if (!specifics || !raw) return;
  const db = raw.db(SPECIFICS_DATABASE);
  for (const name of ['logs', 'spans', 'traces']) await db.collection(name).deleteMany({});
  const spans: SpanRecord[] = rows.map((row, i) => {
    const start = new Date(SPEC_BASE + i * 1000);
    return {
      time: start,
      spanId: row.id,
      traceId: row.trace ?? `trace-${row.id}`,
      ...(row.parent !== undefined ? { parentSpanId: row.parent } : {}),
      projectId: SPEC_PROJECT,
      serviceName: row.service ?? 'spec',
      operationName: row.operation ?? 'op',
      startTime: start,
      endTime: new Date(start.getTime() + row.durationMs),
      durationMs: row.durationMs,
      ...(row.kind !== undefined ? { kind: row.kind } : {}),
      statusCode: row.status ?? 'OK',
      attributes: structuredClone(row.attributes ?? {}),
      ...(row.resourceAttributes !== undefined ? { resourceAttributes: structuredClone(row.resourceAttributes) } : {}),
    };
  });
  await subject().ingestSpans(spans);
}

/** Messages of the matching specifics logs, sorted. */
async function messagesFor(params: Partial<QueryParams>): Promise<string[]> {
  const result = await subject().query({ projectId: SPEC_PROJECT, ...SPEC_WINDOW, limit: 1000, ...params } as QueryParams);
  const { count } = await subject().count({ projectId: SPEC_PROJECT, ...SPEC_WINDOW, ...params });
  expect(count, 'count equals the number of returned logs').toBe(result.logs.length);
  return result.logs.map((l) => l.message).sort();
}

const word = (value: string): TextQuery => ({ all: [{ kind: 'word', value }], anyOf: [], none: [] });
const phrase = (value: string): TextQuery => ({ all: [{ kind: 'phrase', value }], anyOf: [], none: [] });

describe('mongodb specifics', () => {
  beforeAll(async () => {
    specifics = await resolveSubject('mongodb', () => createConformanceReservoir('mongodb', envFor(SPECIFICS_DATABASE)), isConformanceRequired());
    if (specifics) {
      raw = new MongoClient(SERVER_URL, { serverSelectionTimeoutMS: 3000 });
      await raw.connect();
    }
  }, 60_000);

  beforeEach(({ skip }) => {
    if (!specifics) skip();
  });

  afterAll(async () => {
    await specifics?.close();
    await raw?.close();
    specifics = null;
    raw = null;
  });

  describe('mongodb text specifics', () => {
    beforeAll(async () => {
      await seedLogs([
        { message: 'service down' },
        { message: 'GET https://api.timeout.com/v1 failed' },
        { message: 'read /var/log/timeout.log' },
        { message: 'user_id missing' },
        { message: 'user id missing' },
        { message: 'connection refused' },
        { message: 'install c++ (beta) now' },
        { message: 'Überweisung fehlgeschlagen' },
        { message: 'Überweisungen offen' },
        { message: 'sale 50%_off today' },
        { message: 'sale 50 off today' },
        { message: 'copied to C:\\temp\\out' },
      ]);
    });

    it('the logs collection is time-series and has no text index', async () => {
      const db = raw!.db(SPECIFICS_DATABASE);
      const [info] = await db.listCollections({ name: 'logs' }).toArray();
      expect(info.type).toBe('timeseries');
      const indexes = await db.collection('logs').indexes();
      expect(indexes.map((i) => i.name)).not.toContain('idx_message_text');
    });

    it('everyday tokens match like the other engines', async () => {
      expect(await messagesFor({ textQuery: word('down') })).toEqual(['service down']);
      expect(await messagesFor({ textQuery: word('timeout') })).toEqual(['GET https://api.timeout.com/v1 failed', 'read /var/log/timeout.log']);
      expect(await messagesFor({ textQuery: word('user_id') })).toEqual(['user_id missing']);
    });

    it('no stemming: a plural does not match the singular', async () => {
      expect(await messagesFor({ textQuery: word('connections') })).toEqual([]);
    });

    it('non-English words fold case and match whole tokens', async () => {
      expect(await messagesFor({ textQuery: word('überweisung') })).toEqual(['Überweisung fehlgeschlagen']);
    });

    it('phrase metacharacters match literally', async () => {
      expect(await messagesFor({ textQuery: phrase('c++ (beta)') })).toEqual(['install c++ (beta) now']);
      expect(await messagesFor({ textQuery: phrase('50%_off') })).toEqual(['sale 50%_off today']);
      expect(await messagesFor({ textQuery: phrase('C:\\temp') })).toEqual(['copied to C:\\temp\\out']);
      expect(await messagesFor({ textQuery: phrase('.*') })).toEqual([]);
    });

    it('legacy search requires every word (it used to match any)', async () => {
      expect(await messagesFor({ search: 'user missing' })).toEqual(['user id missing']);
      expect(await messagesFor({ search: 'c++ (beta)', searchMode: 'substring' })).toEqual(['install c++ (beta) now']);
    });

    it('an OR group applies on every cursor page', async () => {
      const textQuery: TextQuery = { all: [], anyOf: [[{ kind: 'word', value: 'timeout' }, { kind: 'word', value: 'refused' }]], none: [] };
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let pageNo = 0; pageNo < 10; pageNo++) {
        const page = await subject().query({ projectId: SPEC_PROJECT, ...SPEC_WINDOW, textQuery, limit: 1, cursor });
        seen.push(...page.logs.map((l) => l.message));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen.sort()).toEqual(['GET https://api.timeout.com/v1 failed', 'connection refused', 'read /var/log/timeout.log']);
    });
  });

  describe('mongodb json specifics', () => {
    // A to F as in the plan (TS-4 Step 4), plus G (array, env prod) and H ($-prefixed key).
    const ALL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const except = (...ids: string[]) => ALL.filter((id) => !ids.includes(id));
    const mf = (o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter => o as MetadataFilter;
    const matching = (...filters: MetadataFilter[]) => messagesFor({ metadataFilters: filters });

    beforeAll(async () => {
      await seedLogs([
        { message: 'A', metadata: { 'http.status': 200 } },
        { message: 'B', metadata: { http: { status: 200 } } },
        { message: 'C', metadata: { 'http.status': 404, http: { status: 200 } } },
        { message: 'D', metadata: { status: 500, cached: true, env: 'prod' } },
        { message: 'E', metadata: { user: { id: 42 }, env: 'dev' } },
        { message: 'F', metadata: {} },
        { message: 'G', metadata: { tags: ['a', 'b'], env: 'prod', ratio: 1.5, big: 3_000_000_000 } },
        { message: 'H', metadata: { $kind: 'odd' } },
      ]);
    });

    it('literal dotted keys before nested paths', async () => {
      expect(await matching(mf({ key: 'http.status', op: 'equals', value: '200' }))).toEqual(['A', 'B']);
      expect(await matching(mf({ key: 'http.status', op: 'equals', value: '404' }))).toEqual(['C']);
    });

    it('nested numeric path', async () => {
      expect(await matching(mf({ key: 'user.id', op: 'equals', value: '42' }))).toEqual(['E']);
      expect(await matching(mf({ key: 'user.id', op: 'in', values: ['42', '43'] }))).toEqual(['E']);
      expect(await matching(mf({ key: 'user.id', op: 'exists' }))).toEqual(['E']);
      expect(await matching(mf({ key: 'user.id', op: 'contains', value: '4' }))).toEqual(['E']);
    });

    it('numbers and booleans match by text', async () => {
      expect(await matching(mf({ key: 'status', op: 'equals', value: '500' }))).toEqual(['D']);
      expect(await matching(mf({ key: 'cached', op: 'equals', value: 'true' }))).toEqual(['D']);
      expect(await matching(mf({ key: 'status', op: 'in', values: ['500', '501'] }))).toEqual(['D']);
      expect(await matching(mf({ key: 'status', op: 'contains', value: '50' }))).toEqual(['D']);
      expect(await matching(mf({ key: 'ratio', op: 'equals', value: '1.5' }))).toEqual(['G']);
      expect(await matching(mf({ key: 'big', op: 'equals', value: '3000000000' }))).toEqual(['G']);
      expect(await matching(mf({ key: 'status', op: 'equals', value: '0500' }))).toEqual([]);
    });

    it('negated clauses keep logs without the key', async () => {
      expect(await matching(mf({ key: 'env', op: 'not_equals', value: 'prod', include_missing: true }))).toEqual(['A', 'B', 'C', 'E', 'F', 'H']);
      expect(await matching(mf({ key: 'env', op: 'not_in', values: ['prod', 'dev'], include_missing: true }))).toEqual(['A', 'B', 'C', 'F', 'H']);
      expect(await matching(mf({ key: 'user.id', op: 'not_equals', value: '42', include_missing: true }))).toEqual(except('E'));
      expect(await matching(mf({ key: 'env', op: 'not_exists' }))).toEqual(['A', 'B', 'C', 'F', 'H']);
      expect(await matching(mf({ key: 'http.status', op: 'not_exists' }))).toEqual(except('A', 'B', 'C'));
    });

    it('include_missing false requires the key to resolve', async () => {
      expect(await matching(mf({ key: 'env', op: 'not_equals', value: 'prod', include_missing: false }))).toEqual(['E']);
      expect(await matching(mf({ key: 'user.id', op: 'not_equals', value: '7', include_missing: false }))).toEqual(['E']);
    });

    it('arrays never equal a scalar and have no text', async () => {
      expect(await matching(mf({ key: 'tags', op: 'equals', value: 'a' }))).toEqual([]);
      expect(await matching(mf({ key: 'tags', op: 'in', values: ['a', 'b'] }))).toEqual([]);
      expect(await matching(mf({ key: 'tags', op: 'contains', value: 'a' }))).toEqual([]);
      expect(await matching(mf({ key: 'tags', op: 'exists' }))).toEqual(['G']);
      expect(await matching(mf({ key: 'tags', op: 'not_equals', value: 'a', include_missing: true }))).toEqual(ALL);
    });

    it('a $-prefixed key matches its literal value', async () => {
      expect(await matching(mf({ key: '$kind', op: 'equals', value: 'odd' }))).toEqual(['H']);
      expect(await matching(mf({ key: '$kind', op: 'not_equals', value: 'odd', include_missing: true }))).toEqual(except('H'));
    });

    describe('facets', () => {
      beforeAll(async () => {
        await seedLogs([
          { message: 'n', metadata: { code: 500, hostname: 'h1' } },
          { message: 's', metadata: { code: '500', hostname: 'h1' } },
          { message: 'o', metadata: { code: { a: 1 }, hostname: 42 } },
          { message: 'b', metadata: { ok: true, 'http.method': 'GET', http: { method: 'POST' } } },
          { message: 'e', metadata: { code: '', ok: false, http: { method: 'PUT' } } },
        ]);
      });

      it('numeric and boolean metadata facet as text, objects excluded', async () => {
        const { facets } = await subject().facets({
          projectId: SPEC_PROJECT,
          ...SPEC_WINDOW,
          fields: [{ metadata: 'code' }, { metadata: 'ok' }, { metadata: 'http.method' }, { builtin: 'hostname' }],
        });
        expect(facets).toEqual([
          { field: 'metadata.code', values: [{ value: '500', count: 2 }], otherCount: 0 },
          { field: 'metadata.ok', values: [{ value: 'false', count: 1 }, { value: 'true', count: 1 }], otherCount: 0 },
          { field: 'metadata.http.method', values: [{ value: 'GET', count: 1 }, { value: 'PUT', count: 1 }], otherCount: 0 },
          { field: 'hostname', values: [{ value: 'h1', count: 2 }], otherCount: 0 },
        ]);
      });

      it('a limit keeps the top values and counts the rest', async () => {
        const { facets } = await subject().facets({ projectId: SPEC_PROJECT, ...SPEC_WINDOW, fields: [{ metadata: 'ok' }], limit: 1 });
        expect(facets).toEqual([{ field: 'metadata.ok', values: [{ value: 'false', count: 1 }], otherCount: 1 }]);
      });
    });
  });

  describe('mongodb metadata keys specifics', () => {
    beforeAll(async () => {
      // Oldest first: seedLogs spaces the rows one second apart.
      await seedLogs([
        { message: 't1', metadata: { a: 1, http: { method: 'GET', 'x.y': 1 } } },
        { message: 't2', metadata: { a: 2, old: true } },
        { message: 't3', metadata: { a: 3, b: null } },
      ]);
    });

    const keys = async (sampleSize: number) =>
      (await subject().discoverMetadataKeys({ projectId: SPEC_PROJECT, ...SPEC_WINDOW, sampleSize })).map((k) => `${k.key} ${k.occurrences}`);

    it('the sample is the newest logs', async () => {
      expect(await keys(2)).toEqual(['a 2', 'b 1', 'old 1']);
    });

    it('object values expand one level, other values count as themselves', async () => {
      expect(await keys(3)).toEqual(['a 3', 'b 1', 'http.method 1', 'http.x.y 1', 'old 1']);
    });
  });

  describe('mongodb span specifics', () => {
    beforeAll(async () => {
      await seedSpans([
        { id: 's1', durationMs: 10, operation: 'GET /a', attributes: { 'http.route': '/a' }, resourceAttributes: { service: { version: '1.2' } } },
        { id: 's2', durationMs: 30, operation: 'GET /a', attributes: { 'http.route': '/a' }, resourceAttributes: { 'service.version': '2.0' } },
        { id: 's3', durationMs: 30, operation: 'GET /b', attributes: { resource: { service: { version: '1.2' } } } },
      ]);
    });

    const spanIds = async (params: Partial<Parameters<Reservoir['querySpans']>[0]>) =>
      (await subject().querySpans({ projectId: SPEC_PROJECT, ...SPEC_WINDOW, limit: 100, ...params })).spans.map((s) => s.spanId);

    it('resource-prefixed keys filter resource attributes, literal keys first', async () => {
      const version = (value: string): MetadataFilter => ({ key: 'resource.service.version', op: 'equals', value, include_missing: false });
      expect(await spanIds({ attributeFilters: [version('1.2')] })).toEqual(['s1']);
      expect(await spanIds({ attributeFilters: [version('2.0')] })).toEqual(['s2']);
    });

    it('operationName filters a list and duration ties break by span id', async () => {
      expect(await spanIds({ operationName: ['GET /a', 'GET /b'], sortBy: 'duration', sortOrder: 'desc' })).toEqual(['s2', 's3', 's1']);
      expect(await spanIds({ operationName: 'GET /b' })).toEqual(['s3']);
    });
  });
});
