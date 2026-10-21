import { describe, it, expect } from 'vitest';
import { legacySearchToTextQuery, isEmptyTextQuery } from './text-query.js';
import {
  normalizeLogFilter,
  normalizeHistogramParams,
  normalizeFacetsParams,
  normalizeDiscoverParams,
  normalizeOperationStatsParams,
  normalizeSpanQueryParams,
  normalizeTraceQueryParams,
  normalizeListSessionsParams,
} from './normalize.js';
import { encodeSessionCursor } from './aggregation-helpers.js';
import type { TextQuery } from './types.js';

const base = { projectId: 'p', from: new Date(0), to: new Date(3_600_000) };
const w = (value: string) => ({ kind: 'word' as const, value });
const ph = (value: string) => ({ kind: 'phrase' as const, value });

describe('legacySearchToTextQuery', () => {
  it.each([
    ['Connection Refused', undefined, { all: [{ kind: 'word', value: 'connection' }, { kind: 'word', value: 'refused' }], anyOf: [], none: [] }],
    ['/var/lib', 'fulltext', { all: [{ kind: 'word', value: 'var' }, { kind: 'word', value: 'lib' }], anyOf: [], none: [] }],
    ['::', 'fulltext', { all: [{ kind: 'phrase', value: '::' }], anyOf: [], none: [] }],
    ['  conn ref ', 'substring', { all: [{ kind: 'phrase', value: '  conn ref ' }], anyOf: [], none: [] }],
    ['   ', undefined, undefined],
  ])('legacySearchToTextQuery(%j, %j)', (s, mode, expected) => expect(legacySearchToTextQuery(s, mode as any)).toEqual(expected));

  it.each([
    [undefined, undefined, undefined],
    ['', 'substring', undefined],
    ['  ', 'substring', undefined],
    ['  :: ', 'fulltext', { all: [ph('::')], anyOf: [], none: [] }],
    ['service:api OR "x"', undefined, { all: [w('service'), w('api'), w('or'), w('x')], anyOf: [], none: [] }],
    ['ÉCHOUÉ 東京', 'fulltext', { all: [w('échoué'), w('東京')], anyOf: [], none: [] }],
  ])('edge: legacySearchToTextQuery(%j, %j) never parses the grammar', (s, mode, expected) =>
    expect(legacySearchToTextQuery(s as any, mode as any)).toEqual(expected));

  it('isEmptyTextQuery', () => {
    expect(isEmptyTextQuery({ all: [], anyOf: [], none: [] })).toBe(true);
    expect(isEmptyTextQuery({ all: [], anyOf: [], none: [w('x')] })).toBe(false);
    expect(isEmptyTextQuery({ all: [], anyOf: [[w('a'), w('b')]], none: [] })).toBe(false);
  });
});

