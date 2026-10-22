// EXPLAIN-based checks for ClickHouse (plan CH-11): the queries behind log
// search and the new log and span capabilities read granules through the
// primary key, and text and span id filters reach the skip indexes meant for
// them. The engine runs every capability against a recording client; each
// query it sent is then explained with the same parameters, so the checks
// cover the SQL the engine really issues. Real server, no mocks.
//
// Run from packages/reservoir:
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/clickhouse/clickhouse-plans.test.ts
// The database (default ux16_rch_plans) is dropped and recreated per run, so
// it must match CONFORMANCE_NAMESPACE_PATTERN; shared test databases are refused.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { ClickHouseEngine } from './clickhouse-engine.js';
import { traceSpanMatchSql } from './apm-queries.js';
import { CONFORMANCE_NAMESPACE_PATTERN, isConformanceRequired } from '../../conformance/targets.js';
import type { LogRecord, SpanRecord, TextQuery, TraceRecord } from '../../core/types.js';

const PLANS_CONFIG = {
  host: 'localhost',
  port: 18123,
  database: `${process.env.RESERVOIR_CH_DATABASE ?? 'ux16_rch'}_plans`,
  username: 'default',
  password: '',
};

const LOWER_INDEX = 'idx_message_lower_ngram';

const P1 = '00000000-0000-4000-8000-00000000c1a1';
const P2 = '00000000-0000-4000-8000-00000000c1a2';
const FROM = new Date('2026-03-01T00:00:00.000Z');
const TO = new Date('2026-03-01T02:00:00.000Z');

interface RecordedQuery {
  query: string;
  query_params?: Record<string, unknown>;
}

/** One `ReadFromMergeTree` step of an `EXPLAIN indexes = 1` plan. */
interface ReadStep {
  table: string;
  /** Key columns the primary key condition uses (empty: whole-table scan). */
  primaryKey: string[];
  /** Skip indexes the read consults. */
  skipIndexes: string[];
}

/** Parses the read steps out of `EXPLAIN indexes = 1` text output. */
function readSteps(explain: string): ReadStep[] {
  const lines = explain.split('\n');
  const steps: ReadStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)ReadFromMergeTree \(([^)]+)\)/.exec(lines[i]);
    if (!head) continue;
    const base = head[1].length;
    const step: ReadStep = { table: head[2], primaryKey: [], skipIndexes: [] };
    let section = '';
    let inKeys = false;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const text = line.trim();
      if (text === '') break;
      const indent = line.length - line.trimStart().length;
      if (indent < base || (indent === base && text !== 'Indexes:')) break;
      if (indent === base) continue;
      if (indent === base + 2) {
        section = text;
        inKeys = false;
        continue;
      }
      if (text === 'Keys:') {
        inKeys = true;
        continue;
      }
      if (/^[A-Z][A-Za-z ]*:/.test(text)) inKeys = false;
      if (section === 'Skip' && text.startsWith('Name: ')) step.skipIndexes.push(text.slice('Name: '.length));
      else if (section === 'PrimaryKey' && inKeys) step.primaryKey.push(text);
    }
    steps.push(step);
  }
  return steps;
}

const phrase = (value: string): TextQuery => ({ all: [{ kind: 'phrase', value }], anyOf: [], none: [] });
const word = (value: string): TextQuery => ({ all: [{ kind: 'word', value }], anyOf: [], none: [] });

function seedLogs(): LogRecord[] {
  const logs: LogRecord[] = [];
  for (let i = 0; i < 2000; i++) {
    logs.push({
      time: new Date(FROM.getTime() + i * 3000),
      projectId: i % 2 === 0 ? P1 : P2,
      service: i % 3 === 0 ? 'worker' : 'api',
      level: i % 7 === 0 ? 'error' : 'info',
      message: `request ${i} Timeout talking to host-${i % 10}`,
      metadata: { hostname: `h${i % 4}`, status: 200 + (i % 3), http: { method: i % 2 === 0 ? 'GET' : 'POST' } },
      traceId: `trace-${i % 50}`,
      spanId: `span-${i}`,
      ...(i % 5 === 0 ? {} : { sessionId: `session-${i % 20}` }),
    });
  }
  return logs;
}

