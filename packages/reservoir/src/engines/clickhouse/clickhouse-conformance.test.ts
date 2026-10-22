// ClickHouse against the reservoir conformance suite (spec 6.4) plus
// engine-specific integration cases. Real server, no mocks.
//
// Run from packages/reservoir:
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/clickhouse/clickhouse-conformance.test.ts
// The suite database (default ux16_rch) and the specifics database (the same
// name plus `_specifics`) are dropped and recreated per run, so they must match
// CONFORMANCE_NAMESPACE_PATTERN; shared test databases are refused.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeReservoirConformance,
  createConformanceReservoir,
  isConformanceRequired,
  resolveSubject,
} from '../../conformance/index.js';
import type { Reservoir } from '../../client.js';
import type {
  LogRecord,
  MetadataFilter,
  QueryParams,
  SpanKind,
  SpanRecord,
  SpanStatusCode,
  TextQuery,
  TraceRecord,
} from '../../core/types.js';

export const CH_TEST_CONFIG = {
  host: 'localhost',
  port: 18123,
  database: process.env.RESERVOIR_CH_DATABASE ?? 'ux16_rch',
  username: 'default',
  password: '',
} as const;

function chUrl(database: string): string {
  return `http://${CH_TEST_CONFIG.username}:${CH_TEST_CONFIG.password}@${CH_TEST_CONFIG.host}:${CH_TEST_CONFIG.port}/${database}`;
}

/** A fresh, initialized Reservoir over its own dropped and recreated database. */
export function createClickHouseSubject(database: string): Promise<Reservoir> {
  return createConformanceReservoir('clickhouse', { ...process.env, RESERVOIR_CLICKHOUSE_URL: chUrl(database) });
}

export const CH_SPECIFICS_DATABASE = `${CH_TEST_CONFIG.database}_specifics`;

describeReservoirConformance('clickhouse', {
  create: () => createClickHouseSubject(CH_TEST_CONFIG.database),
});

// ----------------------------------------------------------------------------
// Engine-specific integration cases (own database, one project per describe)
// ----------------------------------------------------------------------------

const SPECIFICS_FROM = new Date('2026-02-01T00:00:00.000Z');
const SPECIFICS_TO = new Date('2026-02-01T01:00:00.000Z');

let specifics: Promise<Reservoir | null> | undefined;

/** The shared specifics subject, created (database reset) on first use. */
function specificsSubject(): Promise<Reservoir | null> {
  specifics ??= resolveSubject('clickhouse', () => createClickHouseSubject(CH_SPECIFICS_DATABASE), isConformanceRequired());
  return specifics;
}

afterAll(async () => {
  const subject = specifics ? await specifics.catch(() => null) : null;
  if (subject) await subject.close();
});

/**
 * Registers hooks that seed `messages` (or full records) under `projectId`
 * and returns an accessor for the subject; tests skip when it is unavailable.
 */
function useSpecifics(projectId: string, records: (Partial<LogRecord> & { message: string })[]): () => Reservoir {
  let subject: Reservoir | null = null;
  beforeAll(async () => {
    subject = await specificsSubject();
    if (!subject) return;
    const logs: LogRecord[] = records.map((r, i) => ({
      time: new Date(SPECIFICS_FROM.getTime() + (i + 1) * 1000),
      projectId,
      service: 'api',
      level: 'info',
      ...r,
    }));
    const result = await subject.ingest(logs);
    if (result.failed > 0) throw new Error(`Seeding specifics failed: ${JSON.stringify(result.errors ?? [])}`);
  }, 60_000);
  beforeEach(({ skip }) => {
    if (!subject) skip();
  });
  return () => {
    if (!subject) throw new Error('ClickHouse specifics subject is not available');
    return subject;
  };
}

