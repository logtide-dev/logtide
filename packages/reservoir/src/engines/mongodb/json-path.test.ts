import { describe, it, expect } from 'vitest';
import { compileJsonFilters, resolvedValueExpr, scalarTextExpr, textCandidates, type MgJsonRoot } from './json-path.js';
import type { MetadataFilter } from '../../core/types.js';

const f = (o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter => o as MetadataFilter;
const one = (filter: MetadataFilter, root: MgJsonRoot = 'metadata') => {
  const clauses = compileJsonFilters([filter], root);
  expect(clauses).toHaveLength(1);
  return clauses[0];
};
const notArray = { $not: { $type: 'array' } };

describe('textCandidates', () => {
  it('numeric-looking values add the number', () => {
    expect(textCandidates('500')).toEqual(['500', 500]);
    expect(textCandidates('1.5')).toEqual(['1.5', 1.5]);
    expect(textCandidates('-3')).toEqual(['-3', -3]);
  });

  it('only canonical number text adds a number', () => {
    expect(textCandidates('007')).toEqual(['007']);
    expect(textCandidates('1e3')).toEqual(['1e3']);
    expect(textCandidates(' 5')).toEqual([' 5']);
    expect(textCandidates('')).toEqual(['']);
    expect(textCandidates('-0')).toEqual(['-0']);
    expect(textCandidates('NaN')).toEqual(['NaN']);
    expect(textCandidates('Infinity')).toEqual(['Infinity']);
  });

  it('boolean text adds the boolean', () => {
    expect(textCandidates('true')).toEqual(['true', true]);
    expect(textCandidates('false')).toEqual(['false', false]);
    expect(textCandidates('True')).toEqual(['True']);
  });
});

describe('compileJsonFilters on plain keys', () => {
  it('numeric-looking values match numbers and strings', () => {
    expect(one(f({ key: 'status', op: 'equals', value: '500' }))).toEqual({ 'metadata.status': { $in: ['500', 500], ...notArray } });
  });

  it('boolean text matches booleans', () => {
    expect(one(f({ key: 'cached', op: 'equals', value: 'true' }))).toEqual({ 'metadata.cached': { $in: ['true', true], ...notArray } });
  });

  it('plain text stays a plain candidate', () => {
    expect(one(f({ key: 'env', op: 'equals', value: 'prod' }))).toEqual({ 'metadata.env': { $in: ['prod'], ...notArray } });
  });

  it('in lists every candidate of every value', () => {
    expect(one(f({ key: 'status', op: 'in', values: ['200', 'ok'] }))).toEqual({ 'metadata.status': { $in: ['200', 200, 'ok'], ...notArray } });
  });

  it('negated clauses match a missing key unless include_missing is false', () => {
    const positive = { 'metadata.env': { $in: ['prod'], ...notArray } };
    expect(one(f({ key: 'env', op: 'not_equals', value: 'prod', include_missing: true }))).toEqual({ $nor: [positive] });
    expect(one(f({ key: 'env', op: 'not_equals', value: 'prod' }))).toEqual({ $nor: [positive] });
    expect(one(f({ key: 'env', op: 'not_equals', value: 'prod', include_missing: false }))).toEqual({
      'metadata.env': { $exists: true },
      $nor: [positive],
    });
    expect(one(f({ key: 'env', op: 'not_in', values: ['prod'], include_missing: true }))).toEqual({ $nor: [positive] });
  });

  it('exists and not_exists use $exists', () => {
    expect(one(f({ key: 'env', op: 'exists' }))).toEqual({ 'metadata.env': { $exists: true } });
    expect(one(f({ key: 'env', op: 'not_exists' }))).toEqual({ 'metadata.env': { $exists: false } });
  });

  it('span roots address their own column', () => {
    expect(one(f({ key: 'route', op: 'equals', value: '/x' }), 'attributes')).toEqual({ 'attributes.route': { $in: ['/x'], ...notArray } });
    expect(one(f({ key: 'host', op: 'exists' }), 'resource_attributes')).toEqual({ 'resource_attributes.host': { $exists: true } });
  });
});

describe('compileJsonFilters through $expr', () => {
  it('dotted key uses $expr with $getField, literal key first', () => {
    const clause = one(f({ key: 'http.status', op: 'equals', value: '200' }));
    expect(clause).toEqual({ $expr: { $eq: [scalarTextExpr(resolvedValueExpr('metadata', 'http.status')), '200'] } });
    const json = JSON.stringify(clause);
    expect(json).toContain('"$getField":{"field":{"$literal":"http.status"}');
    expect(json).toContain('"$getField":{"field":{"$literal":"http"}');
    expect(json).toContain('"$getField":{"field":{"$literal":"status"}');
    expect(json).not.toContain('metadata.http');
  });

  it('in compares the text against the list', () => {
    const clause = one(f({ key: 'user.id', op: 'in', values: ['42', '43'] }));
    expect(clause).toEqual({ $expr: { $in: [scalarTextExpr(resolvedValueExpr('metadata', 'user.id')), ['42', '43']] } });
  });

  it('negated dotted clauses match a missing key', () => {
    const text = scalarTextExpr(resolvedValueExpr('metadata', 'user.id'));
    expect(one(f({ key: 'user.id', op: 'not_equals', value: '42', include_missing: true }))).toEqual({
      $expr: { $not: [{ $eq: [text, '42'] }] },
    });
    const strict = one(f({ key: 'user.id', op: 'not_in', values: ['42'], include_missing: false }));
    expect(JSON.stringify(strict)).toContain('"missing"');
    expect(strict).toEqual({
      $expr: { $and: [{ $ne: [{ $type: resolvedValueExpr('metadata', 'user.id') }, 'missing'] }, { $not: [{ $in: [text, ['42']] }] }] },
    });
  });

  it('dotted exists checks that the key resolves', () => {
    const resolved = resolvedValueExpr('metadata', 'geo.city');
    expect(one(f({ key: 'geo.city', op: 'exists' }))).toEqual({ $expr: { $ne: [{ $type: resolved }, 'missing'] } });
    expect(one(f({ key: 'geo.city', op: 'not_exists' }))).toEqual({ $expr: { $not: [{ $ne: [{ $type: resolved }, 'missing'] }] } });
  });

  it('contains matches numbers as text', () => {
    const clause = one(f({ key: 'status', op: 'contains', value: '5.0' }));
    expect(clause).toEqual({
      $expr: { $regexMatch: { input: scalarTextExpr(resolvedValueExpr('metadata', 'status')), regex: '5\\.0', options: 'i' } },
    });
  });

  it('a $-prefixed key never becomes a field path', () => {
    const clause = one(f({ key: '$where', op: 'equals', value: 'x' }));
    expect(clause).toEqual({ $expr: { $eq: [scalarTextExpr(resolvedValueExpr('metadata', '$where')), 'x'] } });
  });

  it('resolution guards every step with an object type check', () => {
    const json = JSON.stringify(resolvedValueExpr('metadata', 'a.b'));
    expect(json.match(/"object"/g)).toHaveLength(3);
    expect(json).toContain('$$REMOVE');
    // One $getField per key of every shared candidate: 29 candidates with 113
    // keys at the 8-segment split cap, the literal key plus the nested walk above it.
    const deep = JSON.stringify(resolvedValueExpr('metadata', 'a.b.c.d.e.f.g.h'));
    expect(deep.match(/"\$getField"/g)).toHaveLength(113);
    const long = JSON.stringify(resolvedValueExpr('metadata', 'a.b.c.d.e.f.g.h.i'));
    expect(long.match(/"\$getField"/g)).toHaveLength(10);
  });

  it('a dotted key tries the shared candidates in order', () => {
    const json = JSON.stringify(resolvedValueExpr('metadata', 'resource.service.name'));
    const fields = [...json.matchAll(/"\$literal":"([^"]+)"/g)].map((m) => m[1]);
    expect(fields).toEqual(['resource.service.name', 'resource.service', 'name', 'resource', 'service.name', 'resource', 'service', 'name']);
  });

  it('scalar text maps numbers and booleans with $toString and everything else to null', () => {
    const json = JSON.stringify(scalarTextExpr({ $literal: 1 }));
    expect(json).toContain('"$toString"');
    expect(json).toContain('["int","long","double","decimal","bool"]');
    expect(json).toContain('"default":null');
  });
});

describe('compileJsonFilters roots', () => {
  it('rejects an unknown root', () => {
    expect(() => compileJsonFilters([], 'events' as MgJsonRoot)).toThrow('Unsupported JSON root');
    expect(() => resolvedValueExpr('$where' as MgJsonRoot, 'a')).toThrow('Unsupported JSON root');
  });
});
