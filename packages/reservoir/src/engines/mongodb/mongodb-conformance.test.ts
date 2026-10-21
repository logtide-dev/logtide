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
import type { LogRecord, QueryParams, StorageConfig, TextQuery } from '../../core/types.js';

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
});
