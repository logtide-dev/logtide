// Span timeseries conformance (1.8): spans starting inside [from, to] of the
// projects, per bucket, ascending, non-empty buckets only. `bucket` truncates
// to the UTC hour or day as before; `bucketSeconds` (integer, 60 to 86,400)
// overrides it with buckets at multiples of it since the Unix epoch, never
// aligned on `from`. `kinds` keeps spans of those kinds; `attributeFilters`
// follow the querySpans semantics (a `resource.` key reads the resource
// attributes with the rest of the key, literal dotted key first, then the
// nested path; include_missing as for logs). Counts and error counts are
// exact; percentiles within the operation stats tolerances.

import { describe, expect, it } from 'vitest';
import type { MetadataFilter, SpanTimeseriesBucket, SpanTimeseriesParams } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { expectBetween, expectMs } from '../harness.js';
import { CONFORMANCE_BASE, PROJECT_A, PROJECT_B, seconds, WINDOW } from '../corpus.js';

/** [bucket start in seconds from CONFORMANCE_BASE, span count, error count] */
type Bucket = [number, number, number];

const shape = (rows: SpanTimeseriesBucket[]): Bucket[] =>
  rows.map((r) => [(r.time.getTime() - CONFORMANCE_BASE.getTime()) / 1000, r.spanCount, r.errorCount]);

const equals = (key: string, value: string): MetadataFilter => ({ key, op: 'equals', value, include_missing: false });

const DAY_START = -10 * 3600; // CONFORMANCE_BASE is 10:00 UTC

function expectOrderedPercentiles(rows: SpanTimeseriesBucket[]): void {
  for (const r of rows) {
    expect(r.p50 !== null && r.p95 !== null && r.p99 !== null, `${r.time.toISOString()} has percentiles`).toBe(true);
    expect(r.p50! <= r.p95! && r.p95! <= r.p99!, `${r.time.toISOString()} p50 <= p95 <= p99`).toBe(true);
  }
}

