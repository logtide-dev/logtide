// Live conformance runner for ad hoc and Wave D runs without engine test
// files: RESERVOIR_CONFORMANCE_ENGINES=timescale,clickhouse,mongodb (any
// subset) registers the full suite per listed engine. Combine it with
// RESERVOIR_CONFORMANCE_REQUIRED=1 so an unreachable engine fails instead of
// skipping. Without the variable the file only reports one skipped test.

import { it } from 'vitest';
import { describeReservoirConformance } from './harness.js';
import { parseConformanceEngines } from './targets.js';

const engines = parseConformanceEngines();

if (engines.length === 0) {
  it.skip('set RESERVOIR_CONFORMANCE_ENGINES to run live conformance', () => {});
} else {
  for (const engine of engines) describeReservoirConformance(engine);
}
