// ============================================================================
// TimescaleDB plan checks (R-TS)
// ============================================================================
// EXPLAINs the SQL the engine sends for the 1.6 log and APM queries, against
// a seeded schema with sequential scans disabled. A plan without the
// expected index (or with a Seq Scan) means a predicate the existing
// indexes cannot serve: the fix is a different SQL shape, never a new index
// (plan anti-goal, no backend migration).
//
// Real database (ux16_rts on localhost:5433 unless RESERVOIR_TIMESCALE_URL
// says otherwise), own schema `reservoir_ts_plans`.
//
//   cd packages/reservoir
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/timescale/timescale-plans.test.ts
//
// Without RESERVOIR_CONFORMANCE_REQUIRED=1 an unreachable server skips.

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  isConformanceRequired,
  probeConformanceTarget,
  resolveConformanceTarget,
  resolveSubject,
} from '../../conformance/index.js';
import type { LogLevel, LogRecord, SpanKind, SpanRecord, TextQuery, TraceRecord } from '../../core/types.js';
import { entryProbeSql, latencyHistogramSql, operationStatsSql } from './apm-queries.js';
import { TimescaleEngine } from './timescale-engine.js';

const DEFAULT_URL = 'postgresql://logtide_test:test_password@localhost:5433/ux16_rts';
const SCHEMA = 'reservoir_ts_plans';
const PROJECT_A = 'plans-a';
const PROJECT_B = 'plans-b';
const BASE = Date.UTC(2026, 0, 6, 8, 0, 0);
const WINDOW = { from: new Date(BASE - 60_000), to: new Date(BASE + 3 * 3_600_000) };
const LOG_COUNT = 2000;
const TRACE_COUNT = 100;
const SPANS_PER_TRACE = 5;

const SERVICES = ['api', 'worker', 'web', 'billing'];
const LEVELS: LogLevel[] = ['info', 'info', 'info', 'warn', 'error', 'debug', 'critical'];

/** One SQL statement the engine sent, with its bound parameters. */
interface Captured {
  sql: string;
  params: unknown[];
}

/** Plan facts the assertions read. */
interface PlanFacts {
  sql: string;
  indexes: string[];
  seqScans: string[];
}

function seedLogs(): LogRecord[] {
  return Array.from({ length: LOG_COUNT }, (_, i) => {
    let message = `request ${i} handled in ${i % 97} ms`;
    if (i % 200 === 7) message = `upstream timeout while calling payments (attempt ${i})`;
    else if (i % 250 === 11) message = `payment declined for card ending ${i}`;
    else if (i % 300 === 13) message = `db pool exhausted on shard ${i % 4}`;
    return {
      time: new Date(BASE + i * 1000),
      projectId: i % 2 === 0 ? PROJECT_A : PROJECT_B,
      service: SERVICES[i % SERVICES.length],
      level: LEVELS[i % LEVELS.length],
      message,
      metadata: { hostname: `host-${i % 10}`, region: i % 3 === 0 ? 'eu' : 'us', status: i % 9 === 0 ? 500 : 200 },
      traceId: `trace-${i % 400}`,
      spanId: `log-span-${i}`,
      sessionId: i % 5 === 0 ? `sess-${i % 60}` : undefined,
    };
  });
}

function seedSpans(): { spans: SpanRecord[]; traces: TraceRecord[] } {
  const spans: SpanRecord[] = [];
  const traces: TraceRecord[] = [];
  for (let t = 0; t < TRACE_COUNT; t++) {
    const projectId = t % 2 === 0 ? PROJECT_A : PROJECT_B;
    const service = t % 3 === 0 ? 'worker' : 'api';
    const traceId = `plans-trace-${t}`;
    const start = BASE + t * 60_000;
    for (let j = 0; j < SPANS_PER_TRACE; j++) {
      const kind: SpanKind = j === 0 ? 'SERVER' : j % 2 === 0 ? 'CLIENT' : 'INTERNAL';
      const time = new Date(start + j * 10);
      const durationMs = j === 0 ? 50 + (t % 40) * 25 : 5 + j;
      spans.push({
        time,
        spanId: `plans-span-${t}-${j}`,
        traceId,
        parentSpanId: j === 0 ? undefined : `plans-span-${t}-0`,
        projectId,
        serviceName: service,
        operationName: j === 0 ? `GET /items/${t % 10}` : `step ${j}`,
        startTime: time,
        endTime: new Date(time.getTime() + durationMs),
        durationMs,
        kind,
        statusCode: t % 11 === 0 && j === 0 ? 'ERROR' : 'OK',
        attributes: { 'http.route': `/items/${t % 10}`, http: { method: 'GET' } },
        resourceAttributes: { 'service.version': `1.${t % 3}` },
      });
    }
    traces.push({
      traceId,
      projectId,
      serviceName: service,
      rootServiceName: service,
      rootOperationName: `GET /items/${t % 10}`,
      startTime: new Date(start),
      endTime: new Date(start + 2000),
      durationMs: 2000,
      spanCount: SPANS_PER_TRACE,
      error: t % 11 === 0,
    });
  }
  return { spans, traces };
}

