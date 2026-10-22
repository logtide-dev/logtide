// Span and trace query conformance (plan D3, D6, Wave D rulings C2 and C3):
// span `attributeFilters` follow the metadata semantics over `attributes`;
// a trace matches `operation` and `attributeFilters` when ONE of its spans
// starting inside [from, to] matches all of them together; `serviceName`
// keeps its trace-level meaning, also while that span match is active;
// trace sorting by start time or duration, default start time desc.

import { describe, expect, it } from 'vitest';
import type { MetadataFilter, SpanQueryParams, TraceQueryParams } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { spanIdsOf, traceIdsOf } from '../harness.js';
import { PROJECT_A, seconds, WINDOW } from '../corpus.js';

const range = (prefix: string, from: number, to: number, pad = 0): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(pad, '0')}`);
const sorted = (ids: string[]): string[] => [...ids].sort();

const equals = (key: string, value: string): MetadataFilter => ({ key, op: 'equals', value, include_missing: false });

export function describeSpanTraceQueryConformance(ctx: ConformanceContext): void {
  describe('span and trace queries', () => {
    const spans = async (params: Partial<SpanQueryParams>) =>
      spanIdsOf((await ctx.subject().querySpans({ projectId: PROJECT_A, ...WINDOW, limit: 100, ...params })).spans);
    const traces = async (params: Partial<TraceQueryParams>) =>
      traceIdsOf((await ctx.subject().queryTraces({ projectId: PROJECT_A, ...WINDOW, limit: 100, ...params })).traces);

    it('SQ01 an operation and a numeric attribute by its text form', async () => {
      expect(sorted(await spans({ operation: 'GET /users', attributeFilters: [equals('http.status_code', '500')] })))
        .toEqual(sorted(range('GET-', 96, 100)));
    });

    it('SQ02 an attribute value list', async () => {
      const ids = await spans({ attributeFilters: [{ key: 'http.method', op: 'in', values: ['POST'], include_missing: false }] });
      expect(sorted(ids)).toEqual(sorted(range('POST-', 1, 10)));
    });

    it('SQ03 a missing attribute', async () => {
      const ids = await spans({ serviceName: 'api', attributeFilters: [{ key: 'http.method', op: 'not_exists', include_missing: true }] });
      expect(sorted(ids)).toEqual(sorted(range('SELECT-', 1, 10)));
    });

    it('SQ04 start time ascending', async () => {
      expect(await spans({ sortBy: 'start_time', sortOrder: 'asc', limit: 1 })).toEqual(['PAGE-1']);
    });

    it('TQ01 a trace matches an operation of any of its spans', async () => {
      expect(sorted(await traces({ operation: 'SELECT orders' }))).toEqual(range('TO', 1, 10, 2));
    });

    it('TQ02 an operation and an attribute on the same span', async () => {
      expect(await traces({ operation: 'GET /users', attributeFilters: [equals('http.status_code', '500')] })).toEqual(['TF3']);
    });

    it('TQ03 duration descending', async () => {
      expect(await traces({ sortBy: 'duration', sortOrder: 'desc', limit: 5 })).toEqual(['TF3', 'TF2', 'TF1', 'TW1', 'TO10']);
    });

    it('TQ04 start time ascending', async () => {
      expect(await traces({ sortBy: 'start_time', sortOrder: 'asc', limit: 2 })).toEqual(['TF1', 'TF2']);
    });

    it('TQ05 the default order is start time descending', async () => {
      expect(await traces({ limit: 1 })).toEqual(['TW1']);
    });

    it('TQ06 several attribute filters on one span', async () => {
      expect(sorted(await traces({ attributeFilters: [equals('http.method', 'POST'), equals('http.status_code', '500')] })))
        .toEqual(['TO09', 'TO10']);
    });

    it('TQ07 attribute filters matched by different spans do not match', async () => {
      expect(await traces({ attributeFilters: [equals('http.method', 'POST'), equals('db.system', 'postgresql')] })).toEqual([]);
    });

    it('TQ08 the service name is trace level', async () => {
      expect(sorted(await traces({ serviceName: 'frontend' }))).toEqual(['TF1', 'TF2', 'TF3']);
    });

    it('TQ09 error traces', async () => {
      expect(sorted(await traces({ error: true }))).toEqual(['TF3', 'TO09', 'TO10', 'TW1']);
    });

    it('TQ10 the service name stays trace level when an operation is set', async () => {
      // GET /users spans belong to service api, their traces to service frontend.
      expect(sorted(await traces({ serviceName: 'frontend', operation: 'GET /users' }))).toEqual(['TF1', 'TF2', 'TF3']);
      expect(await traces({ serviceName: 'api', operation: 'GET /users' })).toEqual([]);
    });

    it('TQ11 the service name stays trace level with attribute filters', async () => {
      expect(await traces({ serviceName: 'frontend', attributeFilters: [equals('http.status_code', '500')] })).toEqual(['TF3']);
      expect(await traces({ serviceName: 'api', attributeFilters: [equals('http.status_code', '500')] })).toEqual(['TO10', 'TO09']);
    });

    it('TQ12 the matching span must start inside the window', async () => {
      // TF3 starts inside [BASE, BASE + 500 s] but its GET /users spans start at 680 s and later.
      expect(sorted(await traces({ to: seconds(500), operation: 'GET /users' }))).toEqual(['TF1', 'TF2']);
      const { total } = await ctx.subject().queryTraces({ projectId: PROJECT_A, from: WINDOW.from, to: seconds(500), operation: 'GET /users' });
      expect(total).toBe(2);
    });

    it('TQ13 the window also bounds the span of attribute filters', async () => {
      // The only spans with http.status_code 500 in TF1 to TF3 are GET-96 to GET-100 (960 s to 1,000 s).
      expect(await traces({ to: seconds(500), attributeFilters: [equals('http.status_code', '500')] })).toEqual([]);
    });
  });
}