describe('normalizeLogFilter', () => {
  it('normalizeLogFilter keeps search, adds textQuery, does not mutate', () => {
    const input = { ...base, search: 'timeout redis' }; const copy = structuredClone(input);
    const out = normalizeLogFilter(input);
    expect(input).toEqual(copy); expect(out.search).toBe('timeout redis'); expect(out.textQuery?.all).toHaveLength(2);
  });

  it('caller textQuery wins over search', () => {
    const tq = { all: [], anyOf: [[{ kind: 'word' as const, value: 'a' }]], none: [] };
    expect(normalizeLogFilter({ ...base, search: 'x', textQuery: tq }).textQuery).toEqual(tq);
  });

  it('drops empty textQuery and exclude, rejects empty terms', () => {
    const out = normalizeLogFilter({ ...base, textQuery: { all: [], anyOf: [], none: [] }, exclude: { level: [], service: [] } });
    expect(out.textQuery).toBeUndefined(); expect(out.exclude).toBeUndefined();
    expect(() => normalizeLogFilter({ ...base, textQuery: { all: [{ kind: 'word', value: '' }], anyOf: [], none: [] } })).toThrow(RangeError);
    expect(() => normalizeLogFilter({ ...base, textQuery: { all: [], anyOf: [[]], none: [] } })).toThrow(RangeError);
  });

  it('substring search becomes one phrase', () => {
    expect(normalizeLogFilter({ ...base, search: 'conn ref', searchMode: 'substring' }).textQuery).toEqual({ all: [ph('conn ref')], anyOf: [], none: [] });
  });

  it('adds no textQuery key without a search', () => {
    expect(normalizeLogFilter({ ...base })).not.toHaveProperty('textQuery');
    expect(normalizeLogFilter({ ...base, search: '   ' })).not.toHaveProperty('textQuery');
  });

  it('returns a new object and keeps the caller exclude untouched', () => {
    const exclude = { level: [] as never[], service: ['x'] };
    const input = { ...base, exclude };
    const out = normalizeLogFilter(input);
    expect(out).not.toBe(input);
    expect(out.exclude).toEqual({ service: ['x'] });
    expect(exclude).toEqual({ level: [], service: ['x'] });
    expect(input.exclude).toBe(exclude);
  });

  it.each<[string, TextQuery]>([
    ['empty phrase in none', { all: [], anyOf: [], none: [ph('')] }],
    ['empty term in a group', { all: [], anyOf: [[w('a'), ph('')]], none: [] }],
    ['word with spaces', { all: [w('a b')], anyOf: [], none: [] }],
    ['word with punctuation', { all: [w('10.0.0.1')], anyOf: [], none: [] }],
    ['unknown kind', { all: [{ kind: 'regex', value: 'x' } as any], anyOf: [], none: [] }],
    ['non string value', { all: [{ kind: 'phrase', value: 1 } as any], anyOf: [], none: [] }],
    ['missing arrays', { all: [w('a')] } as any],
  ])('rejects a textQuery with %s', (_label, textQuery) => {
    expect(() => normalizeLogFilter({ ...base, textQuery })).toThrow(RangeError);
  });

  it('accepts words in any script and phrases with anything', () => {
    const tq = { all: [w('ÉCHOUÉ'), w('user_id'), ph('10.0.0.1'), ph(' a ')], anyOf: [], none: [w('東京')] };
    expect(normalizeLogFilter({ ...base, textQuery: tq }).textQuery).toEqual(tq);
  });

  it('keeps matchNothing for the client to answer', () => {
    expect(normalizeLogFilter({ ...base, matchNothing: true }).matchNothing).toBe(true);
  });
});

describe('normalizeHistogramParams', () => {
  it('histogram limits', () => {
    for (const b of [0, -1, 1.5, Number.NaN]) expect(() => normalizeHistogramParams({ ...base, bucketSeconds: b })).toThrow(RangeError);
    expect(() => normalizeHistogramParams({ ...base, to: new Date(7_200_000), bucketSeconds: 1 })).toThrow(RangeError);
    expect(() => normalizeHistogramParams({ ...base, from: new Date(10), to: new Date(0), bucketSeconds: 60 })).toThrow(RangeError);
  });

  it('allows exactly 1,000 buckets', () => {
    expect(normalizeHistogramParams({ ...base, to: new Date(999_000), bucketSeconds: 1 }).bucketSeconds).toBe(1);
    expect(() => normalizeHistogramParams({ ...base, to: new Date(1_000_000), bucketSeconds: 1 })).toThrow('at most 1,000 buckets');
    expect(normalizeHistogramParams({ ...base, to: new Date(1_000_000), toExclusive: true, bucketSeconds: 1 }).bucketSeconds).toBe(1);
  });

  it('also normalizes the filter part', () => {
    expect(normalizeHistogramParams({ ...base, bucketSeconds: 60, search: 'a' }).textQuery).toEqual({ all: [w('a')], anyOf: [], none: [] });
  });

  it('rejects invalid dates', () => {
    expect(() => normalizeHistogramParams({ ...base, from: new Date(Number.NaN), bucketSeconds: 60 })).toThrow(RangeError);
  });
});

