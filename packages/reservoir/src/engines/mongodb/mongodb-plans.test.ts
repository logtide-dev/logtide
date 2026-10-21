// ============================================================================
// MongoDB query plans: the new log and span queries use indexes
// ============================================================================
// Needs the reservoir test containers (MongoDB 7 on 27017). Own database
// `<database>_plans` (default `ux16_rmg_plans`), dropped before and after the
// run. The engine runs with default options, so `logs` is a time-series
// collection like production and its queries run on the bucket indexes.
//
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/mongodb/mongodb-plans.test.ts
//
// Every explain is checked on its winning plans only: at least one IXSCAN and
// no COLLSCAN. A COLLSCAN means a pipeline lost its leading `$match` on
// project and time; fix the pipeline, not the index set.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient, type Db, type Document } from 'mongodb';
import { isConformanceRequired } from '../../conformance/index.js';
import type { LogRecord, SpanKind, SpanRecord, StorageConfig, TraceQueryParams } from '../../core/types.js';
import { MongoDBEngine } from './mongodb-engine.js';
import { MongoDBQueryTranslator } from './query-translator.js';
import { discoverKeysPipeline, facetsPipeline, histogramPipeline, listSessionsPipeline, sessionMatch } from './log-analytics.js';
import { latencyHistogramPipeline, operationStatsPipeline, traceMatchPipeline, traceSort } from './apm-queries.js';

const BASE_DATABASE = process.env.RESERVOIR_MG_DATABASE ?? 'ux16_rmg';
const PLANS_DATABASE = `${BASE_DATABASE}_plans`;
const SERVER_URL = 'mongodb://localhost:27017/';

const CONFIG: StorageConfig = { host: 'localhost', port: 27017, database: PLANS_DATABASE, username: '', password: '' };

const PROJECTS = ['00000000-0000-4000-8000-0000000a1a01', '00000000-0000-4000-8000-0000000a1a02'];
const PROJECT = PROJECTS[0];
const BASE = Date.UTC(2026, 2, 3, 0, 0, 0);
const HOUR = 3_600_000;
const LOG_COUNT = 2000;
const SPAN_COUNT = 500;
/** Logs and spans cover 48 hours; the queries read a 6 hour window of it. */
const WINDOW = { from: new Date(BASE + 20 * HOUR), to: new Date(BASE + 26 * HOUR) };

const SERVICES = ['api', 'worker', 'billing', 'mailer'];
const LEVELS: LogRecord['level'][] = ['debug', 'info', 'warn', 'error', 'critical'];
const OPERATIONS = ['GET /users', 'POST /orders', 'GET /health', 'consume billing', 'render page'];
const KINDS: SpanKind[] = ['SERVER', 'CLIENT', 'INTERNAL', 'CONSUMER'];

let engine: MongoDBEngine | null = null;
let raw: MongoClient | null = null;
const translator = new MongoDBQueryTranslator();

function db(): Db {
  if (!raw) throw new Error('MongoDB plans client is not available');
  return raw.db(PLANS_DATABASE);
}

function seedLogs(): LogRecord[] {
  return Array.from({ length: LOG_COUNT }, (_, i) => ({
    time: new Date(BASE + Math.floor((i * 48 * HOUR) / LOG_COUNT)),
    projectId: PROJECTS[i % 2],
    service: SERVICES[i % SERVICES.length],
    level: LEVELS[i % LEVELS.length],
    message: i % 7 === 0 ? `request timeout after ${i} ms` : `request ${i} served`,
    metadata: {
      hostname: `host-${i % 5}`,
      status: i % 3 === 0 ? 500 : 200,
      http: { method: i % 2 === 0 ? 'GET' : 'POST' },
    },
    ...(i % 4 === 0 ? { sessionId: `session-${i % 40}` } : {}),
  }));
}

