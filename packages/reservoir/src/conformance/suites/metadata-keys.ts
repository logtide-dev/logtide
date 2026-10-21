// Metadata key discovery conformance (plan D6): the most recent `sampleSize`
// logs of the range, top-level keys plus one nested level of plain objects,
// one occurrence per log and key, occurrences desc then key byte order.

import { describe, expect, it } from 'vitest';
import type { MetadataKeyOccurrence } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { PROJECT_A, PROJECT_B, WINDOW } from '../corpus.js';

const compact = (keys: MetadataKeyOccurrence[]): string[] => keys.map((k) => `${k.key} ${k.occurrences}`);

export function describeMetadataKeysConformance(ctx: ConformanceContext): void {
  describe('metadata keys', () => {
    it('D01 every key of the window with its occurrences', async () => {
      const keys = await ctx.subject().discoverMetadataKeys({ projectId: PROJECT_A, ...WINDOW });
      expect(compact(keys)).toEqual([
        'env 24', 'hostname 24', 'status 4', 'region 3', 'amount 2', 'geo.city 2', 'http.method 2', 'ok 2',
        'disk.path 1', 'geo.coords 1', 'note 1', 'reason 1', 'retries 1', 'tags 1', 'user.id 1', 'user.name 1',
      ]);
    });

    it('D02 the sample is the most recent logs', async () => {
      const keys = await ctx.subject().discoverMetadataKeys({ projectId: PROJECT_A, ...WINDOW, sampleSize: 5 });
      expect(compact(keys)).toEqual(['hostname 5', 'env 4', 'geo.city 2', 'geo.coords 1']);
    });

    it('D03 another project only sees its own keys', async () => {
      const keys = await ctx.subject().discoverMetadataKeys({ projectId: PROJECT_B, ...WINDOW });
      expect(compact(keys)).toEqual(['env 2', 'hostname 2']);
    });

    it('D04 a project list covers every listed project', async () => {
      const keys = await ctx.subject().discoverMetadataKeys({ projectId: [PROJECT_A, PROJECT_B], ...WINDOW });
      expect(compact(keys).slice(0, 3)).toEqual(['env 26', 'hostname 26', 'status 4']);
    });
  });
}
