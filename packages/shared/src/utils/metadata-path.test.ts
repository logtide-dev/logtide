import { describe, it, expect } from 'vitest';
import {
  resolveMetadataPath,
  formatMetadataCell,
  metadataPathCandidates,
  METADATA_PATH_MAX_SPLIT_SEGMENTS,
} from './metadata-path.js';

describe('resolveMetadataPath', () => {
  it('only follows own properties', () => {
    expect(resolveMetadataPath({ a: 1 }, 'constructor')).toBeUndefined();
    expect(resolveMetadataPath({ a: { b: 1 } }, 'a.toString')).toBeUndefined();
    expect(resolveMetadataPath({ a: 1 }, '__proto__')).toBeUndefined();
  });

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

  it('reads a literal dotted child under a nested parent (OTLP resource attributes)', () => {
    const metadata = { resource: { 'service.name': 'checkout', 'k8s.pod.name': 'pod-1' } };
    expect(resolveMetadataPath(metadata, 'resource.service.name')).toBe('checkout');
    expect(resolveMetadataPath(metadata, 'resource.k8s.pod.name')).toBe('pod-1');
  });

  it('walks plain children under a literal dotted parent (OTLP structured bodies)', () => {
    const metadata = { 'otel.body': { user: { id: 7 }, 'http.route': '/pay' } };
    expect(resolveMetadataPath(metadata, 'otel.body.user.id')).toBe(7);
    expect(resolveMetadataPath(metadata, 'otel.body.http.route')).toBe('/pay');
  });

  it('a literal key at any level beats walking its segments', () => {
    expect(resolveMetadataPath({ a: { 'b.c': 'literal', b: { c: 'deep' } } }, 'a.b.c')).toBe('literal');
  });

  it('the longest leading key wins between two literal splits', () => {
    expect(resolveMetadataPath({ 'a.b': { c: 'lead' }, a: { 'b.c': 'tail' } }, 'a.b.c')).toBe('lead');
  });

  it('a null value stops the resolution', () => {
    expect(resolveMetadataPath({ 'a.b': null, a: { b: 'nested' } }, 'a.b')).toBeNull();
  });

  it('resolves falsy values (0, false, empty string) instead of dropping them', () => {
    expect(resolveMetadataPath({ retries: 0 }, 'retries')).toBe(0);
    expect(resolveMetadataPath({ ok: false }, 'ok')).toBe(false);
    expect(resolveMetadataPath({ s: '' }, 's')).toBe('');
  });
});

describe('metadataPathCandidates', () => {
  it('a plain key is its own only candidate', () => {
    expect(metadataPathCandidates('env')).toEqual([['env']]);
  });

  it('two segments: the literal key, then the nested path', () => {
    expect(metadataPathCandidates('a.b')).toEqual([['a.b'], ['a', 'b']]);
  });

  it('longest leading key first, then longest trailing key', () => {
    expect(metadataPathCandidates('a.b.c')).toEqual([['a.b.c'], ['a.b', 'c'], ['a', 'b.c'], ['a', 'b', 'c']]);
    expect(metadataPathCandidates('a.b.c.d')).toEqual([
      ['a.b.c.d'],
      ['a.b.c', 'd'],
      ['a.b', 'c.d'],
      ['a.b', 'c', 'd'],
      ['a', 'b.c.d'],
      ['a', 'b', 'c.d'],
      ['a', 'b', 'c', 'd'],
    ]);
  });

  it('a key over the split cap falls back to the literal key and the nested path', () => {
    const max = METADATA_PATH_MAX_SPLIT_SEGMENTS;
    const segments = Array.from({ length: max + 1 }, (_, i) => `s${i}`);
    expect(metadataPathCandidates(segments.join('.'))).toEqual([[segments.join('.')], segments]);
    expect(metadataPathCandidates(segments.slice(1).join('.'))).toHaveLength(1 + (max * (max - 1)) / 2);
  });

  it('returns fresh arrays the caller may change', () => {
    metadataPathCandidates('x.y')[0].push('z');
    expect(metadataPathCandidates('x.y')).toEqual([['x.y'], ['x', 'y']]);
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
