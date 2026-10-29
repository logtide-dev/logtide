// Metadata key discovery conformance (plan D6, Wave D ruling C4): the most
// recent `sampleSize` logs of the range, top-level keys plus one nested level
// of plain objects (child names with a dot included), one occurrence per log
// and key, occurrences desc then key byte order, at most DISCOVER_MAX_KEYS.

import { describe, expect, it } from 'vitest';
import { DISCOVER_MAX_KEYS } from '../../core/constants.js';
import type { MetadataKeyOccurrence } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { minutes, PROJECT_A, PROJECT_B, PROJECT_C, WINDOW } from '../corpus.js';

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

    it('D05 child keys with a dot in their own name are listed under their parent', async () => {
      const keys = await ctx.subject().discoverMetadataKeys({ projectId: PROJECT_C, from: minutes(0), to: minutes(1) });
      expect(compact(keys)).toEqual(['http.method 1', 'otel.k8s.pod.name 1', 'otel.service.name 1']);
    });

    it('D06 at most DISCOVER_MAX_KEYS keys, the first in key byte order on a tie', async () => {
      // L94 alone: 600 top-level keys k000 to k599, one occurrence each.
      const keys = await ctx.subject().discoverMetadataKeys({ projectId: PROJECT_C, from: minutes(2), to: minutes(3) });
      expect(DISCOVER_MAX_KEYS).toBe(500);
      expect(compact(keys)).toEqual(Array.from({ length: DISCOVER_MAX_KEYS }, (_, i) => `k${String(i).padStart(3, '0')} 1`));
    });

    it('D07 the cap applies after counting over the whole sample', async () => {
      const keys = await ctx.subject().discoverMetadataKeys({ projectId: PROJECT_C, from: minutes(0), to: minutes(3) });
      expect(keys).toHaveLength(DISCOVER_MAX_KEYS);
      expect(compact(keys).slice(0, 4)).toEqual(['http.method 1', 'k000 1', 'k001 1', 'k002 1']);
      expect(compact(keys).at(-1)).toBe('k498 1');
    });
  });
}
