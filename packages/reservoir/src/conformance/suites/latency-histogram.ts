// Latency histogram conformance (plan D6, orchestrator ruling): the same
// entry spans as getOperationStats (default kinds with the root fallback,
// decided for the project and service scope), then filtered by operation;
// fixed bounds, upper-inclusive buckets, one overflow bucket.

import { describe, expect, it } from 'vitest';
import { LATENCY_HISTOGRAM_BOUNDS_MS } from '../../core/constants.js';
import type { LatencyHistogramParams } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { PROJECT_A, PROJECT_B, WINDOW } from '../corpus.js';

const ZEROS = Array.from({ length: 17 }, () => 0);

export function describeLatencyHistogramConformance(ctx: ConformanceContext): void {
  describe('latency histogram', () => {
    const histogram = (params: Partial<LatencyHistogramParams>) =>
      ctx.subject().getLatencyHistogram({ projectId: PROJECT_A, ...WINDOW, ...params });

    it('LH01 one operation, bounds are upper-inclusive', async () => {
      const result = await histogram({ service: 'api', operation: 'POST /orders' });
      expect(result.bounds).toEqual([...LATENCY_HISTOGRAM_BOUNDS_MS]);
      expect(result.counts).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 3, 5, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('LH02 a service counts its entry spans only', async () => {
      const result = await histogram({ service: 'api' });
      expect(result.counts).toEqual([1, 1, 3, 5, 10, 30, 51, 1, 3, 5, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('LH03 a service without entry spans falls back to its roots, overflow included', async () => {
      const result = await histogram({ service: 'frontend' });
      expect(result.counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1]);
    });

    it('LH04 consumer spans are entry spans, internal ones are not', async () => {
      const result = await histogram({ service: 'worker' });
      expect(result.counts).toEqual([0, 0, 0, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('LH05 the root fallback is decided before the operation filter', async () => {
      // worker has CONSUMER spans, so its INTERNAL root "job loop" is never an entry span.
      const result = await histogram({ service: 'worker', operation: 'job loop' });
      expect(result.counts).toEqual(ZEROS);
    });

    it('LH06 another project only sees its own spans', async () => {
      const result = await histogram({ projectId: PROJECT_B });
      expect(result.counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    });
  });
}
