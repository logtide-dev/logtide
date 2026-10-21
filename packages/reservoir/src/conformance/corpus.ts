// ============================================================================
// Conformance corpus (binding data, F3 plan "Conformance corpus")
// ============================================================================
// Every engine is seeded with exactly these records and must return the same
// answers for every case of the suite. Results map back to fixture ids by
// composite keys (see harness.ts), never by engine-generated ids.
//
// Changing a record here changes the expectations of every engine: only F3
// (or the orchestrator) may do it. R-* may add records for new cases.

import type { LogLevel, LogRecord, SpanKind, SpanRecord, SpanStatusCode, TraceRecord } from '../core/types.js';

export const CONFORMANCE_BASE = new Date('2026-01-05T10:00:00.000Z');
export const PROJECT_A = '00000000-0000-4000-8000-0000000000a1';
export const PROJECT_B = '00000000-0000-4000-8000-0000000000b1';
export const ORG_ID = '00000000-0000-4000-8000-0000000000f1';

const BASE_MS = CONFORMANCE_BASE.getTime();

/** BASE plus `n` minutes (a new Date each call). */
export function minutes(n: number): Date {
  return new Date(BASE_MS + n * 60_000);
}

/** BASE plus `n` seconds (a new Date each call). */
export function seconds(n: number): Date {
  return new Date(BASE_MS + n * 1000);
}

/** The default window `[BASE, BASE + 2 h]`, inclusive. */
export const WINDOW: { readonly from: Date; readonly to: Date } = Object.freeze({ from: minutes(0), to: minutes(120) });

export const traceHex = (n: number): string => n.toString(16).padStart(32, '0');
export const spanHex = (n: number): string => n.toString(16).padStart(16, '0');

const session = (n: number): string => `00000000-0000-4000-8000-00000000c00${n}`;

export const SESSION_IDS = Object.freeze({
  SESS1: session(1),
  SESS2: session(2),
  SESS3: session(3),
  SESS4: session(4),
  SESS8: session(8),
  SESS9: session(9),
});

export const T1 = traceHex(0x701);
export const S1 = spanHex(0x7001);
export const S2 = spanHex(0x7002);

// ----------------------------------------------------------------------------
// Logs
// ----------------------------------------------------------------------------

interface LogRow {
  id: string;
  project: string;
  t: number;
  service: string;
  level: LogLevel;
  /** `undefined` when the table says "-" (no hostname key at all). */
  host?: string;
  message: string;
  /** Metadata other than the hostname; `undefined` means no metadata keys besides the hostname. */
  meta?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  sessionId?: string;
}

const prod = { env: 'prod' };