function seedSpans(): SpanRecord[] {
  return Array.from({ length: SPAN_COUNT }, (_, i) => {
    const start = new Date(BASE + Math.floor((i * 48 * HOUR) / SPAN_COUNT));
    const durationMs = 1 + ((i * 37) % 900);
    return {
      time: start,
      spanId: `span-${i}`,
      traceId: `trace-${Math.floor(i / 5)}`,
      ...(i % 5 === 0 ? {} : { parentSpanId: `span-${i - (i % 5)}` }),
      projectId: PROJECTS[Math.floor(i / 5) % 2],
      serviceName: SERVICES[i % SERVICES.length],
      operationName: OPERATIONS[i % OPERATIONS.length],
      startTime: start,
      endTime: new Date(start.getTime() + durationMs),
      durationMs,
      kind: KINDS[i % KINDS.length],
      statusCode: i % 11 === 0 ? 'ERROR' : 'OK',
      attributes: { 'http.route': `/r/${i % 9}` },
    };
  });
}

/** Every `winningPlan` object of an explain output, at any depth (find, aggregate, time-series unpacking). */
function winningPlans(explain: unknown): unknown[] {
  const found: unknown[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'winningPlan') found.push(value);
      else if (key !== 'rejectedPlans') visit(value);
    }
  };
  visit(explain);
  return found;
}

/** The winning plans read an index and never scan the collection; returns them as text for index-name checks. */
function expectIndexed(explain: Document): string {
  const plans = winningPlans(explain);
  expect(plans.length, 'explain has a winning plan').toBeGreaterThan(0);
  const text = JSON.stringify(plans);
  expect(text, 'winning plan reads an index').toContain('"IXSCAN"');
  expect(text, 'winning plan never scans the whole collection').not.toContain('COLLSCAN');
  return text;
}

async function explainAggregate(collection: string, pipeline: Document[]): Promise<Document> {
  return db().collection(collection).aggregate(pipeline, { allowDiskUse: true }).explain('queryPlanner');
}

const logScope = { projectId: PROJECT, ...WINDOW };