function collect(node: unknown, out: { indexes: string[]; seqScans: string[] }): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record['Index Name'] === 'string') out.indexes.push(record['Index Name']);
  if (record['Node Type'] === 'Seq Scan') out.seqScans.push(String(record['Relation Name'] ?? '?'));
  for (const value of Object.values(record)) collect(value, out);
}

class PlanHarness {
  private readonly recorded: Captured[] = [];
  readonly engine: TimescaleEngine;

  private constructor(
    private readonly pool: pg.Pool,
    private readonly explainClient: pg.Client,
  ) {
    const recorded = this.recorded;
    // Records every statement, then runs it for real so multi-step methods
    // (fallbacks, count plus page) take their real branches.
    const recordingPool = {
      query: (sql: string, params?: unknown[]) => {
        recorded.push({ sql, params: params ?? [] });
        return pool.query(sql, params as unknown[]);
      },
    } as unknown as pg.Pool;
    this.engine = new TimescaleEngine({ host: '', port: 0, database: '', schema: SCHEMA }, { pool: recordingPool, skipInitialize: true });
  }

  static async create(): Promise<PlanHarness> {
    const env = { ...process.env, RESERVOIR_TIMESCALE_URL: process.env.RESERVOIR_TIMESCALE_URL || DEFAULT_URL };
    const target = resolveConformanceTarget('timescale', env);
    await probeConformanceTarget(target);
    const config = { ...target.config, schema: SCHEMA };
    const clientConfig = { host: config.host, port: config.port, database: config.database, user: config.username, password: config.password };

    const admin = new pg.Client(clientConfig);
    await admin.connect();
    try {
      await admin.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await admin.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await admin.end();
    }

    const seeder = new TimescaleEngine(config);
    await seeder.connect();
    try {
      await seeder.initialize();
      const logs = await seeder.ingest(seedLogs());
      if (logs.failed > 0) throw new Error(`Seeding plan logs failed: ${JSON.stringify(logs.errors ?? [])}`);
      const { spans, traces } = seedSpans();
      const ingested = await seeder.ingestSpans(spans);
      if (ingested.failed > 0) throw new Error(`Seeding plan spans failed: ${JSON.stringify(ingested.errors ?? [])}`);
      for (const trace of traces) await seeder.upsertTrace(trace);
    } finally {
      await seeder.disconnect();
    }

    const pool = new pg.Pool({ ...clientConfig, max: 2 });
    pool.on('error', () => undefined);
    const explainClient = new pg.Client(clientConfig);
    explainClient.on('error', () => undefined);
    await explainClient.connect();
    // The seed is older than the engine's 7 day compression policy, so its
    // background job could compress chunks mid-run and change every plan.
    // Drop the policies and undo anything it already compressed.
    const jobs = await explainClient.query(
      `SELECT hypertable_name FROM timescaledb_information.jobs WHERE proc_name = 'policy_compression' AND hypertable_schema = $1`,
      [SCHEMA],
    );
    for (const { hypertable_name: table } of jobs.rows as { hypertable_name: string }[]) {
      await explainClient.query(`SELECT remove_compression_policy('${SCHEMA}.${table}', if_exists => TRUE)`);
      await explainClient.query(`SELECT decompress_chunk(c, if_compressed => TRUE) FROM show_chunks('${SCHEMA}.${table}') c`);
    }
    // VACUUM also merges the GIN pending lists the bulk seed filled: until
    // then the planner prices the text indexes by their unsorted pending
    // pages, a state autovacuum ends within seconds on a real server.
    for (const table of ['logs', 'spans', 'traces']) await explainClient.query(`VACUUM ANALYZE ${SCHEMA}.${table}`);
    // Session-level: every EXPLAIN below runs without sequential scans.
    await explainClient.query('SET enable_seqscan = off');
    return new PlanHarness(pool, explainClient);
  }

