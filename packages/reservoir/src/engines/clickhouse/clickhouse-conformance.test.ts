// ClickHouse against the reservoir conformance suite (spec 6.4) plus
// engine-specific integration cases. Real server, no mocks.
//
// Run from packages/reservoir:
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/clickhouse/clickhouse-conformance.test.ts
// The suite database (default ux16_rch) and the specifics database (the same
// name plus `_specifics`) are dropped and recreated per run, so they must match
// CONFORMANCE_NAMESPACE_PATTERN; shared test databases are refused.

import {
  describeReservoirConformance,
  createConformanceReservoir,
  isConformanceRequired,
  resolveSubject,
} from '../../conformance/index.js';
import type { Reservoir } from '../../client.js';

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

/** Like createClickHouseSubject, or null (skip) when the server is unreachable and conformance is not required. */
export function resolveClickHouseSubject(database: string): Promise<Reservoir | null> {
  return resolveSubject('clickhouse', () => createClickHouseSubject(database), isConformanceRequired());
}

export const CH_SPECIFICS_DATABASE = `${CH_TEST_CONFIG.database}_specifics`;

describeReservoirConformance('clickhouse', {
  create: () => createClickHouseSubject(CH_TEST_CONFIG.database),
});