async function messagesOf(subject: Reservoir, projectId: string, extra: Partial<QueryParams>): Promise<string[]> {
  const params = { projectId, from: SPECIFICS_FROM, to: SPECIFICS_TO, limit: 1000, sortOrder: 'asc', ...extra } as QueryParams;
  const result = await subject.query(params);
  const { count } = await subject.count(params);
  expect(count, 'count equals the number of returned logs').toBe(result.logs.length);
  return result.logs.map((l) => l.message).sort();
}

const words = (...values: string[]): TextQuery => ({ all: values.map((value) => ({ kind: 'word' as const, value })), anyOf: [], none: [] });
const phrase = (value: string): TextQuery => ({ all: [{ kind: 'phrase', value }], anyOf: [], none: [] });

describe('clickhouse text specifics', () => {
  const project = '00000000-0000-4000-8000-00000000c301';
  const subject = useSpecifics(project, [
    { message: 'service down' },
    { message: 'GET https://api.timeout.com/v1 failed' },
    { message: 'read /var/log/timeout.log' },
    { message: 'user_id missing' },
    { message: 'user id missing' },
    { message: 'connection refused' },
    { message: 'install c++ (beta) now' },
    { message: 'Überweisung fehlgeschlagen' },
    { message: 'Überweisungen offen' },
  ]);

  it('everyday tokens match whole words', async () => {
    expect(await messagesOf(subject(), project, { textQuery: words('down') })).toEqual(['service down']);
    expect(await messagesOf(subject(), project, { textQuery: words('timeout') })).toEqual([
      'GET https://api.timeout.com/v1 failed',
      'read /var/log/timeout.log',
    ]);
    expect(await messagesOf(subject(), project, { textQuery: words('user_id') })).toEqual(['user_id missing']);
  });

  it('words are not stemmed', async () => {
    expect(await messagesOf(subject(), project, { textQuery: words('connections') })).toEqual([]);
  });

  it('phrase metacharacters match literally', async () => {
    expect(await messagesOf(subject(), project, { textQuery: phrase('c++ (beta)') })).toEqual(['install c++ (beta) now']);
    expect(await messagesOf(subject(), project, { textQuery: phrase('c+ (beta)') })).toEqual([]);
  });

  it('non-English words fold case and match whole tokens', async () => {
    expect(await messagesOf(subject(), project, { textQuery: words('überweisung') })).toEqual(['Überweisung fehlgeschlagen']);
    expect(await messagesOf(subject(), project, { textQuery: phrase('ÜBERWEISUNG') })).toEqual([
      'Überweisung fehlgeschlagen',
      'Überweisungen offen',
    ]);
  });

  it('legacy search params still work', async () => {
    expect(await messagesOf(subject(), project, { search: 'TIMEOUT log' })).toEqual(['read /var/log/timeout.log']);
    expect(await messagesOf(subject(), project, { search: '(beta)', searchMode: 'substring' })).toEqual(['install c++ (beta) now']);
  });
});