  /** The statements one engine call sends. */
  async capture(call: (engine: TimescaleEngine) => Promise<unknown>): Promise<Captured[]> {
    this.recorded.length = 0;
    await call(this.engine);
    const out = [...this.recorded];
    this.recorded.length = 0;
    if (out.length === 0) throw new Error('The engine call sent no SQL');
    return out;
  }

  async explain(statement: Captured): Promise<PlanFacts> {
    const { rows } = await this.explainClient.query(`EXPLAIN (FORMAT JSON) ${statement.sql}`, statement.params as unknown[]);
    const facts = { indexes: [] as string[], seqScans: [] as string[] };
    collect((rows[0] as Record<string, unknown>)['QUERY PLAN'], facts);
    return { sql: statement.sql, ...facts };
  }

  /** Plans of every statement of one engine call. */
  async plansOf(call: (engine: TimescaleEngine) => Promise<unknown>): Promise<PlanFacts[]> {
    const statements = await this.capture(call);
    const plans: PlanFacts[] = [];
    for (const statement of statements) plans.push(await this.explain(statement));
    return plans;
  }

  async close(): Promise<void> {
    await this.explainClient.end();
    await this.pool.end();
  }
}

/** Every plan uses an index matching `pattern` and no plan scans a table sequentially. */
function expectIndexed(plans: PlanFacts[], pattern: RegExp): void {
  for (const plan of plans) {
    expect(plan.seqScans, `sequential scan in: ${plan.sql}`).toEqual([]);
    expect(plan.indexes.join(' '), `index for: ${plan.sql}`).toMatch(pattern);
  }
}

const words = (...values: string[]): TextQuery => ({ all: values.map((value) => ({ kind: 'word' as const, value })), anyOf: [], none: [] });
const phrases = (...values: string[]): TextQuery => ({ all: values.map((value) => ({ kind: 'phrase' as const, value })), anyOf: [], none: [] });
const logScope = { projectId: PROJECT_A, ...WINDOW };
const spanScope = { projectId: PROJECT_A, ...WINDOW };

