import { describe, it, expect } from 'vitest';
import {
  pickBucketSeconds,
  histogramBucketCount,
  HISTOGRAM_BUCKET_LADDER_SECONDS,
  HISTOGRAM_TARGET_BUCKETS,
  parseFacetFields,
  DEFAULT_FACET_FIELDS,
  FACET_MAX_FIELDS,
} from '../../../modules/query/explorer-params.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pick(rangeMs: number): number {
  const from = new Date('2026-10-01T00:00:00.000Z');
  return pickBucketSeconds(from, new Date(from.getTime() + rangeMs));
}

describe('pickBucketSeconds', () => {
  it('targets about 60 buckets on a fixed ladder', () => {
    expect(HISTOGRAM_TARGET_BUCKETS).toBe(60);
    expect(HISTOGRAM_BUCKET_LADDER_SECONDS[0]).toBe(1);
    expect(HISTOGRAM_BUCKET_LADDER_SECONDS[HISTOGRAM_BUCKET_LADDER_SECONDS.length - 1]).toBe(604800);
  });

  it.each([
    ['10 s', 10 * SECOND, 1],
    ['60 s', 60 * SECOND, 1],
    ['15 min', 15 * MINUTE, 15],
    ['1 h', HOUR, 60],
    ['6 h', 6 * HOUR, 300],
    ['12 h', 12 * HOUR, 600],
    ['24 h', DAY, 1800],
    ['7 d', 7 * DAY, 10800],
    ['30 d', 30 * DAY, 43200],
    ['2 years', 730 * DAY, 604800],
  ])('picks the bucket size for %s', (_label, rangeMs, expected) => {
    expect(pick(rangeMs)).toBe(expected);
  });

  it('picks the nearest step on a log scale', () => {
    // 7 min / 60 = 7 s per bucket: log(7/5) < log(10/7), so 5 wins
    expect(pick(7 * MINUTE)).toBe(5);
    // 8 min / 60 = 8 s per bucket: log(10/8) < log(8/5), so 10 wins
    expect(pick(8 * MINUTE)).toBe(10);
    // 3 h / 60 = 180 s per bucket: log(180/120) < log(300/180), so 120 wins
    expect(pick(3 * HOUR)).toBe(120);
  });

  it('always returns a ladder value', () => {
    for (const rangeMs of [1, 999, 7 * MINUTE, 3 * HOUR, 90 * DAY]) {
      expect(HISTOGRAM_BUCKET_LADDER_SECONDS).toContain(pick(rangeMs));
    }
  });

  it('throws a RangeError when to is not after from', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    expect(() => pickBucketSeconds(at, at)).toThrow(RangeError);
    expect(() => pickBucketSeconds(at, new Date(at.getTime() - 1))).toThrow(RangeError);
  });
});

describe('histogramBucketCount', () => {
  it('counts epoch-aligned buckets including the one holding to', () => {
    const from = new Date('2026-10-01T10:00:00.000Z');
    expect(histogramBucketCount(from, new Date(from.getTime() + HOUR), 60)).toBe(61);
    expect(histogramBucketCount(from, new Date(from.getTime() + HOUR - 1), 60)).toBe(60);
    expect(histogramBucketCount(new Date(from.getTime() + 30 * SECOND), new Date(from.getTime() + 90 * SECOND), 60)).toBe(2);
  });
});

describe('parseFacetFields', () => {
  const keys = (raw: string | undefined) => {
    const result = parseFacetFields(raw);
    if (!result.ok) throw new Error(result.error);
    return result.fields;
  };

  it('defaults to level, service and host', () => {
    expect(DEFAULT_FACET_FIELDS).toBe('level,service,host');
    const expected = [
      { key: 'level', field: { builtin: 'level' } },
      { key: 'service', field: { builtin: 'service' } },
      { key: 'host', field: { builtin: 'hostname' } },
    ];
    expect(keys(undefined)).toEqual(expected);
    expect(keys('')).toEqual(expected);
    expect(keys(' , ')).toEqual(expected);
  });

  it('maps host and hostname to the hostname built-in', () => {
    expect(keys('host')).toEqual([{ key: 'host', field: { builtin: 'hostname' } }]);
    expect(keys('hostname')).toEqual([{ key: 'hostname', field: { builtin: 'hostname' } }]);
  });

  it('treats other keys as metadata', () => {
    expect(keys('user.id, region')).toEqual([
      { key: 'user.id', field: { metadata: 'user.id' } },
      { key: 'region', field: { metadata: 'region' } },
    ]);
  });

  it('dedupes keys', () => {
    expect(keys('service,level,service, level')).toEqual([
      { key: 'service', field: { builtin: 'service' } },
      { key: 'level', field: { builtin: 'level' } },
    ]);
  });

  it('dedupes host and hostname into one field', () => {
    expect(keys('host,hostname')).toEqual([{ key: 'host', field: { builtin: 'hostname' } }]);
  });

  it('rejects more than 12 fields', () => {
    expect(FACET_MAX_FIELDS).toBe(12);
    const twelve = Array.from({ length: 12 }, (_, i) => `k${i}`).join(',');
    expect(parseFacetFields(twelve).ok).toBe(true);
    const thirteen = Array.from({ length: 13 }, (_, i) => `k${i}`).join(',');
    expect(parseFacetFields(thirteen)).toEqual({ ok: false, error: 'At most 12 facet fields are allowed' });
  });

  it('rejects a key longer than 200 chars', () => {
    expect(parseFacetFields('a'.repeat(200)).ok).toBe(true);
    const result = parseFacetFields(`level,${'a'.repeat(201)}`);
    expect(result.ok).toBe(false);
  });

  it('rejects keys the query language cannot write', () => {
    for (const raw of ['user id', '1abc', 'a..b', 'a.', '$where']) {
      const result = parseFacetFields(raw);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects the trace, session and span built-ins', () => {
    for (const raw of ['trace', 'trace_id', 'session', 'session_id', 'span', 'span_id']) {
      expect(parseFacetFields(raw)).toEqual({ ok: false, error: `Facets are not available for "${raw}"` });
    }
  });
});