describe('mongodb query plans', () => {
  beforeAll(async () => {
    const client = new MongoClient(SERVER_URL, { serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      await client.db(PLANS_DATABASE).dropDatabase();
    } catch (err) {
      await client.close().catch(() => undefined);
      if (isConformanceRequired()) throw new Error(`MongoDB plan checks required but MongoDB is unreachable: ${String(err)}`, { cause: err });
      console.warn(`MongoDB plan checks skipped: ${String(err)}. Set RESERVOIR_CONFORMANCE_REQUIRED=1 to make this a failure.`);
      return;
    }
    raw = client;
    engine = new MongoDBEngine(CONFIG);
    await engine.connect();
    await engine.initialize();

    const logs = await engine.ingest(seedLogs());
    if (logs.failed > 0) throw new Error(`Seeding plan logs failed: ${JSON.stringify(logs.errors ?? [])}`);
    const spans = seedSpans();
    const ingested = await engine.ingestSpans(spans);
    if (ingested.failed > 0) throw new Error(`Seeding plan spans failed: ${JSON.stringify(ingested.errors ?? [])}`);
    const traces = new Map<string, SpanRecord[]>();
    for (const span of spans) traces.set(span.traceId, [...(traces.get(span.traceId) ?? []), span]);
    for (const [traceId, members] of traces) {
      const root = members[0];
      const endTime = new Date(Math.max(...members.map((s) => s.endTime.getTime())));
      await engine.upsertTrace({
        traceId,
        projectId: root.projectId,
        serviceName: root.serviceName,
        rootServiceName: root.serviceName,
        rootOperationName: root.operationName,
        startTime: root.startTime,
        endTime,
        durationMs: endTime.getTime() - root.startTime.getTime(),
        spanCount: members.length,
        error: members.some((s) => s.statusCode === 'ERROR'),
      });
    }
  }, 120_000);

  beforeEach(({ skip }) => {
    if (!engine) skip();
  });

  afterAll(async () => {
    await engine?.disconnect();
    await raw?.db(PLANS_DATABASE).dropDatabase().catch(() => undefined);
    await raw?.close();
    engine = null;
    raw = null;
  });

  it('initialize creates idx_span_operation_time on spans', async () => {
    const indexes = await db().collection('spans').indexes();
    const index = indexes.find((i) => i.name === 'idx_span_operation_time');
    expect(index?.key).toEqual({ project_id: 1, operation_name: 1, time: -1 });
  });

  it('the logs collection is time-series, so log plans run on its bucket indexes', async () => {
    const [info] = await db().listCollections({ name: 'logs' }).toArray();
    expect(info.type).toBe('timeseries');
  });

  it('a text query stays on the project-time index', async () => {
    const native = translator.translateQuery({
      ...logScope,
      limit: 50,
      textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [[{ kind: 'phrase', value: 'after' }, { kind: 'word', value: 'served' }]], none: [] },
    });
    const { sort, limit } = native.metadata as { sort: Document; limit: number };
    const explain = await db().collection('logs').find(native.query as Document).sort(sort).limit(limit + 1).explain('queryPlanner');
    expectIndexed(explain);
  });

  it('a filtered count stays on an index', async () => {
    const native = translator.translateCount({ ...logScope, service: 'api', exclude: { level: ['debug'] } });
    const explain = await db().collection('logs').find(native.query as Document).explain('queryPlanner');
    expectIndexed(explain);
  });

  it('the histogram stays on an index', async () => {
    const filter = translator.buildLogFilter({ ...logScope, level: ['error', 'critical'] });
    expectIndexed(await explainAggregate('logs', histogramPipeline(filter, 300_000)));
  });

  it('facets stay on an index', async () => {
    const filter = translator.buildLogFilter(logScope);
    const fields = [{ builtin: 'level' as const }, { builtin: 'hostname' as const }, { metadata: 'http.method' }];
    expectIndexed(await explainAggregate('logs', facetsPipeline(filter, fields, 10)));
  });

  it('metadata key discovery stays on an index', async () => {
    expectIndexed(await explainAggregate('logs', discoverKeysPipeline({ ...logScope, sampleSize: 1000 })));
  });

  it('multi-project key discovery stays on an index', async () => {
    expectIndexed(await explainAggregate('logs', discoverKeysPipeline({ projectId: PROJECTS, ...WINDOW, sampleSize: 1000 })));
  });

  it('the session list stays on an index', async () => {
    expectIndexed(await explainAggregate('logs', listSessionsPipeline(logScope, 50, null)));
    expectIndexed(
      await explainAggregate('logs', listSessionsPipeline({ ...logScope, service: 'api' }, 50, { lastEvent: new Date(BASE + 24 * HOUR), sessionId: 'session-8' })),
    );
  });

  it('session presence stays on an index', async () => {
    const explain = await db().collection('logs').find(sessionMatch(logScope), { projection: { _id: 1 } }).limit(1).explain('queryPlanner');
    expectIndexed(explain);
  });

  it('operation stats use the spans project-time or service-time index', async () => {
    for (const strategy of ['native', 'buckets'] as const) {
      const all = expectIndexed(await explainAggregate('spans', operationStatsPipeline({ ...logScope, limit: 50 }, 'kinds', strategy)));
      expect(all).toMatch(/idx_span_time|idx_span_service_time|idx_span_operation_time/);
      const roots = expectIndexed(await explainAggregate('spans', operationStatsPipeline({ ...logScope, limit: 50 }, 'root', strategy)));
      expect(roots).toMatch(/idx_span_time|idx_span_service_time|idx_span_operation_time/);
      const service = expectIndexed(
        await explainAggregate('spans', operationStatsPipeline({ ...logScope, service: 'api', limit: 50 }, 'kinds', strategy)),
      );
      expect(service).toMatch(/idx_span_service_time|idx_span_service_status_time/);
    }
  });

  it('an operation-filtered latency histogram uses idx_span_operation_time', async () => {
    const text = expectIndexed(await explainAggregate('spans', latencyHistogramPipeline({ ...logScope, operation: 'GET /users' }, 'kinds')));
    expect(text).toContain('idx_span_operation_time');
  });

  it('the trace operation match probes spans through idx_span_operation_time', async () => {
    const params: TraceQueryParams = { ...logScope, operation: 'POST /orders' };
    const text = expectIndexed(await explainAggregate('spans', traceMatchPipeline(params, traceSort(params), 0, 50)));
    expect(text).toContain('idx_span_operation_time');
  });

  it('the trace attribute match stays on the spans project-time index', async () => {
    const params: TraceQueryParams = { ...logScope, attributeFilters: [{ key: 'http.route', op: 'equals', value: '/r/3', include_missing: false }] };
    expectIndexed(await explainAggregate('spans', traceMatchPipeline(params, traceSort(params), 0, 50)));
  });
});