describe('clickhouse json specifics', () => {
  const project = '00000000-0000-4000-8000-00000000c302';
  const subject = useSpecifics(project, [
    { message: 'A', metadata: { 'http.status': 200 } },
    { message: 'B', metadata: { http: { status: 200 } } },
    { message: 'C', metadata: { 'http.status': 404, http: { status: 200 } } },
    { message: 'D', metadata: { status: 500, cached: true, env: 'prod' } },
    { message: 'E', metadata: { user: { id: 42 }, env: 'dev' } },
    { message: 'F', metadata: {} },
  ]);
  const where = (...metadataFilters: MetadataFilter[]) => messagesOf(subject(), project, { metadataFilters });
  const f = (o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter =>
    ({ include_missing: o.op === 'not_equals' || o.op === 'not_in' || o.op === 'not_exists', ...o }) as MetadataFilter;

  it('literal dotted keys before nested paths', async () => {
    expect(await where(f({ key: 'http.status', op: 'equals', value: '200' }))).toEqual(['A', 'B']);
    expect(await where(f({ key: 'http.status', op: 'equals', value: '404' }))).toEqual(['C']);
  });

  it('nested numeric path', async () => {
    expect(await where(f({ key: 'user.id', op: 'equals', value: '42' }))).toEqual(['E']);
    expect(await where(f({ key: 'user.id', op: 'in', values: ['42', '43'] }))).toEqual(['E']);
    expect(await where(f({ key: 'user.id', op: 'exists' }))).toEqual(['E']);
  });

  it('numbers and booleans match by text', async () => {
    expect(await where(f({ key: 'status', op: 'equals', value: '500' }))).toEqual(['D']);
    expect(await where(f({ key: 'cached', op: 'equals', value: 'true' }))).toEqual(['D']);
    expect(await where(f({ key: 'status', op: 'in', values: ['500', '501'] }))).toEqual(['D']);
    expect(await where(f({ key: 'status', op: 'contains', value: '50' }))).toEqual(['D']);
  });

  it('negated clauses keep logs without the key', async () => {
    expect(await where(f({ key: 'env', op: 'not_equals', value: 'prod' }))).toEqual(['A', 'B', 'C', 'E', 'F']);
    expect(await where(f({ key: 'env', op: 'not_in', values: ['prod', 'dev'] }))).toEqual(['A', 'B', 'C', 'F']);
    expect(await where(f({ key: 'user.id', op: 'not_equals', value: '42' }))).toEqual(['A', 'B', 'C', 'D', 'F']);
    expect(await where(f({ key: 'env', op: 'not_exists' }))).toEqual(['A', 'B', 'C', 'F']);
  });

  it('include_missing false keeps only logs where the key resolves', async () => {
    expect(await where(f({ key: 'env', op: 'not_equals', value: 'prod', include_missing: false }))).toEqual(['E']);
    expect(await where(f({ key: 'http.status', op: 'not_in', values: ['404'], include_missing: false }))).toEqual(['A', 'B']);
  });
});

describe('clickhouse json specifics: facets', () => {
  const project = '00000000-0000-4000-8000-00000000c303';
  const subject = useSpecifics(project, [
    { message: 'number', metadata: { code: 500 } },
    { message: 'string', metadata: { code: '500' } },
    { message: 'object', metadata: { code: { a: 1 } } },
    { message: 'boolean', metadata: { ok: true } },
  ]);

  it('numeric and boolean metadata facet as text, objects excluded', async () => {
    const { facets } = await subject().facets({
      projectId: project,
      from: SPECIFICS_FROM,
      to: SPECIFICS_TO,
      fields: [{ metadata: 'code' }, { metadata: 'ok' }],
    });
    expect(facets).toEqual([
      { field: 'metadata.code', values: [{ value: '500', count: 2 }], otherCount: 0 },
      { field: 'metadata.ok', values: [{ value: 'true', count: 1 }], otherCount: 0 },
    ]);
  });
});

describe('clickhouse json specifics: metadata keys', () => {
  const project = '00000000-0000-4000-8000-00000000c304';
  // Seeded oldest first: t1, t2, t3 (newest).
  const subject = useSpecifics(project, [
    { message: 't1', metadata: { a: 1, http: { method: 'GET', 'x.y': 1 } } },
    { message: 't2', metadata: { a: 2, old: true } },
    { message: 't3', metadata: { a: 3, b: null } },
  ]);
  const discover = (sampleSize: number) =>
    subject().discoverMetadataKeys({ projectId: project, from: SPECIFICS_FROM, to: SPECIFICS_TO, sampleSize });

  it('the sample is the newest logs', async () => {
    expect(await discover(2)).toEqual([
      { key: 'a', occurrences: 2 },
      { key: 'b', occurrences: 1 },
      { key: 'old', occurrences: 1 },
    ]);
  });

  it('objects expand one level, children with a dot are skipped', async () => {
    const keys = (await discover(3)).map((k) => k.key);
    expect(keys).toEqual(['a', 'b', 'http.method', 'old']);
  });
});

// ----------------------------------------------------------------------------
// Span and trace specifics
// ----------------------------------------------------------------------------

/** Registers hooks that seed spans (and their traces) and returns an accessor for the subject. */
function useSpecificSpans(spans: SpanRecord[], traces: TraceRecord[]): () => Reservoir {
  let subject: Reservoir | null = null;
  beforeAll(async () => {
    subject = await specificsSubject();
    if (!subject) return;
    const result = await subject.ingestSpans(spans);
    if (result.failed > 0) throw new Error(`Seeding specific spans failed: ${JSON.stringify(result.errors ?? [])}`);
    for (const trace of traces) await subject.upsertTrace(trace);
  }, 60_000);
  beforeEach(({ skip }) => {
    if (!subject) skip();
  });
  return () => {
    if (!subject) throw new Error('ClickHouse specifics subject is not available');
    return subject;
  };
}

interface SpecificSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  service: string;
  operation: string;
  durationMs: number;
  kind?: SpanKind;
  status?: SpanStatusCode;
  second: number;
  attributes?: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
}