const LOG_ROWS: LogRow[] = [
  { id: 'L01', project: PROJECT_A, t: 1, service: 'api', level: 'info', host: 'web-1', message: 'User login succeeded for alice', meta: { env: 'prod', user: { id: '42', name: 'alice' }, status: 200 } },
  { id: 'L02', project: PROJECT_A, t: 2, service: 'api', level: 'error', host: 'web-1', message: 'Connection refused by upstream db', meta: { env: 'prod', 'http.method': 'GET', status: 500 } },
  { id: 'L03', project: PROJECT_A, t: 3, service: 'api', level: 'warn', host: 'web-2', message: 'Request timeout after 30s', meta: { env: 'prod', http: { method: 'POST' }, status: 504 } },
  { id: 'L04', project: PROJECT_A, t: 4, service: 'worker', level: 'error', host: 'web-2', message: 'Timeout while connecting to redis', meta: { env: 'staging', retries: 3 } },
  { id: 'L05', project: PROJECT_A, t: 5, service: 'worker', level: 'info', message: 'Job finished: 12 items processed', meta: { env: 'staging', tags: ['a', 'b'] } },
  { id: 'L06', project: PROJECT_A, t: 6, service: 'api', level: 'debug', host: 'web-1', message: 'connections pool size is 10', meta: prod },
  { id: 'L07', project: PROJECT_A, t: 7, service: 'api', level: 'critical', host: 'web-3', message: 'Disk full on /var/lib/data', meta: { env: 'prod', disk: { path: '/var/lib/data' } }, sessionId: SESSION_IDS.SESS3 },
  { id: 'L08', project: PROJECT_A, t: 8, service: 'auth', level: 'error', host: 'web-3', message: 'Ошибка подключения к базе', meta: { env: 'prod', region: 'eu' }, sessionId: SESSION_IDS.SESS2 },
  { id: 'L09', project: PROJECT_A, t: 9, service: 'auth', level: 'warn', host: 'web-3', message: 'Paiement échoué pour la commande 77', meta: { env: 'prod', region: 'eu' }, sessionId: SESSION_IDS.SESS2 },
  { id: 'L10', project: PROJECT_A, t: 10, service: 'auth', level: 'info', host: 'web-3', message: '東京リージョンで障害', meta: { env: 'prod', region: 'ap' } },
  { id: 'L11', project: PROJECT_A, t: 11, service: 'auth', level: 'warn', host: 'web-1', message: 'user_id 99 not found', meta: prod },
  { id: 'L12', project: PROJECT_A, t: 12, service: 'api', level: 'info', host: 'web-1', message: 'GET /api/v1/users 200 in 12ms', meta: { env: 'prod', status: 200 }, sessionId: SESSION_IDS.SESS2 },
  { id: 'L13', project: PROJECT_A, t: 13, service: 'api', level: 'info', host: 'web-2', message: 'request from 10.0.0.1 accepted', meta: prod },
  { id: 'L14', project: PROJECT_A, t: 14, service: 'billing', level: 'error', host: 'web-2', message: 'Payment failed: card declined', meta: { env: 'prod', reason: 'card_declined', amount: 1999, ok: false, note: null } },
  { id: 'L15', project: PROJECT_A, t: 15, service: 'billing', level: 'info', host: 'web-2', message: 'payment succeeded', meta: { env: 'prod', amount: 1999, ok: true } },
  { id: 'L16', project: PROJECT_A, t: 16, service: 'api', level: 'error', host: 'web-1', message: 'Unhandled exception in handler', meta: prod, traceId: T1, spanId: S1, sessionId: SESSION_IDS.SESS1 },
  { id: 'L17', project: PROJECT_A, t: 17, service: 'api', level: 'info', host: 'web-1', message: 'handler started', meta: prod, traceId: T1, spanId: S2, sessionId: SESSION_IDS.SESS1 },
  { id: 'L18', project: PROJECT_A, t: 18, service: 'api', level: 'info', host: 'web-1', message: 'The quick brown fox', meta: prod },
  { id: 'L19', project: PROJECT_A, t: 19, service: 'api', level: 'warn', host: 'web-2', message: 'TIMEOUT EXCEEDED', meta: prod },
  { id: 'L20', project: PROJECT_A, t: 20, service: 'api', level: 'error', host: 'web-2', message: 'proxy to api.example.com failed', meta: prod },
  { id: 'L21', project: PROJECT_A, t: 21, service: 'api', level: 'info', host: 'web-2', message: 'error-prone retry logic', meta: prod, sessionId: SESSION_IDS.SESS4 },
  { id: 'L22', project: PROJECT_A, t: 22, service: 'api', level: 'error', host: 'web-1', message: 'ОШИБКА повторилась', meta: prod },
  { id: 'L23', project: PROJECT_A, t: 23, service: 'search', level: 'info', host: 'web-1', message: 'Literal key wins', meta: { env: 'prod', 'geo.city': 'literal', geo: { city: 'nested' } } },
  { id: 'L24', project: PROJECT_A, t: 24, service: 'search', level: 'info', host: 'web-1', message: 'Nested only', meta: { env: 'prod', geo: { city: 'Las Vegas', coords: { lat: 36 } } }, sessionId: SESSION_IDS.SESS4 },
  { id: 'L25', project: PROJECT_A, t: 25, service: 'cron', level: 'info', host: 'web-4', message: 'cleanup done', sessionId: '' },
  { id: 'L90', project: PROJECT_B, t: 5, service: 'api', level: 'error', host: 'web-1', message: 'Connection refused by upstream db', meta: prod, sessionId: SESSION_IDS.SESS9 },
  { id: 'L92', project: PROJECT_B, t: 5, service: 'api', level: 'info', host: 'web-1', message: 'session ping', meta: prod, sessionId: SESSION_IDS.SESS8 },
  { id: 'L91', project: PROJECT_A, t: -1440, service: 'api', level: 'error', host: 'web-1', message: 'Connection refused by upstream db', meta: prod, sessionId: SESSION_IDS.SESS1 },
];

function logRecord(row: LogRow): LogRecord {
  const metadata: Record<string, unknown> = {};
  if (row.host !== undefined) metadata.hostname = row.host;
  Object.assign(metadata, structuredClone(row.meta ?? {}));
  const record: LogRecord = {
    time: minutes(row.t),
    projectId: row.project,
    service: row.service,
    level: row.level,
    message: row.message,
    metadata,
  };
  if (row.traceId !== undefined) record.traceId = row.traceId;
  if (row.spanId !== undefined) record.spanId = row.spanId;
  if (row.sessionId !== undefined) record.sessionId = row.sessionId;
  return record;
}

