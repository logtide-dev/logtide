// ============================================================================
// Conformance harness: one parametrized suite per capability
// ============================================================================
// `describeReservoirConformance(engine)` resolves a subject (a Reservoir over
// the engine, or a custom `create`), seeds the corpus once, and registers
// every capability describer. An unreachable engine skips every case unless
// conformance is required (RESERVOIR_CONFORMANCE_REQUIRED=1), in which case
// the suite fails loudly.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseLogQuery } from '@logtide/shared';
import type { IReservoir } from '../core/reservoir-interface.js';
import { compileLogSearch, mergeCompiledSearch } from '../core/log-search.js';
import type { CountParams, EngineType, LogRecord, QueryParams, SpanRecord, TraceRecord } from '../core/types.js';
import { CORPUS_LOGS, CORPUS_SPANS, CORPUS_TRACES, PROJECT_A, WINDOW } from './corpus.js';
import { createConformanceReservoir, isConformanceRequired, resolveSubject } from './targets.js';
import { describeBaselineConformance } from './suites/baseline.js';
import { describeTextQueryConformance } from './suites/text-query.js';
import { describeFilterConformance } from './suites/filters.js';
import { describeFieldClauseConformance } from './suites/field-clauses.js';

export type ConformanceEngine = EngineType | 'reference';

export type ConformanceSubject = Pick<
  IReservoir,
  | 'ingest'
  | 'query'
  | 'count'
  | 'histogram'
  | 'facets'
  | 'discoverMetadataKeys'
  | 'ingestSpans'
  | 'upsertTrace'
  | 'querySpans'
  | 'queryTraces'
  | 'getOperationStats'
  | 'getLatencyHistogram'
  | 'listSessions'
  | 'hasSessions'
  | 'close'
>;

export interface ConformanceContext {
  engine: ConformanceEngine;
  /** The seeded subject; only callable inside a test (skipped when unavailable). */
  subject(): ConformanceSubject;
}

export interface DescribeConformanceOptions {
  /** Custom bootstrap (e.g. a different schema or engine options); default `createConformanceReservoir(engine)`. */
  create?: () => Promise<ConformanceSubject>;
  /** Default `isConformanceRequired()`. */
  required?: boolean;
}

/** Ingests the whole corpus; throws with the engine errors when anything fails. */
export async function seedConformanceCorpus(subject: ConformanceSubject): Promise<void> {
  const logs = await subject.ingest(CORPUS_LOGS.map((l) => structuredClone(l.record)));
  if (logs.failed > 0 || logs.ingested !== CORPUS_LOGS.length) {
    throw new Error(`Seeding conformance logs failed (${logs.ingested} ingested, ${logs.failed} failed): ${JSON.stringify(logs.errors ?? [])}`);
  }
  const spans = await subject.ingestSpans(CORPUS_SPANS.map((s) => structuredClone(s.record)));
  if (spans.failed > 0 || spans.ingested !== CORPUS_SPANS.length) {
    throw new Error(`Seeding conformance spans failed (${spans.ingested} ingested, ${spans.failed} failed): ${JSON.stringify(spans.errors ?? [])}`);
  }
  for (const trace of CORPUS_TRACES) {
    await subject.upsertTrace(structuredClone(trace.record));
  }
}

const iso = (d: Date | string): string => new Date(d).toISOString();
const logKey = (projectId: string, time: Date | string, message: string) => `${projectId}|${iso(time)}|${message}`;
const spanKey = (projectId: string, traceId: string, spanId: string) => `${projectId}|${traceId}|${spanId}`;
const traceKey = (projectId: string, traceId: string) => `${projectId}|${traceId}`;

const LOG_IDS = new Map(CORPUS_LOGS.map((l) => [logKey(l.record.projectId, l.record.time, l.record.message), l.id]));
const SPAN_IDS = new Map(CORPUS_SPANS.map((s) => [spanKey(s.record.projectId, s.record.traceId, s.record.spanId), s.id]));
const TRACE_IDS = new Map(CORPUS_TRACES.map((t) => [traceKey(t.record.projectId, t.record.traceId), t.id]));

/** Fixture ids of returned logs, in result order; unknown rows become `UNKNOWN:<message>`. */
export function logIdsOf(logs: Pick<LogRecord, 'projectId' | 'time' | 'message'>[]): string[] {
  return logs.map((l) => LOG_IDS.get(logKey(l.projectId, l.time, l.message)) ?? `UNKNOWN:${l.message}`);
}

/** Fixture ids of returned spans, in result order; unknown rows become `UNKNOWN:<operation>`. */
export function spanIdsOf(spans: Pick<SpanRecord, 'projectId' | 'traceId' | 'spanId' | 'operationName'>[]): string[] {
  return spans.map((s) => SPAN_IDS.get(spanKey(s.projectId, s.traceId, s.spanId)) ?? `UNKNOWN:${s.operationName}`);
}

/** Fixture ids of returned traces, in result order; unknown rows become `UNKNOWN:<trace id>`. */
export function traceIdsOf(traces: Pick<TraceRecord, 'projectId' | 'traceId'>[]): string[] {
  return traces.map((t) => TRACE_IDS.get(traceKey(t.projectId, t.traceId)) ?? `UNKNOWN:${t.traceId}`);
}

