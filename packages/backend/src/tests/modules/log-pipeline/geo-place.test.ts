import { describe, it, expect } from 'vitest';
import { buildGeoPlace, parseGeoPlace } from '../../../modules/log-pipeline/geo-place.js';

describe('buildGeoPlace', () => {
  it('rounds coordinates to 2 decimals and joins city and country', () => {
    expect(
      buildGeoPlace({ latitude: 41.9027835, longitude: 12.4963655, city: 'Rome', country: 'Italy' })
    ).toBe('41.90,12.50|Rome, Italy');
  });

  it('uses country alone when city is null', () => {
    expect(
      buildGeoPlace({ latitude: 1.3521, longitude: 103.8198, city: null, country: 'Singapore' })
    ).toBe('1.35,103.82|Singapore');
  });

  it('is stable for equal rounded inputs (bounded cardinality)', () => {
    const a = buildGeoPlace({ latitude: 41.901, longitude: 12.501, city: 'Rome', country: 'Italy' });
    const b = buildGeoPlace({ latitude: 41.899, longitude: 12.499, city: 'Rome', country: 'Italy' });
    expect(a).toBe(b);
  });

  it('returns null for non-finite coordinates', () => {
    expect(buildGeoPlace({ latitude: NaN, longitude: 12, city: null, country: 'X' })).toBeNull();
    expect(buildGeoPlace({ latitude: 1, longitude: Infinity, city: null, country: 'X' })).toBeNull();
  });

  it('strips pipe characters from the label so the format stays parseable', () => {
    expect(
      buildGeoPlace({ latitude: 1, longitude: 2, city: 'a|b', country: 'c|d' })
    ).toBe('1.00,2.00|ab, cd');
  });
});

describe('parseGeoPlace', () => {
  it('parses a well-formed value', () => {
    expect(parseGeoPlace('41.90,12.50|Rome, Italy')).toEqual({
      lat: 41.9,
      lon: 12.5,
      label: 'Rome, Italy',
    });
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseGeoPlace('91.00,12.50|X')).toBeNull();
    expect(parseGeoPlace('-91.00,12.50|X')).toBeNull();
    expect(parseGeoPlace('41.90,181.00|X')).toBeNull();
    expect(parseGeoPlace('41.90,-181.00|X')).toBeNull();
  });

  it('rejects garbage (untrusted metadata values)', () => {
    expect(parseGeoPlace('pizza')).toBeNull();
    expect(parseGeoPlace('')).toBeNull();
    expect(parseGeoPlace('|label only')).toBeNull();
    expect(parseGeoPlace('1,2,3|x')).toBeNull();
    expect(parseGeoPlace('abc,def|x')).toBeNull();
  });

  it('keeps label after further pipes and truncates to 80 chars', () => {
    expect(parseGeoPlace('1.00,2.00|a|b')).toEqual({ lat: 1, lon: 2, label: 'a|b' });
    const long = '1.00,2.00|' + 'x'.repeat(200);
    expect(parseGeoPlace(long)!.label).toHaveLength(80);
  });

  it('parses a value with no label as empty label', () => {
    expect(parseGeoPlace('1.00,2.00|')).toEqual({ lat: 1, lon: 2, label: '' });
  });
});
