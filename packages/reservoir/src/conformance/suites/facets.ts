// Facets conformance (plan D6): top values per field over the logs matching
// every filter (including one on the faceted field), text forms only, count
// desc then byte order, `otherCount` for present values beyond the limit,
// fields in request order and named `metadata.<key>` for metadata keys.
// Counted over a bounded sample (big projects): the newest matching logs
// (time, then id, descending) among the newest `scanLimit` logs of each
// project in the window, at most `sampleSize` over all of them; `sampleSize`
// in the result says how many logs were counted.

import { describe, expect, it } from 'vitest';
import type { LogFacet, LogFacetField, LogFacetsParams } from '../../core/types.js';
import type { ConformanceContext, LogCase } from '../harness.js';
import { logCaseParams } from '../harness.js';
import { PROJECT_A, PROJECT_B } from '../corpus.js';

function facetsParams(fields: LogFacetField[], kase: Pick<LogCase, 'q' | 'params' | 'projectIds'> = {}, limit?: number): LogFacetsParams {
  return { ...logCaseParams(kase), fields, ...(limit !== undefined ? { limit } : {}) } as LogFacetsParams;
}

/** `[field, 'value count' list, otherCount]` for compact assertions. */
function compact(facets: LogFacet[]): [string, string[], number][] {
  return facets.map((f) => [f.field, f.values.map((v) => `${v.value} ${v.count}`), f.otherCount]);
}

export function describeFacetsConformance(ctx: ConformanceContext): void {
  describe('facets', () => {
    it('FA01 levels', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ builtin: 'level' }]));
      expect(compact(facets)).toEqual([['level', ['info 12', 'error 7', 'warn 4', 'critical 1', 'debug 1'], 0]]);
    });

    it('FA02 services with a limit, ties in byte order, the rest in otherCount', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ builtin: 'service' }], {}, 3));
      expect(compact(facets)).toEqual([['service', ['api 14', 'auth 4', 'billing 2'], 5]]);
    });

    it('FA03 hostnames skip logs without a hostname', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ builtin: 'hostname' }]));
      expect(compact(facets)).toEqual([['hostname', ['web-1 11', 'web-2 8', 'web-3 4', 'web-4 1'], 0]]);
    });

    it('FA04 a numeric metadata key by its text form', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ metadata: 'status' }]));
      expect(compact(facets)).toEqual([['metadata.status', ['200 2', '500 1', '504 1'], 0]]);
    });

    it('FA05 a dotted key resolves the literal key and the nested path', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ metadata: 'http.method' }]));
      expect(compact(facets)).toEqual([['metadata.http.method', ['GET 1', 'POST 1'], 0]]);
    });

    it('FA06 several fields keep request order and the query applies', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ metadata: 'env' }, { builtin: 'level' }], { q: 'service:worker' }));
      expect(compact(facets)).toEqual([
        ['metadata.env', ['staging 2'], 0],
        ['level', ['error 1', 'info 1'], 0],
      ]);
    });

    it('FA07 arrays, objects and nulls have no text form', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ metadata: 'tags' }, { metadata: 'user' }, { metadata: 'note' }]));
      expect(compact(facets)).toEqual([
        ['metadata.tags', [], 0],
        ['metadata.user', [], 0],
        ['metadata.note', [], 0],
      ]);
    });

    it('FA08 booleans by their text form', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ metadata: 'ok' }]));
      expect(compact(facets)).toEqual([['metadata.ok', ['false 1', 'true 1'], 0]]);
    });

    it('FA09 a parsed text query', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ builtin: 'level' }], { q: 'timeout OR refused' }));
      expect(compact(facets)).toEqual([['level', ['error 2', 'warn 2'], 0]]);
    });

    it('FA10 no fields or an invalid metadata key reject with RangeError', async () => {
      await expect(ctx.subject().facets(facetsParams([]))).rejects.toBeInstanceOf(RangeError);
      await expect(ctx.subject().facets(facetsParams([{ metadata: 'bad key' }]))).rejects.toBeInstanceOf(RangeError);
    });

    it('FA11 a filter on the faceted field applies too', async () => {
      const { facets } = await ctx.subject().facets(facetsParams([{ builtin: 'service' }], { q: 'service:(auth OR billing)' }));
      expect(compact(facets)).toEqual([['service', ['auth 4', 'billing 2'], 0]]);
    });

    it('FA12 counts every matching log when the window is small', async () => {
      expect((await ctx.subject().facets(facetsParams([{ builtin: 'level' }]))).sampleSize).toBe(25);
      expect((await ctx.subject().facets(facetsParams([{ builtin: 'level' }], { q: 'service:worker' }))).sampleSize).toBe(2);
    });

    it('FA13 sampleSize keeps the newest matching logs', async () => {
      const result = await ctx.subject().facets({ ...facetsParams([{ builtin: 'level' }]), sampleSize: 5 });
      expect(compact(result.facets)).toEqual([['level', ['info 4', 'error 1'], 0]]);
      expect(result.sampleSize).toBe(5);
    });

    it('FA14 scanLimit bounds the window before the filters', async () => {
      const result = await ctx.subject().facets({ ...facetsParams([{ builtin: 'service' }], { q: 'level:error' }), scanLimit: 6 });
      expect(compact(result.facets)).toEqual([['service', ['api 2'], 0]]);
      expect(result.sampleSize).toBe(2);
    });

    it('FA15 sampleSize applies after the filters inside the scanned logs', async () => {
      const result = await ctx.subject().facets({
        ...facetsParams([{ builtin: 'hostname' }], { q: 'level:error' }),
        scanLimit: 10,
        sampleSize: 2,
      });
      expect(compact(result.facets)).toEqual([['hostname', ['web-1 1', 'web-2 1'], 0]]);
      expect(result.sampleSize).toBe(2);
    });

    it('FA16 scanLimit applies to each project, the sample to all of them', async () => {
      const kase = { projectIds: [PROJECT_A, PROJECT_B] };
      // The 3 newest of A (cron, search, search) and both logs of B (api).
      const scanned = await ctx.subject().facets({ ...facetsParams([{ builtin: 'service' }], kase), scanLimit: 3 });
      expect(compact(scanned.facets)).toEqual([['service', ['api 2', 'search 2', 'cron 1'], 0]]);
      expect(scanned.sampleSize).toBe(5);
      // The newest 3 of those five: A's three (B's logs are older).
      const sampled = await ctx.subject().facets({ ...facetsParams([{ builtin: 'service' }], kase), scanLimit: 3, sampleSize: 3 });
      expect(compact(sampled.facets)).toEqual([['service', ['search 2', 'cron 1'], 0]]);
      const errors = await ctx.subject().facets(facetsParams([{ builtin: 'level' }], { ...kase, q: 'level:error' }));
      expect(compact(errors.facets)).toEqual([['level', ['error 8'], 0]]);
      expect(errors.sampleSize).toBe(8);
    });

    it('FA17 sampleSize and scanLimit clamp to their maximum and reject non-numbers', async () => {
      const result = await ctx.subject().facets({ ...facetsParams([{ builtin: 'level' }]), sampleSize: 10_000_000, scanLimit: 10_000_000 });
      expect(result.sampleSize).toBe(25);
      await expect(ctx.subject().facets({ ...facetsParams([{ builtin: 'level' }]), sampleSize: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    });
  });
}
