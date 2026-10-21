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
// is dropped before the run and after it.

import { afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { createConformanceReservoir, describeReservoirConformance } from '../../conformance/index.js';
import type { StorageConfig } from '../../core/types.js';

const MG_TEST_CONFIG: StorageConfig = {
  host: 'localhost',
  port: 27017,
  database: process.env.RESERVOIR_MG_DATABASE ?? 'ux16_rmg',
  username: '',
  password: '',
};

const SERVER_URL = `mongodb://${MG_TEST_CONFIG.host}:${MG_TEST_CONFIG.port}/`;
const SUITE_DATABASE = MG_TEST_CONFIG.database;

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
  await dropDatabases(SUITE_DATABASE);
});
