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
import type { LogRecord, QueryParams, TextQuery } from '../../core/types.js';
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

/**
 * A describe over its own schema and logs. An unreachable server skips the
 * block, or fails it with RESERVOIR_CONFORMANCE_REQUIRED=1.
 */
function describeTimescaleSpecifics(
  name: string,
  schema: string,
  logs: LogRecord[],
  body: (subject: () => Reservoir) => void,
): void {
  describe(name, () => {
    let reservoir: Reservoir | null = null;

    beforeAll(async () => {
      reservoir = await resolveSubject('timescale', () => createTimescaleSpecificsReservoir(schema), isConformanceRequired());
      if (!reservoir) return;
      const result = await reservoir.ingest(logs);
      if (result.failed > 0) throw new Error(`Seeding ${name} failed: ${JSON.stringify(result.errors ?? [])}`);
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
