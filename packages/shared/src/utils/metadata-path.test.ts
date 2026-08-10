import { describe, it, expect } from 'vitest';
import { resolveMetadataPath, formatMetadataCell } from './metadata-path.js';

describe('resolveMetadataPath', () => {
  it('returns a top-level key', () => {
    expect(resolveMetadataPath({ http_host: 'a.example.com' }, 'http_host')).toBe('a.example.com');
  });

  it('prefers an exact key containing dots over path traversal', () => {
    // A literal key "geo.city" wins over metadata.geo.city
    expect(
      resolveMetadataPath({ 'geo.city': 'literal', geo: { city: 'nested' } }, 'geo.city')
    ).toBe('literal');
  });

  it('traverses dot paths into nested objects', () => {
    expect(resolveMetadataPath({ geo: { city: 'Las Vegas' } }, 'geo.city')).toBe('Las Vegas');
  });

  it('returns undefined for a missing path', () => {
    expect(resolveMetadataPath({ geo: { city: 'x' } }, 'geo.country')).toBeUndefined();
  });

  it('returns undefined when an intermediate segment is not an object', () => {
    expect(resolveMetadataPath({ geo: 'string' }, 'geo.city')).toBeUndefined();
  });

  it('returns undefined for null/undefined metadata', () => {
    expect(resolveMetadataPath(null, 'a')).toBeUndefined();
    expect(resolveMetadataPath(undefined, 'a')).toBeUndefined();
  });

  it('resolves falsy values (0, false, empty string) instead of dropping them', () => {
    expect(resolveMetadataPath({ retries: 0 }, 'retries')).toBe(0);
    expect(resolveMetadataPath({ ok: false }, 'ok')).toBe(false);
    expect(resolveMetadataPath({ s: '' }, 's')).toBe('');
  });
});

describe('formatMetadataCell', () => {
  it('returns null for null and undefined', () => {
    expect(formatMetadataCell(null)).toBeNull();
    expect(formatMetadataCell(undefined)).toBeNull();
  });

  it('stringifies objects and arrays as JSON', () => {
    expect(formatMetadataCell({ a: 1 })).toBe('{"a":1}');
    expect(formatMetadataCell([1, 'x'])).toBe('[1,"x"]');
  });

  it('stringifies scalars with String()', () => {
    expect(formatMetadataCell(200)).toBe('200');
    expect(formatMetadataCell(false)).toBe('false');
    expect(formatMetadataCell('ok')).toBe('ok');
  });
});