describe('normalizeFacetsParams', () => {
  it('facets defaults and validation', () => {
    expect(normalizeFacetsParams({ ...base, fields: [{ builtin: 'level' }] }).limit).toBe(10);
    expect(normalizeFacetsParams({ ...base, fields: [{ builtin: 'level' }], limit: 500 }).limit).toBe(50);
    for (const fields of [[], [{ metadata: 'bad key' }], [{ builtin: 'level' }, { builtin: 'level' }]])
      expect(() => normalizeFacetsParams({ ...base, fields: fields as any })).toThrow(RangeError);
  });

  it('clamps small limits and rejects non-numbers', () => {
    expect(normalizeFacetsParams({ ...base, fields: [{ builtin: 'service' }], limit: 0 }).limit).toBe(1);
    expect(normalizeFacetsParams({ ...base, fields: [{ builtin: 'service' }], limit: 7.9 }).limit).toBe(7);
    expect(() => normalizeFacetsParams({ ...base, fields: [{ builtin: 'service' }], limit: Number.NaN })).toThrow(RangeError);
  });

  it.each([
    ['too many fields', Array.from({ length: 21 }, (_, i) => ({ metadata: `k${i}` }))],
    ['unknown built-in', [{ builtin: 'message' }]],
    ['duplicate metadata key', [{ metadata: 'env' }, { metadata: 'env' }]],
    ['not a field', ['level']],
    ['dotted key with ..', [{ metadata: 'a..b' }]],
  ])('rejects %s', (_label, fields) => {
    expect(() => normalizeFacetsParams({ ...base, fields: fields as any })).toThrow(RangeError);
  });

  it('accepts 20 fields, dotted keys and a metadata key named like a built-in', () => {
    const fields = [{ builtin: 'level' as const }, { metadata: 'level' }, { metadata: 'user.id' },
      ...Array.from({ length: 17 }, (_, i) => ({ metadata: `k${i}` }))];
    expect(normalizeFacetsParams({ ...base, fields }).fields).toHaveLength(20);
  });

  it('rejects a reversed range', () => {
    expect(() => normalizeFacetsParams({ ...base, from: new Date(5), to: new Date(1), fields: [{ builtin: 'level' }] })).toThrow(RangeError);
  });
});