export type LogCase = {
  id: string;
  title: string;
  /** Goes through the grammar: `mergeCompiledSearch(base, compileLogSearch(parseLogQuery(q)))`, the W3/W8 path. */
  q?: string;
  params?: Partial<QueryParams>;
  /** Default `[PROJECT_A]` (as `projectId: PROJECT_A`). */
  projectIds?: string[];
  /** Default WINDOW. */
  window?: { from: Date; to: Date; fromExclusive?: boolean; toExclusive?: boolean };
  expected: string[];
  /** Extra ids TimescaleDB may also return (English stemming, spec 5.3); never widen to make an engine pass. */
  timescaleMayAlsoMatch?: string[];
};

/** The params a log case runs with (exported for suites that reuse the case tables). */
export function logCaseParams(kase: Pick<LogCase, 'q' | 'params' | 'projectIds' | 'window'>): Partial<QueryParams> {
  const window: NonNullable<LogCase['window']> = kase.window ?? WINDOW;
  const base: Partial<QueryParams> = {
    projectId: kase.projectIds ?? PROJECT_A,
    from: window.from,
    to: window.to,
    ...(window.fromExclusive !== undefined ? { fromExclusive: window.fromExclusive } : {}),
    ...(window.toExclusive !== undefined ? { toExclusive: window.toExclusive } : {}),
    ...kase.params,
  };
  if (kase.q === undefined) return base;
  const parsed = parseLogQuery(kase.q);
  if (!parsed.ok) throw new Error(`Conformance query ${JSON.stringify(kase.q)} does not parse: ${parsed.error.message}`);
  return mergeCompiledSearch(base, compileLogSearch(parsed.query));
}

export interface LogCaseMismatch {
  /** Returned ids that are not expected (nor allowed by `timescaleMayAlsoMatch` on TimescaleDB). */
  unexpected: string[];
  /** Expected ids that were not returned. */
  missing: string[];
  /** Ids returned more than once. */
  duplicated: string[];
}

const NO_MISMATCH: LogCaseMismatch = { unexpected: [], missing: [], duplicated: [] };

/**
 * Compares returned fixture ids with a case. `timescaleMayAlsoMatch` is
 * honoured only for the `timescale` engine (spec 5.3 stemming); every other
 * engine must return exactly `expected`.
 */
export function logCaseMismatch(
  engine: ConformanceEngine,
  kase: Pick<LogCase, 'expected' | 'timescaleMayAlsoMatch'>,
  actualIds: string[],
): LogCaseMismatch {
  const allowed = new Set(kase.expected);
  if (engine === 'timescale') for (const id of kase.timescaleMayAlsoMatch ?? []) allowed.add(id);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const id of actualIds) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }
  return {
    unexpected: [...seen].filter((id) => !allowed.has(id)).sort(),
    missing: kase.expected.filter((id) => !seen.has(id)).sort(),
    duplicated: [...duplicated].sort(),
  };
}

/** One `it` per case: query ids (as a set) and count must agree with `expected`. */
export function runLogCases(ctx: ConformanceContext, cases: LogCase[]): void {
  for (const kase of cases) {
    it(`${kase.id} ${kase.title}`, async () => {
      const subject = ctx.subject();
      const params = logCaseParams(kase);
      const result = await subject.query({ ...params, limit: 1000, sortOrder: 'asc' } as QueryParams);
      expect(logCaseMismatch(ctx.engine, kase, logIdsOf(result.logs))).toEqual(NO_MISMATCH);
      const { count } = await subject.count(params as CountParams);
      expect(count, 'count equals the number of returned logs').toBe(result.logs.length);
    });
  }
}

/**
 * Registers the whole conformance suite for one engine. Each engine adds one
 * file, e.g. `engines/clickhouse/clickhouse-conformance.test.ts` with
 * `describeReservoirConformance('clickhouse')`.
 */
export function describeReservoirConformance(engine: ConformanceEngine, options: DescribeConformanceOptions = {}): void {
  describe(`reservoir conformance: ${engine}`, () => {
    let subject: ConformanceSubject | null = null;

    beforeAll(async () => {
      const required = options.required ?? isConformanceRequired();
      const create = options.create ?? (async (): Promise<ConformanceSubject> => {
        if (engine === 'reference') throw new Error('The reference engine needs options.create (createReferenceReservoir)');
        return createConformanceReservoir(engine);
      });
      subject = await resolveSubject(engine, create, required);
      if (subject) await seedConformanceCorpus(subject);
    }, 60_000);

    beforeEach(({ skip }) => {
      if (!subject) skip();
    });

    afterAll(async () => {
      if (subject) await subject.close();
    });

    const ctx: ConformanceContext = {
      engine,
      subject: () => {
        if (!subject) throw new Error(`Reservoir conformance subject for ${engine} is not available`);
        return subject;
      },
    };

    describeBaselineConformance(ctx);
    describeTextQueryConformance(ctx);
    describeFilterConformance(ctx);
    describeFieldClauseConformance(ctx);
  });
}