function seedSpans(): SpanRecord[] {
  const spans: SpanRecord[] = [];
  for (let i = 0; i < 500; i++) {
    const start = new Date(FROM.getTime() + i * 10_000);
    const legacy = i % 4 === 3;
    spans.push({
      time: start,
      spanId: `sp-${i}`,
      traceId: `tr-${i % 50}`,
      // Roots: every tenth span, plus some legacy spans.
      ...(i % 10 === 0 || i % 20 === 3 ? {} : { parentSpanId: `sp-${i - 1}` }),
      projectId: i % 2 === 0 ? P1 : P2,
      // P2 also carries a service whose spans have no kind (root fallback).
      serviceName: legacy && i % 2 === 1 ? 'legacy' : 'api',
      operationName: `op-${i % 5}`,
      startTime: start,
      endTime: new Date(start.getTime() + 20 + i),
      durationMs: 20 + i,
      ...(legacy && i % 2 === 1 ? {} : { kind: i % 10 === 0 ? ('SERVER' as const) : ('INTERNAL' as const) }),
      statusCode: i % 9 === 0 ? ('ERROR' as const) : ('OK' as const),
      attributes: { 'http.route': `/r/${i % 3}`, http: { status: 200 } },
      resourceAttributes: { 'service.version': '1.0.0' },
    });
  }
  return spans;
}

function seedTraces(spans: SpanRecord[]): TraceRecord[] {
  const byTrace = new Map<string, SpanRecord[]>();
  for (const span of spans) byTrace.set(span.traceId, [...(byTrace.get(span.traceId) ?? []), span]);
  return [...byTrace.entries()].map(([traceId, members]) => {
    const start = Math.min(...members.map((s) => s.startTime.getTime()));
    const end = Math.max(...members.map((s) => s.endTime.getTime()));
    return {
      traceId,
      projectId: members[0].projectId,
      serviceName: members[0].serviceName,
      startTime: new Date(start),
      endTime: new Date(end),
      durationMs: end - start,
      spanCount: members.length,
      error: members.some((s) => s.statusCode === 'ERROR'),
    };
  });
}