function specificSpan(projectId: string, s: SpecificSpan): SpanRecord {
  const start = new Date(SPECIFICS_FROM.getTime() + s.second * 1000);
  return {
    time: start,
    spanId: s.spanId,
    traceId: s.traceId,
    ...(s.parentSpanId !== undefined ? { parentSpanId: s.parentSpanId } : {}),
    projectId,
    serviceName: s.service,
    operationName: s.operation,
    startTime: start,
    endTime: new Date(start.getTime() + s.durationMs),
    durationMs: s.durationMs,
    ...(s.kind !== undefined ? { kind: s.kind } : {}),
    statusCode: s.status ?? 'OK',
    attributes: s.attributes ?? {},
    ...(s.resourceAttributes !== undefined ? { resourceAttributes: s.resourceAttributes } : {}),
  };
}

/** One trace row per distinct trace id; the first span listed for it gives the trace-level service. */
function tracesOf(spans: SpanRecord[]): TraceRecord[] {
  const byTrace = new Map<string, SpanRecord[]>();
  for (const s of spans) byTrace.set(s.traceId, [...(byTrace.get(s.traceId) ?? []), s]);
  return [...byTrace.values()].map((group) => {
    const start = Math.min(...group.map((s) => s.startTime.getTime()));
    const end = Math.max(...group.map((s) => s.endTime.getTime()));
    return {
      traceId: group[0].traceId,
      projectId: group[0].projectId,
      serviceName: group[0].serviceName,
      startTime: new Date(start),
      endTime: new Date(end),
      durationMs: end - start,
      spanCount: group.length,
      error: group.some((s) => s.statusCode === 'ERROR'),
    };
  });
}