export function describeSpanTimeseriesConformance(ctx: ConformanceContext): void {
  describe('span timeseries', () => {
    const series = (params: Partial<SpanTimeseriesParams>) =>
      ctx.subject().getSpanTimeseries({ projectIds: [PROJECT_A], ...WINDOW, ...params } as SpanTimeseriesParams);
    const buckets = async (params: Partial<SpanTimeseriesParams>) => shape(await series(params));

    it('ST01 an hour bucket counts every span of the projects in the window', async () => {
      const rows = await series({ bucket: 'hour' });
      expect(shape(rows)).toEqual([[0, 129, 8]]);
      expectOrderedPercentiles(rows);
      expect(await buckets({ bucket: 'hour', projectIds: [PROJECT_A, PROJECT_B] })).toEqual([[0, 130, 8]]);
      expect(await buckets({ bucket: 'hour', projectIds: [PROJECT_B] })).toEqual([[0, 1, 0]]);
    });

    it('ST02 a day bucket starts at the UTC day', async () => {
      expect(await buckets({ bucket: 'day' })).toEqual([[DAY_START, 129, 8]]);
    });

    it('ST03 bucketSeconds buckets in ascending order, empty buckets left out', async () => {
      expect(await buckets({ bucketSeconds: 300 })).toEqual([
        [0, 33, 0],
        [300, 30, 0],
        [600, 30, 0],
        [900, 11, 5],
        [1200, 8, 0],
        [1500, 10, 1],
        [1800, 2, 1],
        [2400, 5, 1],
      ]);
    });

    it('ST04 bucketSeconds buckets are aligned on the epoch, not on from', async () => {
      // CONFORMANCE_BASE is 240 s past a multiple of 420 s since the epoch.
      expect(await buckets({ bucketSeconds: 420 })).toEqual([
        [-240, 21, 0],
        [180, 42, 0],
        [600, 41, 5],
        [1020, 6, 0],
        [1440, 14, 2],
        [2280, 5, 1],
      ]);
    });

    it('ST05 the window bounds are inclusive span start times', async () => {
      // GET-1 starts at 10 s, GET-2 at 20 s, GET-3 at 30 s.
      expect(await buckets({ bucketSeconds: 60, from: seconds(10), to: seconds(20) })).toEqual([[0, 2, 0]]);
    });

    it('ST06 bucketSeconds overrides bucket', async () => {
      expect(await buckets({ bucket: 'day', bucketSeconds: 3600 })).toEqual([[0, 129, 8]]);
    });

    it('ST07 the bucketSeconds bounds 60 and 86,400 are accepted', async () => {
      expect(await buckets({ bucketSeconds: 86_400 })).toEqual([[DAY_START, 129, 8]]);
      const perMinute = await buckets({ bucketSeconds: 60 });
      expect(perMinute.reduce((sum, [, n]) => sum + n, 0)).toBe(129);
      expect(perMinute.every(([t]) => t % 60 === 0)).toBe(true);
      expect(perMinute[0]).toEqual([0, 9, 0]); // PAGE-1 to PAGE-3, RENDER, GET-1 to GET-5
    });

    it('ST08 invalid bucket parameters are rejected', async () => {
      for (const bucketSeconds of [59, 86_401, 90.5, 0, -60, Number.NaN]) {
        await expect(series({ bucketSeconds }), `bucketSeconds ${bucketSeconds}`).rejects.toThrow(/bucketSeconds/);
      }
      await expect(series({})).rejects.toThrow(/bucket/);
    });

    it('ST09 kinds keep only spans of those kinds', async () => {
      expect(await buckets({ bucketSeconds: 3600, kinds: ['SERVER', 'CONSUMER'] })).toEqual([[0, 114, 8]]);
      expect(await buckets({ bucketSeconds: 3600, kinds: ['CLIENT'] })).toEqual([[0, 10, 0]]);
      expect(await buckets({ bucket: 'hour', kinds: ['INTERNAL'] })).toEqual([[0, 1, 0]]);
      expect(await buckets({ bucket: 'hour', kinds: ['PRODUCER'] })).toEqual([]);
    });

    it('ST10 kinds must be a non-empty list of known kinds', async () => {
      await expect(series({ bucket: 'hour', kinds: [] })).rejects.toThrow(/kind/);
      await expect(series({ bucket: 'hour', kinds: ['BOGUS' as never] })).rejects.toThrow(/kind/);
    });

    it('ST11 a resource. key reads the resource attributes, literal dotted key or nested path', async () => {
      expect(await buckets({ bucketSeconds: 300, attributeFilters: [equals('resource.host.name', 'vps-app')] })).toEqual([
        [1200, 8, 0],
        [1500, 10, 1],
        [1800, 2, 1],
      ]);
      expect(await buckets({ bucketSeconds: 300, attributeFilters: [equals('resource.host.name', 'vps-worker')] }))
        .toEqual([[2400, 5, 1]]);
      expect(await buckets({ bucketSeconds: 300, attributeFilters: [equals('host.name', 'vps-app')] })).toEqual([]);
    });

    it('ST12 a span attribute filter by the text form of a number', async () => {
      expect(await buckets({ bucketSeconds: 300, attributeFilters: [equals('http.status_code', '500')] })).toEqual([
        [900, 5, 5],
        [1500, 1, 1],
        [1800, 1, 1],
      ]);
    });

    it('ST13 include_missing on a value exclusion', async () => {
      const notApp = (include_missing: boolean): MetadataFilter[] => [
        { key: 'resource.host.name', op: 'not_equals', value: 'vps-app', include_missing },
      ];
      expect(await buckets({ bucketSeconds: 3600, attributeFilters: notApp(true) })).toEqual([[0, 109, 6]]);
      expect(await buckets({ bucketSeconds: 3600, attributeFilters: notApp(false) })).toEqual([[0, 5, 1]]);
    });

    it('ST14 bucketSeconds, kinds and attribute filters combine', async () => {
      const rows = await series({
        bucketSeconds: 600,
        kinds: ['SERVER', 'CONSUMER'],
        attributeFilters: [equals('resource.host.name', 'vps-app'), equals('http.method', 'POST')],
      });
      // POST-1 to POST-9 (100 to 900 ms) start in [1200 s, 1800 s), POST-10 at 1800 s.
      expect(shape(rows)).toEqual([[1200, 9, 1], [1800, 1, 1]]);
      expectBetween(rows[0].p50!, 400, 600, 'POST /orders p50');
      expectOrderedPercentiles(rows);
      expect(await buckets({
        bucketSeconds: 600,
        serviceName: 'worker',
        kinds: ['CONSUMER'],
        attributeFilters: [equals('resource.host.name', 'vps-worker')],
      })).toEqual([[2400, 4, 1]]);
      expect(await buckets({
        bucketSeconds: 600,
        kinds: ['CLIENT'],
        attributeFilters: [equals('resource.host.name', 'vps-app'), equals('http.method', 'POST')],
      })).toEqual([]);
    });

    it('ST15 latency percentiles of one bucket', async () => {
      const rows = await series({ bucketSeconds: 3600, kinds: ['SERVER'], attributeFilters: [equals('http.method', 'GET')] });
      expect(shape(rows)).toEqual([[0, 100, 5]]);
      expectMs(rows[0].p50!, 50.5, 1.5, 'GET /users p50');
      expectMs(rows[0].p95!, 95.05, 1.5, 'GET /users p95');
      expectMs(rows[0].p99!, 99.01, 1.5, 'GET /users p99');
    });

    it('ST16 one service, a list of services, or an empty service name', async () => {
      expect(await buckets({ bucket: 'hour', serviceName: 'worker' })).toEqual([[0, 5, 1]]);
      expect(await buckets({ bucket: 'hour', serviceName: ['frontend', 'worker'] })).toEqual([[0, 9, 1]]);
      expect(await buckets({ bucket: 'hour', serviceName: '' })).toEqual([[0, 129, 8]]);
    });

    it('ST17 no project gives no bucket', async () => {
      expect(await series({ bucket: 'hour', projectIds: [] })).toEqual([]);
    });
  });
}