describe('clickhouse query plans', () => {
  let engine: ClickHouseEngine;
  let client: ClickHouseClient;
  let explainClient: ClickHouseClient;
  let querySpy: MockInstance<ClickHouseClient['query']>;
  let available = false;

  beforeAll(async () => {
    if (!CONFORMANCE_NAMESPACE_PATTERN.test(PLANS_CONFIG.database)) {
      throw new Error(`Refusing to reset ${PLANS_CONFIG.database}: not a conformance namespace`);
    }
    const admin = createClient({
      url: `http://${PLANS_CONFIG.host}:${PLANS_CONFIG.port}`,
      username: PLANS_CONFIG.username,
      password: PLANS_CONFIG.password,
    });
    try {
      await admin.query({ query: 'SELECT 1', format: 'JSONEachRow' });
    } catch (err) {
      await admin.close();
      if (isConformanceRequired()) throw new Error(`ClickHouse is not reachable at localhost:18123: ${String(err)}`);
      console.warn('ClickHouse not available at localhost:18123 - skipping plan checks');
      return;
    }
    await admin.command({ query: `DROP DATABASE IF EXISTS ${PLANS_CONFIG.database}` });
    await admin.close();

    const connection = {
      url: `http://${PLANS_CONFIG.host}:${PLANS_CONFIG.port}`,
      username: PLANS_CONFIG.username,
      password: PLANS_CONFIG.password,
      database: PLANS_CONFIG.database,
    };
    client = createClient(connection);
    explainClient = createClient(connection);
    querySpy = vi.spyOn(client, 'query');
    engine = new ClickHouseEngine(PLANS_CONFIG, { client });
    await engine.connect();
    await engine.initialize();

    const ingest = await engine.ingest(seedLogs());
    if (ingest.failed > 0) throw new Error(`Seeding logs failed: ${JSON.stringify(ingest.errors ?? [])}`);
    const spans = seedSpans();
    await engine.ingestSpans(spans);
    for (const trace of seedTraces(spans)) await engine.upsertTrace(trace);
    available = true;
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await engine.disconnect();
    await client.close();
    await explainClient.close();
  });

  beforeEach(({ skip }) => {
    if (!available) skip();
  });

  /** Every query the engine sent while `run` executed. */
  async function recorded(run: () => Promise<unknown>): Promise<RecordedQuery[]> {
    querySpy.mockClear();
    await run();
    return querySpy.mock.calls.map(([args]) => args as RecordedQuery);
  }

  async function explain(call: RecordedQuery): Promise<{ text: string; steps: ReadStep[] }> {
    const resultSet = await explainClient.query({
      query: `EXPLAIN indexes = 1 ${call.query}`,
      query_params: call.query_params,
      format: 'TabSeparatedRaw',
    });
    const text = await resultSet.text();
    return { text, steps: readSteps(text) };
  }

  /** The single logs read of the one query `run` sends. */
  async function logsReadOf(run: () => Promise<unknown>): Promise<ReadStep> {
    const calls = (await recorded(run)).filter((c) => !c.query.includes('count()'));
    expect(calls.length, 'one page query').toBe(1);
    const { text, steps } = await explain(calls[0]);
    const logs = steps.filter((s) => s.table === `${PLANS_CONFIG.database}.logs`);
    expect(logs.length, text).toBe(1);
    return logs[0];
  }

  async function mutationCommands(): Promise<string[]> {
    const resultSet = await explainClient.query({
      query: `SELECT command FROM system.mutations WHERE database = {db:String} AND table = 'logs' ORDER BY create_time, mutation_id`,
      query_params: { db: PLANS_CONFIG.database },
      format: 'JSONEachRow',
    });
    return ((await resultSet.json()) as { command: string }[]).map((r) => r.command);
  }

  async function lowerIndexRows(): Promise<{ expr: string; type: string }[]> {
    const resultSet = await explainClient.query({
      query: `SELECT expr, type FROM system.data_skipping_indices WHERE database = {db:String} AND table = 'logs' AND name = {name:String}`,
      query_params: { db: PLANS_CONFIG.database, name: LOWER_INDEX },
      format: 'JSONEachRow',
    });
    return (await resultSet.json()) as { expr: string; type: string }[];
  }

  it('the plan reader tells an unbounded read apart', async () => {
    const { text, steps } = await explain({ query: "SELECT id FROM logs WHERE message != ''" });
    expect(steps.map((s) => s.table), text).toEqual([`${PLANS_CONFIG.database}.logs`]);
    expect(steps[0].primaryKey, text).not.toContain('project_id');
    expect(steps[0].skipIndexes, text).not.toContain(LOWER_INDEX);
  });

  describe('lowercase message index', () => {
    it('initialize adds the lowercase ngram index without a mutation', async () => {
      expect(await lowerIndexRows()).toEqual([{ expr: 'lowerUTF8(message)', type: 'ngrambf_v1' }]);
      expect((await mutationCommands()).filter((c) => c.includes(`MATERIALIZE INDEX ${LOWER_INDEX}`))).toEqual([]);
    });

    it('phrase search can skip granules with the lowercase index', async () => {
      const read = await logsReadOf(() => engine.query({ projectId: P1, from: FROM, to: TO, limit: 10, textQuery: phrase('Timeout talking') }));
      expect(read.skipIndexes).toContain(LOWER_INDEX);
      expect(read.primaryKey).toContain('project_id');
    });

    it('word search prefilters with the lowercase index', async () => {
      const read = await logsReadOf(() => engine.query({ projectId: P1, from: FROM, to: TO, limit: 10, textQuery: word('timeout') }));
      expect(read.skipIndexes).toContain(LOWER_INDEX);
      expect(read.primaryKey).toContain('project_id');
    });

    it('legacy substring search uses the lowercase index too', async () => {
      const read = await logsReadOf(() =>
        engine.query({ projectId: P1, from: FROM, to: TO, limit: 10, search: 'Timeout talking', searchMode: 'substring' }),
      );
      expect(read.skipIndexes).toContain(LOWER_INDEX);
    });
  });

  it('spanId uses its bloom filter', async () => {
    const read = await logsReadOf(() => engine.query({ projectId: P1, from: FROM, to: TO, limit: 10, spanId: 'span-42' }));
    expect(read.skipIndexes).toContain('idx_span_id');
    expect(read.primaryKey).toContain('project_id');
  });

  describe('new log and span queries are bounded by the primary key', () => {
    const cases: [string, (e: ClickHouseEngine) => Promise<unknown>][] = [
      ['histogram', (e) => e.histogram({ projectId: P1, from: FROM, to: TO, bucketSeconds: 60, textQuery: word('timeout') })],
      [
        'facets',
        (e) =>
          e.facets({
            projectId: [P1, P2],
            from: FROM,
            to: TO,
            fields: [{ builtin: 'level' }, { builtin: 'service' }, { builtin: 'hostname' }, { metadata: 'status' }, { metadata: 'http.method' }],
          }),
      ],
      ['metadata key discovery', (e) => e.discoverMetadataKeys({ projectId: [P1, P2], from: FROM, to: TO, sampleSize: 500 })],
      ['session list', (e) => e.listSessions({ projectId: P1, from: FROM, to: TO, limit: 5, service: 'api' })],
      [
        'session list next page',
        async (e) => {
          const first = await e.listSessions({ projectId: P1, from: FROM, to: TO, limit: 3 });
          expect(first.nextCursor, 'the corpus has more than one page').toBeDefined();
          return e.listSessions({ projectId: P1, from: FROM, to: TO, limit: 3, cursor: first.nextCursor });
        },
      ],
      ['session presence', (e) => e.hasSessions({ projectId: P1, from: FROM, to: TO })],
      ['operation stats', (e) => e.getOperationStats({ projectId: P1, from: FROM, to: TO })],
      ['operation stats root fallback', (e) => e.getOperationStats({ projectId: P2, service: 'legacy', from: FROM, to: TO })],
      ['latency histogram', (e) => e.getLatencyHistogram({ projectId: P1, operation: 'op-0', from: FROM, to: TO })],
      ['latency histogram root fallback', (e) => e.getLatencyHistogram({ projectId: P2, service: 'legacy', from: FROM, to: TO })],
      [
        'span search with operation and attribute filters',
        (e) =>
          e.querySpans({
            projectId: P1,
            from: FROM,
            to: TO,
            operation: 'op-2',
            attributeFilters: [{ key: 'http.status', op: 'equals', value: '200', include_missing: false }],
            sortBy: 'duration',
          }),
      ],
      [
        'trace operation match',
        (e) =>
          e.queryTraces({
            projectId: P1,
            from: FROM,
            to: TO,
            operation: 'op-0',
            serviceName: 'api',
            attributeFilters: [{ key: 'resource.service.version', op: 'equals', value: '1.0.0', include_missing: false }],
          }),
      ],
    ];

    it.each(cases)('%s', async (_name, run) => {
      const calls = await recorded(() => run(engine));
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const { text, steps } = await explain(call);
        expect(steps.length, `no table read in:\n${text}`).toBeGreaterThan(0);
        for (const step of steps) {
          expect(step.primaryKey, `${step.table} read is not bounded by project_id:\n${call.query}\n${text}`).toContain('project_id');
        }
      }
    });

    // EXPLAIN builds the IN set before analysing the outer read, so the plan
    // shows the traces read narrowed by the matched trace ids and hides the
    // spans read; the span-match subquery is explained on its own below.
    it('trace operation match narrows the traces read to the matched trace ids', async () => {
      const calls = await recorded(() => engine.queryTraces({ projectId: P1, from: FROM, to: TO, operation: 'op-0' }));
      expect(calls.length).toBe(2);
      for (const call of calls) {
        const { text, steps } = await explain(call);
        const traces = steps.filter((s) => s.table === `${PLANS_CONFIG.database}.traces`);
        expect(traces.length, text).toBe(1);
        expect(traces[0].primaryKey, text).toEqual(expect.arrayContaining(['project_id', 'trace_id']));
      }
    });

    it('the trace span-match subquery reads spans through the primary key', async () => {
      const queryParams: Record<string, unknown> = {};
      const match = traceSpanMatchSql(
        {
          projectId: P1,
          from: FROM,
          to: TO,
          operation: 'op-0',
          serviceName: 'api',
          attributeFilters: [{ key: 'http.status', op: 'equals', value: '200', include_missing: false }],
        },
        queryParams,
      );
      const prefix = '(project_id, trace_id) IN (';
      expect(match?.startsWith(prefix)).toBe(true);
      const subquery = (match as string).slice(prefix.length, -1);
      const { text, steps } = await explain({ query: subquery, query_params: queryParams });
      expect(steps.map((s) => s.table), text).toEqual([`${PLANS_CONFIG.database}.spans`]);
      expect(steps[0].primaryKey, text).toContain('project_id');
    });
  });

  // Runs last: it rewrites the logs table's index state.
  describe('upgrade of an existing table', () => {
    it('adds the lowercase index on the next initialize without a mutation; older logs stay searchable', async () => {
      await client.command({
        query: `ALTER TABLE logs DROP INDEX IF EXISTS ${LOWER_INDEX}`,
        clickhouse_settings: { mutations_sync: '1' },
      });
      expect(await lowerIndexRows()).toEqual([]);
      const older = await engine.ingest([
        { time: new Date(FROM.getTime() + 500), projectId: P1, service: 'api', level: 'warn', message: 'Upgrade marker written before the index' },
      ]);
      expect(older.failed).toBe(0);
      const before = await mutationCommands();

      await engine.initialize();

      expect(await lowerIndexRows()).toEqual([{ expr: 'lowerUTF8(message)', type: 'ngrambf_v1' }]);
      expect(await mutationCommands(), 'initialize queued no mutation').toEqual(before);

      const newer = await engine.ingest([
        { time: new Date(FROM.getTime() + 700), projectId: P1, service: 'api', level: 'warn', message: 'UPGRADE MARKER written after the index' },
      ]);
      expect(newer.failed).toBe(0);
      const found = await engine.query({ projectId: P1, from: FROM, to: TO, limit: 10, textQuery: phrase('upgrade marker') });
      expect(found.logs.map((l) => l.message).sort()).toEqual([
        'UPGRADE MARKER written after the index',
        'Upgrade marker written before the index',
      ]);
    });
  });
});