describe('clickhouse apm specifics: span and trace filters', () => {
  const project = '00000000-0000-4000-8000-00000000c305';
  const T1 = 'c3050000000000000000000000000001';
  const T2 = 'c3050000000000000000000000000002';
  const spans = [
    { traceId: T1, spanId: 'c305000000000a01', service: 'frontend', operation: 'page load', durationMs: 90, second: 1 },
    { traceId: T1, spanId: 'c305000000000a02', parentSpanId: 'c305000000000a01', service: 'api', operation: 'GET /x', durationMs: 40, second: 2, resourceAttributes: { 'service.version': '1.2' } },
    { traceId: T2, spanId: 'c305000000000b01', service: 'api', operation: 'GET /y', durationMs: 70, second: 3 },
    { traceId: T2, spanId: 'c305000000000b02', parentSpanId: 'c305000000000b01', service: 'worker', operation: 'GET /x', durationMs: 20, second: 4, resourceAttributes: { service: { version: '1.3' } } },
  ].map((s) => specificSpan(project, s));
  const subject = useSpecificSpans(spans, tracesOf(spans));
  const window = { projectId: project, from: SPECIFICS_FROM, to: SPECIFICS_TO };

  it('serviceName stays trace level while the span-match block is active', async () => {
    const matched = await subject().queryTraces({ ...window, serviceName: 'api', operation: 'GET /x' });
    expect(matched.traces.map((t) => t.traceId)).toEqual([T2]);
    expect(matched.total).toBe(1);
    const frontend = await subject().queryTraces({ ...window, serviceName: 'frontend', operation: 'GET /x' });
    expect(frontend.traces.map((t) => t.traceId)).toEqual([T1]);
    const traceLevel = await subject().queryTraces({ ...window, serviceName: 'api' });
    expect(traceLevel.traces.map((t) => t.traceId)).toEqual([T2]);
  });

  it('the matching span must start inside the window', async () => {
    const early = { ...window, to: new Date(SPECIFICS_FROM.getTime() + 3500) };
    // T2 starts at 3 s; its GET /x span starts at 4 s, after this window.
    expect((await subject().queryTraces({ ...early, operation: 'GET /x' })).traces.map((t) => t.traceId)).toEqual([T1]);
  });

  it('resource-prefixed attribute filters read the resource attributes', async () => {
    const literal = await subject().querySpans({ ...window, attributeFilters: [{ key: 'resource.service.version', op: 'equals', value: '1.2', include_missing: false }] });
    expect(literal.spans.map((s) => s.spanId)).toEqual(['c305000000000a02']);
    const nested = await subject().querySpans({ ...window, attributeFilters: [{ key: 'resource.service.version', op: 'equals', value: '1.3', include_missing: false }] });
    expect(nested.spans.map((s) => s.spanId)).toEqual(['c305000000000b02']);
  });

  it('an operation name list keeps spans of every listed operation', async () => {
    const result = await subject().querySpans({ ...window, operationName: ['GET /x', 'GET /y'], sortBy: 'duration', sortOrder: 'desc' });
    expect(result.spans.map((s) => s.spanId)).toEqual(['c305000000000b01', 'c305000000000a02', 'c305000000000b02']);
    expect(result.total).toBe(3);
  });
});

