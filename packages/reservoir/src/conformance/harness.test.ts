import { describe, it, expect, vi } from 'vitest';
import {
  CORPUS_LOGS,
  CORPUS_SPANS,
  CORPUS_TRACES,
  PROJECT_A,
  PROJECT_B,
  PROJECT_C,
  PROJECT_D,
  WIDE_METADATA_KEY_COUNT,
  WINDOW,
  minutes,
  logsExcept,
  PROJECT_A_WINDOW_LOG_IDS,
  T1,
  ReferenceEngine,
  ConformanceUnavailableError,
  describeReservoirConformance,
  logCaseMismatch,
  logCaseParams,
  logIdsOf,
  spanIdsOf,
  traceIdsOf,
  TEXT_QUERY_CASES,
  FILTER_CASES,
  FIELD_CLAUSE_CASES,
} from './index.js';

describe('corpus', () => {
  it('has the binding sizes and unique composite keys', () => {
    expect(CORPUS_LOGS).toHaveLength(40);
    expect(CORPUS_SPANS).toHaveLength(131);
    expect(CORPUS_TRACES).toHaveLength(16);
    const logKeys = new Set(CORPUS_LOGS.map((l) => `${l.record.projectId}|${l.record.time.toISOString()}|${l.record.message}`));
    expect(logKeys.size).toBe(40);
    expect(new Set(CORPUS_SPANS.map((s) => `${s.record.projectId}|${s.record.traceId}|${s.record.spanId}`)).size).toBe(131);
    expect(new Set(CORPUS_TRACES.map((t) => `${t.record.projectId}|${t.record.traceId}`)).size).toBe(16);
  });

  it('places project A logs L01 to L25 inside the window, L91 a day before', () => {
    const inWindow = CORPUS_LOGS.filter((l) => l.record.projectId === PROJECT_A && l.record.time >= WINDOW.from && l.record.time <= WINDOW.to);
    expect(inWindow.map((l) => l.id)).toEqual([...PROJECT_A_WINDOW_LOG_IDS]);
    expect(CORPUS_LOGS.find((l) => l.id === 'L91')?.record.time).toEqual(minutes(-1440));
    expect(CORPUS_LOGS.filter((l) => l.record.projectId === PROJECT_B).map((l) => l.id)).toEqual(['L90', 'L92']);
    expect(CORPUS_LOGS.filter((l) => l.record.projectId === PROJECT_C).map((l) => l.id)).toEqual(['L93', 'L94']);
    expect(CORPUS_LOGS.filter((l) => l.record.projectId === PROJECT_D).map((l) => l.id)).toEqual(['L40', 'L41', 'L42', 'L43', 'L44', 'L45', 'L46', 'L47', 'L48', 'L49']);
    expect(Object.keys(CORPUS_LOGS.find((l) => l.id === 'L94')!.record.metadata ?? {})).toHaveLength(WIDE_METADATA_KEY_COUNT);
  });

  it('stores the hostname only in metadata', () => {
    for (const { id, record } of CORPUS_LOGS) {
      expect(record.hostname, id).toBeUndefined();
    }
    expect(CORPUS_LOGS.find((l) => l.id === 'L05')?.record.metadata).toEqual({ env: 'staging', tags: ['a', 'b'] });
    expect(CORPUS_LOGS.find((l) => l.id === 'L25')?.record).toMatchObject({ metadata: { hostname: 'web-4' }, sessionId: '' });
  });

  it('builds spans and traces from the tables', () => {
    const span = (id: string) => CORPUS_SPANS.find((s) => s.id === id)!.record;
    expect(span('GET-34').traceId).toBe(span('PAGE-1').traceId);
    expect(span('GET-35').traceId).toBe(span('PAGE-2').traceId);
    expect(span('GET-68').parentSpanId).toBe(span('PAGE-3').spanId);
    expect(span('GET-95').statusCode).toBe('OK');
    expect(span('POST-9')).toMatchObject({ statusCode: 'ERROR', durationMs: 900, attributes: { 'http.method': 'POST', 'http.status_code': 500 } });
    expect(span('SELECT-3').startTime.getTime() - span('POST-3').startTime.getTime()).toBe(1000);
    expect(span('PAGE-1').kind).toBeUndefined();
    for (const { record } of CORPUS_SPANS) {
      expect(record.time).toEqual(record.startTime);
      expect(record.endTime.getTime() - record.startTime.getTime()).toBe(record.durationMs);
    }
    const trace = (id: string) => CORPUS_TRACES.find((t) => t.id === id)!.record;
    expect(trace('TF2')).toMatchObject({ spanCount: 34, durationMs: 668_067, error: false, rootOperationName: 'page load' });
    expect(trace('TO10')).toMatchObject({ spanCount: 2, durationMs: 1050, error: true, serviceName: 'api' });
    for (const id of ['TF1', 'TF2', 'TF3']) {
      const spans = CORPUS_SPANS.filter((s) => s.record.traceId === trace(id).traceId);
      expect(spans, id).toHaveLength(trace(id).spanCount);
    }
  });

  it('summarizes every trace from its spans like the ingest path', () => {
    for (const { id, record } of CORPUS_TRACES) {
      const spans = CORPUS_SPANS.map((s) => s.record).filter((s) => s.projectId === record.projectId && s.traceId === record.traceId);
      expect(spans.length, id).toBe(record.spanCount);
      expect(record.startTime.getTime(), id).toBe(Math.min(...spans.map((s) => s.startTime.getTime())));
      expect(record.endTime.getTime(), id).toBe(Math.max(...spans.map((s) => s.endTime.getTime())));
      expect(record.durationMs, id).toBe(record.endTime.getTime() - record.startTime.getTime());
      expect(record.error, id).toBe(spans.some((s) => s.statusCode === 'ERROR'));
    }
  });

  it('logsExcept removes ids from the 25 window logs', () => {
    expect(logsExcept('L01', 'L25')).toHaveLength(23);
    expect(logsExcept()).toEqual([...PROJECT_A_WINDOW_LOG_IDS]);
  });
});

