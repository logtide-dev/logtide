// Facets conformance (plan D6): top values per field over the logs matching
// every filter (including one on the faceted field), text forms only, count
// desc then byte order, `otherCount` for present values beyond the limit,
// fields in request order and named `metadata.<key>` for metadata keys.

import { describe, expect, it } from 'vitest';
import type { LogFacet, LogFacetField, LogFacetsParams } from '../../core/types.js';
import type { ConformanceContext, LogCase } from '../harness.js';
import { logCaseParams } from '../harness.js';

function facetsParams(fields: LogFacetField[], kase: Pick<LogCase, 'q' | 'params'> = {}, limit?: number): LogFacetsParams {
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
  });
}