describe('clickhouse apm specifics: entry spans', () => {
  const project = '00000000-0000-4000-8000-00000000c306';
  const trace = (n: number) => `c306000000000000000000000000000${n}`;
  const span = (n: number) => `c30600000000000${n.toString(16)}`;
  const spans = [
    // nokind: a root and a child, no span has a kind.
    { traceId: trace(1), spanId: span(1), service: 'nokind', operation: 'run', durationMs: 30, second: 1 },
    { traceId: trace(1), spanId: span(2), parentSpanId: span(1), service: 'nokind', operation: 'step', durationMs: 10, second: 2 },
    // mixed: the same shape plus one INTERNAL span; still no entry span, so the root fallback applies.
    { traceId: trace(2), spanId: span(3), service: 'mixed', operation: 'run', durationMs: 30, second: 3 },
    { traceId: trace(2), spanId: span(4), parentSpanId: span(3), service: 'mixed', operation: 'step', durationMs: 10, second: 4 },
    { traceId: trace(2), spanId: span(5), parentSpanId: span(3), service: 'mixed', operation: 'loop', durationMs: 5, second: 5, kind: 'INTERNAL' as const },
    // lat: server spans at the bucket edges.
    ...[0, 1, 59999, 60000, 120000].map((durationMs, i) => ({
      traceId: trace(3), spanId: span(6 + i), service: 'lat', operation: 'edge', durationMs, second: 10 + i, kind: 'SERVER' as const,
    })),
  ].map((s) => specificSpan(project, s));
  const subject = useSpecificSpans(spans, tracesOf(spans));
  const window = { projectId: project, from: SPECIFICS_FROM, to: SPECIFICS_TO };

  it('falls back to root spans whenever no span of the entry kinds is in scope', async () => {
    const nokind = await subject().getOperationStats({ ...window, service: 'nokind' });
    expect(nokind.map((r) => [r.operation, r.count, r.avgMs])).toEqual([['run', 1, 30]]);
    const mixed = await subject().getOperationStats({ ...window, service: 'mixed' });
    expect(mixed.map((r) => [r.operation, r.count, r.avgMs])).toEqual([['run', 1, 30]]);
    const latency = await subject().getLatencyHistogram({ ...window, service: 'mixed' });
    expect(latency.counts).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await subject().getOperationStats({ ...window, service: 'mixed', kinds: ['SERVER'] })).toEqual([]);
  });

  it('latency buckets clamp at 1 ms and put durations above 60 s in the overflow bucket', async () => {
    const { bounds, counts } = await subject().getLatencyHistogram({ ...window, service: 'lat' });
    expect(bounds).toHaveLength(16);
    expect(counts).toHaveLength(17);
    expect(counts[0]).toBe(2);
    expect(counts[15]).toBe(2);
    expect(counts[16]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('percentiles interpolate between the closest durations', async () => {
    const [edge] = await subject().getOperationStats({ ...window, service: 'lat' });
    expect([edge.count, edge.p50Ms]).toEqual([5, 59999]);
    expect(edge.p95Ms).toBeCloseTo(108000, 6);
  });
});

describe('clickhouse session specifics', () => {
  const project = '00000000-0000-4000-8000-00000000c307';
  const minute = (n: number) => new Date(SPECIFICS_FROM.getTime() + n * 60_000);
  const subject = useSpecifics(project, [
    { message: 's3 only', time: minute(1), sessionId: 's3' },
    { message: 's1 start', time: minute(2), sessionId: 's1' },
    { message: 's1 error', time: minute(3), sessionId: 's1', level: 'error' },
    { message: 's2 critical', time: minute(4), sessionId: 's2', level: 'critical', service: 'web' },
    { message: 's1 end', time: minute(5), sessionId: 's1' },
    { message: 's2 end', time: minute(5), sessionId: 's2' },
    { message: 'empty session', time: minute(6), sessionId: '' },
    { message: 'no session', time: minute(7) },
  ]);
  const window = { projectId: project, from: SPECIFICS_FROM, to: SPECIFICS_TO };
  const summary = (s: { sessionId: string; service: string; firstEvent: Date; lastEvent: Date; eventCount: number; errorCount: number }) =>
    [s.sessionId, s.service, s.firstEvent.toISOString(), s.lastEvent.toISOString(), s.eventCount, s.errorCount];

  it('pages sessions by last event, ties by session id, with a cursor', async () => {
    const first = await subject().listSessions({ ...window, limit: 2 });
    expect(first.sessions.map(summary)).toEqual([
      ['s1', 'api', minute(2).toISOString(), minute(5).toISOString(), 3, 1],
      ['s2', 'api', minute(4).toISOString(), minute(5).toISOString(), 2, 1],
    ]);
    expect(typeof first.nextCursor).toBe('string');
    const second = await subject().listSessions({ ...window, limit: 2, cursor: first.nextCursor });
    expect(second.sessions.map(summary)).toEqual([['s3', 'api', minute(1).toISOString(), minute(1).toISOString(), 1, 0]]);
    expect(second.nextCursor).toBeUndefined();
  });

  it('the service filter keeps only that service events', async () => {
    const result = await subject().listSessions({ ...window, limit: 10, service: 'web' });
    expect(result.sessions.map(summary)).toEqual([['s2', 'web', minute(4).toISOString(), minute(4).toISOString(), 1, 1]]);
  });

  it('presence ignores empty session ids', async () => {
    expect(await subject().hasSessions(window)).toBe(true);
    expect(await subject().hasSessions({ projectId: project, from: minute(6), to: minute(7) })).toBe(false);
  });
});
