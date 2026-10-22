// Top values and distinct conformance: `metadata.<key>` fields resolve like
// every other metadata read (the shared `metadataPathCandidates`, literal
// dotted keys first, so the browser SDK's flat `performance.metric` and a
// nested `performance: { metric }` both count) and count by the S5 text form
// (numbers and booleans as text; null, objects and arrays have no text).
// Built-in fields read their column. Engines order ties freely, so results
// compare as sets sorted by count desc, then value.

import { describe, expect, it } from 'vitest';
import type { TopValuesParams } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { minutes, PROJECT_D, WINDOW } from '../corpus.js';

const scope = { projectId: PROJECT_D, from: WINDOW.from, to: WINDOW.to };

type TopRow = { value: string; count: number; lastSeen?: string };

/** `value count` (plus ` lastSeen` when present), sorted by count desc then value. */
function compact(values: TopRow[]): string[] {
  return [...values]
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
    .map((v) => [v.value, v.count, ...(v.lastSeen !== undefined ? [v.lastSeen] : [])].join(' '));
}

export function describeTopValuesConformance(ctx: ConformanceContext): void {
  describe('top values', () => {
    const top = async (params: Partial<TopValuesParams> & Pick<TopValuesParams, 'field'>) =>
      compact((await ctx.subject().topValues({ ...scope, ...params })).values);
    const distinct = async (field: string) => [...(await ctx.subject().distinct({ ...scope, field })).values].sort();

    it('V01 a literal dotted key and the nested path both count (web vitals)', async () => {
      expect(await top({ field: 'metadata.performance.metric' })).toEqual(['LCP 2', 'CLS 1', 'INP 1']);
    });

    it('V02 numbers count by their text', async () => {
      expect(await top({ field: 'metadata.performance.value' })).toEqual(['150 1', '2100 1', '4200 1']);
    });

    it('V03 a literal dotted child under a nested parent (OTLP resource)', async () => {
      expect(await top({ field: 'metadata.resource.service.name' })).toEqual(['cart 1', 'checkout 1']);
    });

    it('V04 arrays, objects and null have no text', async () => {
      expect(await top({ field: 'metadata.tags' })).toEqual([]);
      expect(await top({ field: 'metadata.user' })).toEqual([]);
      expect(await top({ field: 'metadata.note' })).toEqual([]);
    });

    it('V05 a literal key beats walking its segments', async () => {
      expect(await top({ field: 'metadata.a.b.c' })).toEqual(['dotted-parent 1', 'literal-child 1']);
    });

    it('V06 the last seen time per value', async () => {
      expect(await top({ field: 'metadata.performance.rating', includeLastSeen: true })).toEqual([
        `good 3 ${minutes(39).toISOString()}`,
        `poor 1 ${minutes(37).toISOString()}`,
      ]);
    });

    it('V07 the level and service filters apply, and the limit cuts after ranking', async () => {
      expect(await top({ field: 'metadata.performance.metric', level: 'warn' })).toEqual(['LCP 1']);
      expect(await top({ field: 'metadata.performance.metric', service: ['api', 'collector'] })).toEqual([]);
      expect(await top({ field: 'metadata.performance.metric', limit: 1 })).toEqual(['LCP 2']);
    });

    it('V08 a built-in field reads its column', async () => {
      expect(await top({ field: 'service' })).toEqual(['api 4', 'web 4', 'collector 2']);
    });

    it('V09 distinct resolves the same paths and text forms', async () => {
      expect(await distinct('metadata.performance.metric')).toEqual(['CLS', 'INP', 'LCP']);
      expect(await distinct('metadata.performance.value')).toEqual(['150', '2100', '4200']);
      expect(await distinct('metadata.resource.service.name')).toEqual(['cart', 'checkout']);
      expect(await distinct('metadata.tags')).toEqual([]);
      expect(await distinct('service')).toEqual(['api', 'collector', 'web']);
    });
  });
}
