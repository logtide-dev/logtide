// ============================================================================
// Reservoir conformance suite (spec 6.4)
// ============================================================================
// Not exported from the package entry (`src/index.ts`): this module imports
// vitest. Engines import it from their own test files.
//
// Running the suite (F3 plan "Running the conformance suite"):
// 1. Containers: `docker compose -f docker-compose.test.yml up -d postgres-test`
//    (TimescaleDB on 5433) and `docker compose -f packages/reservoir/docker-compose.test.yml up -d`
//    (ClickHouse 18123, MongoDB 27017).
// 2. Env, defaults in brackets:
//    RESERVOIR_TIMESCALE_URL [postgresql://logtide_test:test_password@localhost:5433/logtide_test;
//      schema reservoir_conformance, dropped and recreated per run],
//    RESERVOIR_CLICKHOUSE_URL [http://default:@localhost:18123/logtide_conformance],
//    RESERVOIR_MONGODB_URL [mongodb://localhost:27017/logtide_conformance].
//    ClickHouse and MongoDB databases are dropped and recreated per run and must
//    match CONFORMANCE_NAMESPACE_PATTERN, so shared test databases are refused.
//    RESERVOIR_CONFORMANCE_REQUIRED=1 turns "unreachable, skipped" into a failure.
// 3. Each engine adds one file in its folder, e.g.
//    `packages/reservoir/src/engines/clickhouse/clickhouse-conformance.test.ts`:
//      import { describeReservoirConformance } from '../../conformance/index.js';
//      describeReservoirConformance('clickhouse');
//    (optionally `{ create }` for a custom bootstrap).
// 4. From packages/reservoir, e.g.
//    RESERVOIR_CONFORMANCE_REQUIRED=1 RESERVOIR_CLICKHOUSE_URL=http://default:@localhost:18123/ux16_rch \
//      npx vitest run src/engines/clickhouse/clickhouse-conformance.test.ts
//    Master plan databases: ux16_rts (Timescale, RESERVOIR_TIMESCALE_URL
//    database), ux16_rch (ClickHouse), ux16_rmg (MongoDB).
// 5. Ad hoc or Wave D runs without engine files:
//    RESERVOIR_CONFORMANCE_ENGINES=timescale,clickhouse,mongodb RESERVOIR_CONFORMANCE_REQUIRED=1 \
//      npx vitest run src/conformance/live.test.ts
//    (any subset; an unknown name fails at collection; unset, the file skips).
//    Add `-t baseline` (or another describe name) to run one capability.
// 6. The in-memory reference engine runs the whole suite in CI without
//    databases: `npx vitest run src/conformance/conformance.test.ts`.
//
// Capabilities (one describe each, in this order): baseline, text query,
// direct filters, field clauses, histogram, facets, metadata keys, operation
// stats, latency histogram, span and trace queries, sessions.
//
// Ownership: F3 owns the suite and the corpus. Engine workstreams may add
// cases and fix harness code, never weaken, delete or loosen an expectation
// (including widening `timescaleMayAlsoMatch` or a tolerance); a failing
// expectation is fixed in the engine, and any relaxation needs orchestrator
// approval.

export * from './corpus.js';
export * from './targets.js';
export * from './harness.js';
export { ReferenceEngine, createReferenceReservoir } from './reference-engine.js';
export { describeBaselineConformance } from './suites/baseline.js';
export { describeTextQueryConformance, TEXT_QUERY_CASES } from './suites/text-query.js';
export { describeFilterConformance, FILTER_CASES } from './suites/filters.js';
export { describeFieldClauseConformance, FIELD_CLAUSE_CASES } from './suites/field-clauses.js';
export { describeHistogramConformance } from './suites/histogram.js';
export { describeFacetsConformance } from './suites/facets.js';
export { describeMetadataKeysConformance } from './suites/metadata-keys.js';
export { describeOperationStatsConformance } from './suites/operation-stats.js';
export { describeLatencyHistogramConformance } from './suites/latency-histogram.js';
export { describeSpanTraceQueryConformance } from './suites/spans-traces.js';
export { describeSessionsConformance } from './suites/sessions.js';
