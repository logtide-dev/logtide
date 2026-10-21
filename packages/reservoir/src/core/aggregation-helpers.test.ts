import { describe, it, expect } from 'vitest';
import {
  histogramBucketStarts,
  zeroFillHistogram,
  buildFacet,
  facetFieldName,
  countMetadataKeys,
  latencyBucketIndex,
  encodeSessionCursor,
  decodeSessionCursor,
  compareByteOrder,
} from './aggregation-helpers.js';

const BASE = new Date('2026-01-05T10:00:00.000Z');
const min = (n: number) => new Date(BASE.getTime() + n * 60_000);

describe('histogram helpers', () => {
  it('bucket starts are epoch aligned', () => {
    expect(histogramBucketStarts(min(5), min(25), 600).map(d => d.toISOString()))
      .toEqual(['2026-01-05T10:00:00.000Z', '2026-01-05T10:10:00.000Z', '2026-01-05T10:20:00.000Z']);
    expect(histogramBucketStarts(new Date('2026-01-05T07:00:00Z'), min(120), 18000).map(d => d.toISOString()))
      .toEqual(['2026-01-05T03:00:00.000Z', '2026-01-05T08:00:00.000Z']);
    expect(histogramBucketStarts(BASE, min(30), 600, true)).toHaveLength(3);
    expect(histogramBucketStarts(BASE, min(30), 600)).toHaveLength(4);
  });

  it('bucket starts handle seconds, a single bucket and pre-epoch dates', () => {
    expect(histogramBucketStarts(new Date('2026-01-05T10:00:07.250Z'), new Date('2026-01-05T10:00:09Z'), 1).map(d => d.toISOString()))
      .toEqual(['2026-01-05T10:00:07.000Z', '2026-01-05T10:00:08.000Z', '2026-01-05T10:00:09.000Z']);
    expect(histogramBucketStarts(BASE, BASE, 3600)).toEqual([BASE]);
    expect(histogramBucketStarts(new Date(-1500), new Date(0), 1).map(d => d.getTime())).toEqual([-2000, -1000, 0]);
    expect(histogramBucketStarts(min(10), min(5), 60)).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('bucket starts reject bucketSeconds %s', (b) => {
    expect(() => histogramBucketStarts(BASE, min(30), b)).toThrow(RangeError);
  });

  it('zeroFillHistogram fills, sums and keeps byLevel sparse', () => {
    const r = zeroFillHistogram({ from: BASE, to: min(30), bucketSeconds: 600 },
      [{ time: BASE, level: 'error', count: 3 }, { time: BASE, level: 'info', count: 2 }, { time: min(10), level: 'warn', count: 1 }]);
    expect(r.buckets[0]).toEqual({ time: BASE, total: 5, byLevel: { error: 3, info: 2 } });
    expect(r.buckets[3]).toEqual({ time: min(30), total: 0, byLevel: {} });
    expect(r.bucketSeconds).toBe(600);
  });

  it('zeroFillHistogram sums rows sharing bucket and level and skips zero counts', () => {
    const r = zeroFillHistogram({ from: BASE, to: min(20), bucketSeconds: 600, toExclusive: true },
      [{ time: min(10), level: 'info', count: 2 }, { time: min(10), level: 'info', count: 3 }, { time: BASE, level: 'debug', count: 0 }]);
    expect(r.buckets).toEqual([
      { time: BASE, total: 0, byLevel: {} },
      { time: min(10), total: 5, byLevel: { info: 5 } },
    ]);
  });

  it('zeroFillHistogram rejects misaligned rows', () => {
    expect(() => zeroFillHistogram({ from: BASE, to: min(30), bucketSeconds: 600 }, [{ time: min(5), level: 'info', count: 1 }])).toThrow('misaligned histogram bucket');
    expect(() => zeroFillHistogram({ from: BASE, to: min(30), bucketSeconds: 600 }, [{ time: min(40), level: 'info', count: 1 }]))
      .toThrow(`misaligned histogram bucket ${min(40).toISOString()}`);
    expect(() => zeroFillHistogram({ from: BASE, to: min(30), bucketSeconds: 600, toExclusive: true }, [{ time: min(30), level: 'info', count: 1 }]))
      .toThrow('misaligned histogram bucket');
  });

  it('zeroFillHistogram returns fresh bucket dates', () => {
    const r = zeroFillHistogram({ from: BASE, to: min(10), bucketSeconds: 600 }, []);
    expect(r.buckets.map(b => b.total)).toEqual([0, 0]);
    expect(r.buckets[0].time).not.toBe(BASE);
  });
});

describe('facet helpers', () => {
  it('builds facets with byte-order ties and otherCount', () => {
    expect(buildFacet({ builtin: 'service' }, [{ value: 'worker', count: 2 }, { value: 'api', count: 14 }, { value: 'search', count: 2 }, { value: 'billing', count: 2 }, { value: 'auth', count: 4 }], 25, 3))
      .toEqual({ field: 'service', values: [{ value: 'api', count: 14 }, { value: 'auth', count: 4 }, { value: 'billing', count: 2 }], otherCount: 5 });
    expect(facetFieldName({ metadata: 'user.id' })).toBe('metadata.user.id');
  });

  it('names every facet field', () => {
    expect(['level', 'service', 'hostname'].map(b => facetFieldName({ builtin: b as 'level' }))).toEqual(['level', 'service', 'hostname']);
  });

  it('drops empty values, merges equal text forms and never reports a negative otherCount', () => {
    expect(buildFacet({ metadata: 'status' }, [{ value: '500', count: 2 }, { value: '', count: 9 }, { value: '500', count: 1 }, { value: '200', count: 3 }], 5, 10))
      .toEqual({ field: 'metadata.status', values: [{ value: '200', count: 3 }, { value: '500', count: 3 }], otherCount: 0 });
  });

  it('does not mutate the input rows', () => {
    const top = [{ value: 'b', count: 1 }, { value: 'a', count: 1 }];
    buildFacet({ builtin: 'level' }, top, 2, 1);
    expect(top).toEqual([{ value: 'b', count: 1 }, { value: 'a', count: 1 }]);
  });

  it('orders ties by UTF-8 byte order', () => {
    const values = ['é', 'z', 'Z', 'a', '\u{1F600}', '\uFFFD', 'ab', 'a b'];
    const out = buildFacet({ builtin: 'service' }, values.map(value => ({ value, count: 1 })), 8, 50).values.map(v => v.value);
    expect(out).toEqual(['Z', 'a', 'a b', 'ab', 'z', 'é', '\uFFFD', '\u{1F600}']);
  });
});

describe('compareByteOrder', () => {
  it.each([
    ['a', 'b', -1], ['b', 'a', 1], ['a', 'a', 0], ['B', 'a', -1], ['a', 'ab', -1],
    ['z', 'é', -1], ['\uFFFD', '\u{1F600}', -1], ['\u{1F600}', '\uE000', 1], ['\u{1F600}', '\u{1F601}', -1],
  ])('compareByteOrder(%j, %j) has sign %i', (a, b, sign) => expect(Math.sign(compareByteOrder(a, b))).toBe(sign));

  it('matches Buffer byte comparison', () => {
    const samples = ['', 'a', 'A', 'é', '東京', '\uFFFF', '\u{10000}', '\u{1F600}x', 'zz', 'Ошибка'];
    for (const a of samples) for (const b of samples) {
      expect(Math.sign(compareByteOrder(a, b))).toBe(Math.sign(Buffer.compare(Buffer.from(a), Buffer.from(b))));
    }
  });
});

describe('countMetadataKeys', () => {
  it('counts metadata keys one level deep', () => {
    expect(countMetadataKeys([{ user: { id: 1, name: 'a' }, status: 200, 'geo.city': 'x', geo: { city: 'y', coords: { lat: 1 } } }, { status: 1 }, null]))
      .toEqual([{ key: 'status', occurrences: 2 }, { key: 'geo.city', occurrences: 1 }, { key: 'geo.coords', occurrences: 1 }, { key: 'user.id', occurrences: 1 }, { key: 'user.name', occurrences: 1 }]);
  });

  it('treats arrays and null as values, skips empty objects', () => {
    expect(countMetadataKeys([{ tags: ['a'], note: null, empty: {}, n: { v: null } }, undefined, {}]))
      .toEqual([{ key: 'n.v', occurrences: 1 }, { key: 'note', occurrences: 1 }, { key: 'tags', occurrences: 1 }]);
  });

  it('returns an empty list for no metadata', () => {
    expect(countMetadataKeys([])).toEqual([]);
  });
});

describe('latencyBucketIndex', () => {
  it('latency buckets are upper inclusive', () => {
    expect([0.3, 1, 1.01, 100, 100.5, 60000, 60001].map(latencyBucketIndex)).toEqual([0, 0, 1, 6, 7, 15, 16]);
  });

  it('puts every bound in its own bucket and zero or negative durations first', () => {
    const bounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000];
    expect(bounds.map(latencyBucketIndex)).toEqual(bounds.map((_, i) => i));
    expect([0, -5].map(latencyBucketIndex)).toEqual([0, 0]);
    expect(latencyBucketIndex(Number.POSITIVE_INFINITY)).toBe(16);
  });
});

describe('session cursors', () => {
  it('session cursors round trip and reject garbage', () => {
    expect(decodeSessionCursor(encodeSessionCursor(BASE, 'abc'))).toEqual({ lastEvent: BASE, sessionId: 'abc' });
    for (const bad of ['', 'not-base64!', Buffer.from('{"t":"x","s":"a"}').toString('base64url')]) expect(() => decodeSessionCursor(bad)).toThrow(RangeError);
  });

  it('round trips unusual session ids and is URL safe', () => {
    const id = 'sess/é?東=+';
    const cursor = encodeSessionCursor(BASE, id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSessionCursor(cursor)).toEqual({ lastEvent: BASE, sessionId: id });
  });

  it.each([
    ['not json', Buffer.from('nope').toString('base64url')],
    ['array', Buffer.from('[1]').toString('base64url')],
    ['missing s', Buffer.from(JSON.stringify({ t: BASE.toISOString() })).toString('base64url')],
    ['empty s', Buffer.from(JSON.stringify({ t: BASE.toISOString(), s: '' })).toString('base64url')],
    ['numeric s', Buffer.from(JSON.stringify({ t: BASE.toISOString(), s: 1 })).toString('base64url')],
    ['numeric t', Buffer.from(JSON.stringify({ t: 0, s: 'a' })).toString('base64url')],
    ['non ISO t', Buffer.from(JSON.stringify({ t: '2026-01-05', s: 'a' })).toString('base64url')],
    ['padding', encodeSessionCursor(BASE, 'abc') + '='],
  ])('rejects a cursor with %s', (_label, cursor) => {
    expect(() => decodeSessionCursor(cursor)).toThrow('Invalid sessions cursor');
  });
});

it('exports the helpers from the package index', async () => {
  const r = await import('../index.js');
  for (const name of ['histogramBucketStarts', 'zeroFillHistogram', 'facetFieldName', 'buildFacet', 'countMetadataKeys',
    'latencyBucketIndex', 'encodeSessionCursor', 'decodeSessionCursor', 'compareByteOrder'] as const) {
    expect(typeof r[name]).toBe('function');
  }
});