export const CORPUS_LOGS: readonly { readonly id: string; readonly record: LogRecord }[] = Object.freeze(
  LOG_ROWS.map((row) => Object.freeze({ id: row.id, record: logRecord(row) })),
);

/** Ids of the project A logs inside WINDOW: L01 to L25. */
export const PROJECT_A_WINDOW_LOG_IDS: readonly string[] = Object.freeze(
  Array.from({ length: 25 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`),
);

/** Every project A in-window log id except `ids`. */
export function logsExcept(...ids: string[]): string[] {
  const drop = new Set(ids);
  return PROJECT_A_WINDOW_LOG_IDS.filter((id) => !drop.has(id));
}

// ----------------------------------------------------------------------------
// Spans and traces
// ----------------------------------------------------------------------------

interface SpanRow {
  id: string;
  project: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  service: string;
  kind?: SpanKind;
  operation: string;
  durationMs: number;
  status: SpanStatusCode;
  attributes: Record<string, unknown>;
  start: Date;
}

const PAGE_TRACES = [traceHex(0x101), traceHex(0x102), traceHex(0x103)];
const PAGE_SPANS = [spanHex(0x2001), spanHex(0x2002), spanHex(0x2003)];
const PAGE_DURATIONS = [550, 1500, 70000];
const postTrace = (k: number) => traceHex(0x200 + k);
const TW1 = traceHex(0x301);
const TB1 = traceHex(0x401);
const TX1 = traceHex(0x501);
const pad2 = (n: number) => String(n).padStart(2, '0');

function buildSpanRows(): SpanRow[] {
  const rows: SpanRow[] = [];
  for (let n = 0; n < 3; n++) {
    rows.push({
      id: `PAGE-${n + 1}`, project: PROJECT_A, traceId: PAGE_TRACES[n], spanId: PAGE_SPANS[n], service: 'frontend',
      operation: 'page load', durationMs: PAGE_DURATIONS[n], status: 'UNSET', attributes: {}, start: seconds(n + 1),
    });
  }
  rows.push({
    id: 'RENDER', project: PROJECT_A, traceId: PAGE_TRACES[2], spanId: spanHex(0x2101), parentSpanId: PAGE_SPANS[2],
    service: 'frontend', operation: 'render', durationMs: 30, status: 'UNSET', attributes: {}, start: seconds(3.1),
  });
  for (let i = 1; i <= 100; i++) {
    const page = i <= 34 ? 0 : i <= 67 ? 1 : 2;
    rows.push({
      id: `GET-${i}`, project: PROJECT_A, traceId: PAGE_TRACES[page], spanId: spanHex(0x1000 + i), parentSpanId: PAGE_SPANS[page],
      service: 'api', kind: 'SERVER', operation: 'GET /users', durationMs: i, status: i >= 96 ? 'ERROR' : 'OK',
      attributes: { 'http.method': 'GET', 'http.status_code': i >= 96 ? 500 : 200 }, start: seconds(10 * i),
    });
  }
  for (let k = 1; k <= 10; k++) {
    const start = minutes(20 + k);
    rows.push({
      id: `POST-${k}`, project: PROJECT_A, traceId: postTrace(k), spanId: spanHex(0x3000 + k), service: 'api', kind: 'SERVER',
      operation: 'POST /orders', durationMs: 100 * k, status: k >= 9 ? 'ERROR' : 'OK',
      attributes: { 'http.method': 'POST', 'http.status_code': k >= 9 ? 500 : 201 }, start,
    });
    rows.push({
      id: `SELECT-${k}`, project: PROJECT_A, traceId: postTrace(k), spanId: spanHex(0x3100 + k), parentSpanId: spanHex(0x3000 + k),
      service: 'api', kind: 'CLIENT', operation: 'SELECT orders', durationMs: 5 * k, status: 'OK',
      attributes: { 'db.system': 'postgresql' }, start: new Date(start.getTime() + 1000),
    });
  }
  rows.push({
    id: 'LOOP', project: PROJECT_A, traceId: TW1, spanId: spanHex(0x4001), service: 'worker', kind: 'INTERNAL',
    operation: 'job loop', durationMs: 45, status: 'UNSET', attributes: {}, start: minutes(40),
  });
  for (let j = 1; j <= 4; j++) {
    rows.push({
      id: `JOB-${j}`, project: PROJECT_A, traceId: TW1, spanId: spanHex(0x4100 + j), parentSpanId: spanHex(0x4001),
      service: 'worker', kind: 'CONSUMER', operation: 'process job', durationMs: 10 * j, status: j === 4 ? 'ERROR' : 'OK',
      attributes: {}, start: new Date(minutes(40).getTime() + j * 1000),
    });
  }
  rows.push({
    id: 'B-SPAN', project: PROJECT_B, traceId: TB1, spanId: spanHex(0x5001), service: 'api', kind: 'SERVER',
    operation: 'GET /users', durationMs: 5000, status: 'OK', attributes: { 'http.method': 'GET', 'http.status_code': 200 }, start: minutes(1),
  });
  rows.push({
    id: 'X-SPAN', project: PROJECT_A, traceId: TX1, spanId: spanHex(0x6001), service: 'api', kind: 'SERVER',
    operation: 'GET /users', durationMs: 9999, status: 'OK', attributes: { 'http.method': 'GET', 'http.status_code': 200 }, start: minutes(-1440),
  });
  return rows;
}

function spanRecord(row: SpanRow): SpanRecord {
  const record: SpanRecord = {
    time: new Date(row.start.getTime()),
    spanId: row.spanId,
    traceId: row.traceId,
    organizationId: ORG_ID,
    projectId: row.project,
    serviceName: row.service,
    operationName: row.operation,
    startTime: new Date(row.start.getTime()),
    endTime: new Date(row.start.getTime() + row.durationMs),
    durationMs: row.durationMs,
    statusCode: row.status,
    attributes: structuredClone(row.attributes),
  };
  if (row.parentSpanId !== undefined) record.parentSpanId = row.parentSpanId;
  if (row.kind !== undefined) record.kind = row.kind;
  return record;
}

const SPAN_ROWS = buildSpanRows();

export const CORPUS_SPANS: readonly { readonly id: string; readonly record: SpanRecord }[] = Object.freeze(
  SPAN_ROWS.map((row) => Object.freeze({ id: row.id, record: spanRecord(row) })),
);

interface TraceRow {
  id: string;
  project: string;
  traceId: string;
  service: string;
  rootOperation: string;
  durationMs: number;
  spanCount: number;
  error: boolean;
  start: Date;
}

function buildTraceRows(): TraceRow[] {
  const rows: TraceRow[] = [];
  const pageCounts = [35, 34, 35];
  for (let n = 0; n < 3; n++) {
    rows.push({
      id: `TF${n + 1}`, project: PROJECT_A, traceId: PAGE_TRACES[n], service: 'frontend', rootOperation: 'page load',
      durationMs: PAGE_DURATIONS[n], spanCount: pageCounts[n], error: n === 2, start: seconds(n + 1),
    });
  }
  for (let k = 1; k <= 10; k++) {
    rows.push({
      id: `TO${pad2(k)}`, project: PROJECT_A, traceId: postTrace(k), service: 'api', rootOperation: 'POST /orders',
      durationMs: 100 * k, spanCount: 2, error: k >= 9, start: minutes(20 + k),
    });
  }
  rows.push({ id: 'TW1', project: PROJECT_A, traceId: TW1, service: 'worker', rootOperation: 'job loop', durationMs: 45, spanCount: 5, error: true, start: minutes(40) });
  rows.push({ id: 'TB1', project: PROJECT_B, traceId: TB1, service: 'api', rootOperation: 'GET /users', durationMs: 5000, spanCount: 1, error: false, start: minutes(1) });
  rows.push({ id: 'TX1', project: PROJECT_A, traceId: TX1, service: 'api', rootOperation: 'GET /users', durationMs: 9999, spanCount: 1, error: false, start: minutes(-1440) });
  return rows;
}

function traceRecord(row: TraceRow): TraceRecord {
  return {
    traceId: row.traceId,
    organizationId: ORG_ID,
    projectId: row.project,
    serviceName: row.service,
    rootServiceName: row.service,
    rootOperationName: row.rootOperation,
    startTime: new Date(row.start.getTime()),
    endTime: new Date(row.start.getTime() + row.durationMs),
    durationMs: row.durationMs,
    spanCount: row.spanCount,
    error: row.error,
  };
}

export const CORPUS_TRACES: readonly { readonly id: string; readonly record: TraceRecord }[] = Object.freeze(
  buildTraceRows().map((row) => Object.freeze({ id: row.id, record: traceRecord(row) })),
);

/** A corpus span record by its fixture id, e.g. `corpusSpan('PAGE-3').spanId`. */
export function corpusSpan(id: string): SpanRecord {
  const found = CORPUS_SPANS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown corpus span ${id}`);
  return found.record;
}

/** A corpus log record by its fixture id. */
export function corpusLog(id: string): LogRecord {
  const found = CORPUS_LOGS.find((l) => l.id === id);
  if (!found) throw new Error(`Unknown corpus log ${id}`);
  return found.record;
}