describe('id mapping', () => {
  it('maps returned rows back to fixture ids and flags unknown rows', () => {
    const l02 = CORPUS_LOGS.find((l) => l.id === 'L02')!.record;
    expect(logIdsOf([{ projectId: l02.projectId, time: new Date(l02.time.getTime()), message: l02.message }])).toEqual(['L02']);
    expect(logIdsOf([{ projectId: PROJECT_B, time: l02.time, message: l02.message }])).toEqual(['UNKNOWN:Connection refused by upstream db']);
    const s = CORPUS_SPANS[0].record;
    expect(spanIdsOf([s, { ...s, spanId: 'ffff', operationName: 'zzz' }])).toEqual(['PAGE-1', 'UNKNOWN:zzz']);
    expect(traceIdsOf([CORPUS_TRACES[0].record, { projectId: PROJECT_B, traceId: CORPUS_TRACES[0].record.traceId }])).toEqual(['TF1', `UNKNOWN:${CORPUS_TRACES[0].record.traceId}`]);
  });
});

describe('logCaseMismatch', () => {
  const kase = { expected: ['L02'], timescaleMayAlsoMatch: ['L04', 'L06'] };
  it('is exact for every engine but timescale', () => {
    expect(logCaseMismatch('clickhouse', kase, ['L02'])).toEqual({ unexpected: [], missing: [], duplicated: [] });
    expect(logCaseMismatch('mongodb', kase, ['L02', 'L04'])).toEqual({ unexpected: ['L04'], missing: [], duplicated: [] });
    expect(logCaseMismatch('reference', kase, [])).toEqual({ unexpected: [], missing: ['L02'], duplicated: [] });
  });
  it('lets timescale return the allowed extras only', () => {
    expect(logCaseMismatch('timescale', kase, ['L06', 'L02', 'L04'])).toEqual({ unexpected: [], missing: [], duplicated: [] });
    expect(logCaseMismatch('timescale', kase, ['L02', 'L07'])).toEqual({ unexpected: ['L07'], missing: [], duplicated: [] });
    expect(logCaseMismatch('timescale', kase, ['L04'])).toEqual({ unexpected: [], missing: ['L02'], duplicated: [] });
  });
  it('reports duplicates', () => {
    expect(logCaseMismatch('clickhouse', kase, ['L02', 'L02'])).toEqual({ unexpected: [], missing: [], duplicated: ['L02'] });
  });
});

describe('logCaseParams', () => {
  it('defaults to project A and the window', () => {
    expect(logCaseParams({})).toEqual({ projectId: PROJECT_A, from: WINDOW.from, to: WINDOW.to });
  });
  it('takes project lists, windows and params', () => {
    const window = { from: minutes(10), to: minutes(20), fromExclusive: true, toExclusive: true };
    expect(logCaseParams({ projectIds: [PROJECT_A, PROJECT_B], window, params: { service: 'api' } })).toEqual({
      projectId: [PROJECT_A, PROJECT_B], ...window, service: 'api',
    });
  });
  it('compiles q and narrows the params with it', () => {
    expect(logCaseParams({ q: `trace:${T1}`, params: { traceId: 'other' } })).toEqual({ projectId: PROJECT_A, from: WINDOW.from, to: WINDOW.to, matchNothing: true });
    expect(logCaseParams({ q: 'timeout', params: { search: 'redis' } })).toMatchObject({
      textQuery: { all: [{ kind: 'word', value: 'redis' }, { kind: 'word', value: 'timeout' }], anyOf: [], none: [] },
    });
  });
  it('rejects a case whose q does not parse', () => {
    expect(() => logCaseParams({ q: '"open' })).toThrow('does not parse');
  });
  it('every case id is unique and every q parses', () => {
    const cases = [...TEXT_QUERY_CASES, ...FILTER_CASES, ...FIELD_CLAUSE_CASES];
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) expect(() => logCaseParams(c), c.id).not.toThrow();
  });
});

describe('reference engine contract checks', () => {
  const P = { projectId: PROJECT_A, from: WINDOW.from, to: WINDOW.to };
  it('refuses params the client must never send', async () => {
    const engine = new ReferenceEngine();
    await expect(engine.query({ ...P, matchNothing: true })).rejects.toThrow('matchNothing');
    await expect(engine.count({ ...P, matchNothing: false })).rejects.toThrow('matchNothing');
    await expect(engine.querySpans({ ...P, operation: 'x' })).rejects.toThrow('operation');
    await expect(engine.query({ ...P, filters: [{ field: 'x', operator: '=', value: 1 }] })).rejects.toThrow('filters');
  });
  it('reads only textQuery, never the legacy search', async () => {
    const engine = new ReferenceEngine();
    await engine.ingest(CORPUS_LOGS.map((l) => structuredClone(l.record)));
    expect((await engine.count({ ...P, search: 'timeout' })).count).toBe(25);
  });
});

describe('an unreachable engine', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Registers the full suite; every case must be skipped, none may fail.
  describeReservoirConformance('clickhouse', {
    create: () => Promise.reject(new ConformanceUnavailableError('down for this test')),
    required: false,
  });
});