describe('discover, operation stats, spans, traces, sessions', () => {
  it('discover, operation stats, spans, traces, sessions', () => {
    expect(normalizeDiscoverParams({ ...base }).sampleSize).toBe(1000);
    expect(normalizeDiscoverParams({ ...base, sampleSize: 99999 }).sampleSize).toBe(5000);
    const ops = normalizeOperationStatsParams({ projectId: 'p', from: base.from, to: base.to });
    expect(ops.limit).toBe(100); expect(ops.kinds).toBeUndefined();
    expect(normalizeSpanQueryParams({ ...base, operation: 'GET /users', sortBy: 'duration' })).toMatchObject({ operationName: 'GET /users', sortBy: 'duration_ms' });
    expect(normalizeSpanQueryParams({ ...base, operation: 'GET /users' })).not.toHaveProperty('operation');
    expect(() => normalizeSpanQueryParams({ ...base, operation: 'a', operationName: 'b' })).toThrow(RangeError);
    expect(() => normalizeTraceQueryParams({ ...base, sortBy: 'duration_ms' as any })).toThrow(RangeError);
    const s = { projectId: 'p', from: base.from, to: base.to };
    expect(normalizeListSessionsParams({ ...s, limit: 999 }).limit).toBe(200);
    expect(() => normalizeListSessionsParams({ ...s, limit: 0 })).toThrow(RangeError);
    expect(() => normalizeListSessionsParams({ ...s, limit: 5, cursor: 'garbage' })).toThrow(RangeError);
  });

  it('discover clamps small sample sizes and checks the range', () => {
    expect(normalizeDiscoverParams({ ...base, sampleSize: 0 }).sampleSize).toBe(1);
    expect(() => normalizeDiscoverParams({ ...base, from: new Date(9), to: new Date(1) })).toThrow(RangeError);
  });

  it('operation stats limits and kinds', () => {
    const p = { projectId: 'p', from: base.from, to: base.to };
    expect(normalizeOperationStatsParams({ ...p, limit: 9999 }).limit).toBe(500);
    expect(normalizeOperationStatsParams({ ...p, limit: -1 }).limit).toBe(1);
    expect(normalizeOperationStatsParams({ ...p, kinds: ['CLIENT'] }).kinds).toEqual(['CLIENT']);
    expect(() => normalizeOperationStatsParams({ ...p, kinds: [] })).toThrow(RangeError);
    expect(() => normalizeOperationStatsParams({ ...p, kinds: ['BOGUS' as any] })).toThrow(RangeError);
    expect(() => normalizeOperationStatsParams({ ...p, from: new Date(9), to: new Date(1) })).toThrow(RangeError);
  });

  it('span operation alias and sorts', () => {
    expect(normalizeSpanQueryParams({ ...base, operation: 'a', operationName: 'a' })).toEqual({ ...base, operationName: 'a' });
    expect(normalizeSpanQueryParams({ ...base, operation: 'a', operationName: ['a'] })).toEqual({ ...base, operationName: ['a'] });
    expect(() => normalizeSpanQueryParams({ ...base, operation: 'a', operationName: ['a', 'b'] })).toThrow(RangeError);
    expect(normalizeSpanQueryParams({ ...base, sortBy: 'duration_ms' }).sortBy).toBe('duration_ms');
    expect(normalizeSpanQueryParams({ ...base, sortBy: 'start_time' }).sortBy).toBe('start_time');
    expect(() => normalizeSpanQueryParams({ ...base, sortBy: 'startTime' as any })).toThrow(RangeError);
    expect(normalizeSpanQueryParams({ ...base })).toEqual(base);
  });

  it('span normalization does not mutate the caller params', () => {
    const input = { ...base, operation: 'GET /users', sortBy: 'duration' as const };
    const copy = structuredClone(input);
    normalizeSpanQueryParams(input);
    expect(input).toEqual(copy);
  });

  it('trace sorts', () => {
    expect(normalizeTraceQueryParams({ ...base, sortBy: 'duration', sortOrder: 'asc' })).toMatchObject({ sortBy: 'duration', sortOrder: 'asc' });
    expect(normalizeTraceQueryParams({ ...base })).toEqual(base);
    expect(() => normalizeTraceQueryParams({ ...base, sortOrder: 'up' as any })).toThrow(RangeError);
  });

  it('sessions limit, cursor and range', () => {
    const s = { projectId: 'p', from: base.from, to: base.to };
    expect(normalizeListSessionsParams({ ...s, limit: 50 }).limit).toBe(50);
    expect(() => normalizeListSessionsParams({ ...s, limit: 1.5 })).toThrow(RangeError);
    expect(() => normalizeListSessionsParams({ ...s, limit: Number.NaN })).toThrow(RangeError);
    const cursor = encodeSessionCursor(new Date(1000), 'abc');
    expect(normalizeListSessionsParams({ ...s, limit: 5, cursor }).cursor).toBe(cursor);
    expect(() => normalizeListSessionsParams({ ...s, from: new Date(9), to: new Date(1), limit: 5 })).toThrow(RangeError);
  });
});

it('exports the legacy conversion from the package index', async () => {
  const r = await import('../index.js');
  expect(r.legacySearchToTextQuery('a b')).toEqual({ all: [w('a'), w('b')], anyOf: [], none: [] });
  expect(r.isEmptyTextQuery({ all: [], anyOf: [], none: [] })).toBe(true);
});