describe('timescale query plans', () => {
  let harness: PlanHarness | null = null;

  beforeAll(async () => {
    harness = await resolveSubject('timescale', () => PlanHarness.create(), isConformanceRequired());
  }, 120_000);

  beforeEach(({ skip }) => {
    if (!harness) skip();
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const h = (): PlanHarness => {
    if (!harness) throw new Error('No Timescale plan harness');
    return harness;
  };

  it('word search uses the full-text or trigram index', async () => {
    const plans = await h().plansOf(async (engine) => {
      await engine.query({ ...logScope, textQuery: words('timeout'), limit: 50 });
      await engine.count({ ...logScope, textQuery: words('timeout') });
    });
    expect(plans).toHaveLength(2);
    expectIndexed(plans, /fulltext|message_trgm/);
  });

  it('a word group and an excluded word keep the text indexes', async () => {
    const textQuery: TextQuery = { all: [], anyOf: [[{ kind: 'word', value: 'timeout' }, { kind: 'word', value: 'declined' }]], none: [{ kind: 'word', value: 'payments' }] };
    expectIndexed(await h().plansOf((engine) => engine.count({ ...logScope, textQuery })), /fulltext|message_trgm/);
  });

  it('a word with an underscore uses the trigram index', async () => {
    expectIndexed(await h().plansOf((engine) => engine.count({ ...logScope, textQuery: words('user_id') })), /message_trgm/);
  });

  it('a word too short for trigrams still avoids a sequential scan', async () => {
    // Two letters give the trigram index nothing to search; the project-time
    // index bounds the scan instead (known limitation, no new index).
    expectIndexed(await h().plansOf((engine) => engine.count({ ...logScope, textQuery: words('db') })), /fulltext|message_trgm|composite/);
  });

  it('phrase search uses the trigram index', async () => {
    const plans = await h().plansOf(async (engine) => {
      await engine.query({ ...logScope, textQuery: phrases('payment declined'), limit: 50 });
      await engine.count({ ...logScope, textQuery: phrases('payment declined') });
    });
    expectIndexed(plans, /message_trgm/);
  });

  it('spanId uses the span_id index', async () => {
    const plans = await h().plansOf(async (engine) => {
      await engine.query({ ...logScope, spanId: 'log-span-42', limit: 50 });
      await engine.count({ ...logScope, spanId: 'log-span-42' });
    });
    expectIndexed(plans, /span_id/);
  });

  it('histogram and facets stay on the project-time index', async () => {
    const plans = await h().plansOf(async (engine) => {
      await engine.histogram({ ...logScope, bucketSeconds: 60 });
      await engine.facets({ ...logScope, fields: [{ builtin: 'level' }, { builtin: 'hostname' }, { metadata: 'region' }] });
      await engine.histogram({ ...logScope, bucketSeconds: 300, exclude: { service: ['worker'], hostname: ['host-1'] } });
    });
    expect(plans).toHaveLength(3);
    expectIndexed(plans, /composite|project_time/);
  });

  it('metadata key discovery samples each project through the composite index', async () => {
    // Not the hypertable time index: that one walks the newest logs of
    // every project in the instance until the sample is full.
    const plans = await h().plansOf(async (engine) => {
      await engine.discoverMetadataKeys({ projectId: PROJECT_A, ...WINDOW, sampleSize: 500 });
      await engine.discoverMetadataKeys({ projectId: [PROJECT_A, PROJECT_B], ...WINDOW, sampleSize: 500 });
    });
    expect(plans).toHaveLength(2);
    for (const plan of plans) expect(plan.indexes.join(' ')).not.toMatch(/logs_time_idx/);
    expectIndexed(plans, /composite/);
  });

  it('operation stats use the spans project-time index', async () => {
    const statsPlans = await h().plansOf((engine) => engine.getOperationStats({ ...spanScope, service: 'api' }));
    expectIndexed(statsPlans, /idx_spans_project_time/);
    const latencyPlans = await h().plansOf((engine) => engine.getLatencyHistogram({ ...spanScope, operation: 'GET /items/2' }));
    expectIndexed(latencyPlans, /idx_spans_project_time|idx_spans_operation/);

    // The fallback shapes (root spans, entry probe) are not reached on this
    // data; plan them directly.
    const scope = { ...spanScope, limit: 100 };
    for (const native of [
      operationStatsSql(SCHEMA, scope, 'root'),
      latencyHistogramSql(SCHEMA, spanScope, 'root'),
      entryProbeSql(SCHEMA, spanScope),
    ]) {
      expectIndexed([await h().explain({ sql: native.query as string, params: native.parameters ?? [] })], /idx_spans_project_time/);
    }
  });

  it('span queries with operation and attribute filters stay on a spans index', async () => {
    const plans = await h().plansOf((engine) =>
      engine.querySpans({
        ...spanScope,
        operation: 'GET /items/3',
        attributeFilters: [{ key: 'http.route', op: 'equals', value: '/items/3' }],
        sortBy: 'duration',
        sortOrder: 'desc',
        limit: 20,
      }),
    );
    expect(plans).toHaveLength(2);
    expectIndexed(plans, /idx_spans_operation|idx_spans_project_time/);
  });

  it('trace operation filter probes spans by operation or trace id', async () => {
    const plans = await h().plansOf((engine) =>
      engine.queryTraces({
        ...spanScope,
        operation: 'GET /items/4',
        attributeFilters: [{ key: 'resource.service.version', op: 'equals', value: '1.1' }],
        limit: 20,
      }),
    );
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan.seqScans, `sequential scan in: ${plan.sql}`).toEqual([]);
      expect(plan.indexes.join(' ')).toMatch(/idx_spans_operation|idx_spans_trace_id/);
      expect(plan.indexes.join(' ')).toMatch(/idx_traces_project_time|traces_pkey/);
    }
  });

  it('session list and presence stay on the session or project-time index', async () => {
    const plans = await h().plansOf(async (engine) => {
      const first = await engine.listSessions({ ...logScope, limit: 5 });
      expect(first.nextCursor).toBeDefined();
      await engine.listSessions({ ...logScope, limit: 5, cursor: first.nextCursor, service: 'api' });
      await engine.hasSessions(logScope);
    });
    expect(plans).toHaveLength(3);
    expectIndexed(plans, /session_id|composite|project_time/);
  });
});
