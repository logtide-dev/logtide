// ============================================================================
// TimescaleDB conformance harness (R-TS)
// ============================================================================
// Runs the F3 conformance suite against a real TimescaleDB, then the
// Timescale-specific integration cases. No pg mocks here.
//
// Database: ux16_rts on localhost:5433 by default; RESERVOIR_TIMESCALE_URL
// overrides it. The suite owns the schema `reservoir_conformance` (dropped
// and recreated per run by the F3 targets); the Timescale-specific cases own
// `reservoir_ts_specifics`, so their extra rows never touch the corpus.
//
//   cd packages/reservoir
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/timescale/timescale-conformance.test.ts
//
// Without RESERVOIR_CONFORMANCE_REQUIRED=1 an unreachable server skips.

import pg from 'pg';
import { Reservoir } from '../../client.js';
import {
  createConformanceReservoir,
  describeReservoirConformance,
  probeConformanceTarget,
  resolveConformanceTarget,
  type ConformanceTarget,
} from '../../conformance/index.js';
import { TimescaleEngine } from './timescale-engine.js';

export const TS_TEST_URL = 'postgresql://logtide_test:test_password@localhost:5433/ux16_rts';
export const TS_SPECIFICS_SCHEMA = 'reservoir_ts_specifics';

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
export async function createTimescaleSpecificsReservoir(schema = TS_SPECIFICS_SCHEMA): Promise<Reservoir> {
  const target = resolveConformanceTarget('timescale', timescaleTestEnv());
  await prepareDatabase(target);
  await withClient(target, (client) => client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
  const reservoir = Reservoir.fromEngine(new TimescaleEngine({ ...target.config, schema }));
  await reservoir.initialize();
  return reservoir;
}

describeReservoirConformance('timescale', { create: createTimescaleConformanceReservoir });
