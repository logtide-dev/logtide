import { describe, it, expect } from 'vitest';
import type { LogFieldInfo } from '$lib/api/logs';
import {
  BUILTIN_FACET_KEYS,
  FACET_VALUE_LIMIT,
  MAX_METADATA_FACETS,
  facetCandidates,
  selectMetadataFacetKeys,
} from './facet-keys';

const f = (key: string, occurrences: number): LogFieldInfo => ({ key, occurrences });

describe('facet keys', () => {
  it('exposes the built-in keys and the limits', () => {
    expect([...BUILTIN_FACET_KEYS]).toEqual(['level', 'service', 'host']);
    expect(MAX_METADATA_FACETS).toBe(8);
    expect(FACET_VALUE_LIMIT).toBe(10);
  });

  it('keeps pinned keys first, then discovered by occurrences, max 8', () => {
    const discovered = [f('a', 1), f('b', 50), f('c', 30), f('d', 20), f('e', 10), f('g', 9), f('h', 8), f('i', 7), f('j', 6)];
    expect(selectMetadataFacetKeys(['pinned.one', 'a'], discovered)).toEqual([
      'pinned.one',
      'a',
      'b',
      'c',
      'd',
      'e',
      'g',
      'h',
    ]);
  });

  it('drops hostname, breadcrumbs, object parents and unqueryable keys', () => {
    expect(facetCandidates([f('geo', 9), f('geo.city', 5), f('a b', 4), f('hostname', 9)])).toEqual(['geo.city']);
    expect(facetCandidates([f('breadcrumbs', 12), f('breadcrumbs.0.type', 3), f('user.id', 2)])).toEqual(['user.id']);
  });

  it('drops keys that alias a built-in field', () => {
    expect(facetCandidates([f('trace_id', 9), f('service', 8), f('level', 7), f('env', 1)])).toEqual(['env']);
  });

  it('sorts candidates by occurrences, ties by key', () => {
    expect(facetCandidates([f('b', 2), f('a', 2), f('c', 5)])).toEqual(['c', 'a', 'b']);
  });

  it('dedupes and ignores unqueryable or built-in pins', () => {
    expect(selectMetadataFacetKeys(['env', 'env', 'a b', 'hostname'], [f('env', 3), f('region', 2)])).toEqual([
      'env',
      'region',
    ]);
  });

  it('caps pins at 8 too', () => {
    const pins = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'];
    expect(selectMetadataFacetKeys(pins, [f('other', 100)])).toEqual(pins.slice(0, 8));
  });
});
