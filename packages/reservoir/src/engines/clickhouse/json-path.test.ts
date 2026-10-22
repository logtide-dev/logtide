import { describe, it, expect } from 'vitest';
import { bindJsonKey, chJsonExistsExpr, chJsonRawExpr, chScalarTextExpr, compileJsonFilters } from './json-path.js';
import { ClickHouseQueryTranslator } from './query-translator.js';
import type { MetadataFilter } from '../../core/types.js';

function mf(o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter {
  return o as MetadataFilter;
}

function compile(filters: MetadataFilter[], column: 'metadata' | 'attributes' | 'resource_attributes' = 'metadata') {
  const queryParams: Record<string, unknown> = {};
  const conditions = compileJsonFilters(filters, column, queryParams, 'p_mf');
  return { conditions, queryParams };
}

describe('clickhouse json paths', () => {
  it('simple key reads the raw value once', () => {
    const r = compile([mf({ key: 'env', op: 'equals', value: 'prod' })]);
    expect(r.conditions).toHaveLength(1);
    expect(r.conditions[0]).toContain('JSONExtractRaw(metadata, {p_mfk0:String})');
    expect(r.conditions[0]).not.toContain('JSONHas(');
    expect(r.conditions[0].endsWith(' = {p_mfv0:String}')).toBe(true);
    expect(r.queryParams).toEqual({ p_mfk0: 'env', p_mfv0: 'prod' });
  });

  it('dotted key prefers the literal key', () => {
    const r = compile([mf({ key: 'http.status', op: 'equals', value: '200' })]);
    expect(r.conditions[0]).toContain(
      'multiIf(JSONHas(metadata, {p_mfk0:String}), JSONExtractRaw(metadata, {p_mfk0:String}), JSONExtractRaw(metadata, {p_mfk0s0:String}, {p_mfk0s1:String}))',
    );
    expect(r.queryParams).toEqual({ p_mfk0: 'http.status', p_mfk0s0: 'http', p_mfk0s1: 'status', p_mfv0: '200' });
  });

  it('a dotted key tries every shared candidate in order, each key string bound once', () => {
    const queryParams: Record<string, unknown> = {};
    const key = bindJsonKey('resource.service.name', 'k', queryParams);
    expect(queryParams).toEqual({
      k: 'resource.service.name', ks0: 'resource.service', ks1: 'name', ks2: 'resource', ks3: 'service.name', ks4: 'service',
    });
    expect(chJsonRawExpr('metadata', key)).toBe(
      'multiIf(' +
        'JSONHas(metadata, {k:String}), JSONExtractRaw(metadata, {k:String}), ' +
        'JSONHas(metadata, {ks0:String}, {ks1:String}), JSONExtractRaw(metadata, {ks0:String}, {ks1:String}), ' +
        'JSONHas(metadata, {ks2:String}, {ks3:String}), JSONExtractRaw(metadata, {ks2:String}, {ks3:String}), ' +
        'JSONExtractRaw(metadata, {ks2:String}, {ks4:String}, {ks1:String}))',
    );
    expect(chJsonExistsExpr('metadata', key)).toBe(
      '(JSONHas(metadata, {k:String}) OR JSONHas(metadata, {ks0:String}, {ks1:String}) OR ' +
        'JSONHas(metadata, {ks2:String}, {ks3:String}) OR JSONHas(metadata, {ks2:String}, {ks4:String}, {ks1:String}))',
    );
  });

  it('numbers compare by text', () => {
    const r = compile([mf({ key: 'status', op: 'equals', value: '500' })]);
    expect(r.conditions[0].startsWith('multiIf(')).toBe(true);
    expect(chScalarTextExpr('x')).toBe(
      "multiIf(x = '' OR x = 'null' OR startsWith(x, '{') OR startsWith(x, '['), NULL, startsWith(x, '\"'), JSONExtractString(x), x)",
    );
  });

  it('in compares the scalar text with a list', () => {
    const r = compile([mf({ key: 'status', op: 'in', values: ['500', '501'] })]);
    expect(r.conditions[0].endsWith(' IN {p_mfv0:Array(String)}')).toBe(true);
    expect(r.queryParams.p_mfv0).toEqual(['500', '501']);
  });

  it('negated clauses match a missing key', () => {
    const ne = compile([mf({ key: 'env', op: 'not_equals', value: 'prod', include_missing: true })]);
    expect(ne.conditions[0].startsWith('(NOT (JSONHas(metadata, {p_mfk0:String})) OR ifNull(')).toBe(true);
    expect(ne.conditions[0].endsWith(' != {p_mfv0:String}, 1))')).toBe(true);
    const ni = compile([mf({ key: 'user.id', op: 'not_in', values: ['42'], include_missing: true })]);
    expect(ni.conditions[0].startsWith('(NOT ((JSONHas(metadata, {p_mfk0:String}) OR JSONHas(metadata, {p_mfk0s0:String}, {p_mfk0s1:String}))) OR ifNull(')).toBe(true);
    expect(ni.conditions[0].endsWith(' NOT IN {p_mfv0:Array(String)}, 1))')).toBe(true);
  });

  it('a negated clause without include_missing matches a missing key too', () => {
    const r = compile([mf({ key: 'env', op: 'not_equals', value: 'prod' })]);
    expect(r.conditions[0].startsWith('(NOT (')).toBe(true);
  });

  it('include_missing false requires the key to resolve', () => {
    const ne = compile([mf({ key: 'user.id', op: 'not_equals', value: '42', include_missing: false })]);
    expect(ne.conditions[0].startsWith('((JSONHas(metadata, {p_mfk0:String}) OR JSONHas(metadata, {p_mfk0s0:String}, {p_mfk0s1:String})) AND ')).toBe(true);
    const ni = compile([mf({ key: 'env', op: 'not_in', values: ['dev'], include_missing: false })]);
    expect(ni.conditions[0].startsWith('(JSONHas(metadata, {p_mfk0:String}) AND ')).toBe(true);
    // A resolved value without text (null, object, array) differs from every value.
    expect(ne.conditions[0].endsWith(' != {p_mfv0:String}, 1))')).toBe(true);
    expect(ni.conditions[0].endsWith(' NOT IN {p_mfv0:Array(String)}, 1))')).toBe(true);
  });

  it('exists checks both forms of a dotted key', () => {
    const r = compile([mf({ key: 'geo.city', op: 'exists' }), mf({ key: 'geo.city', op: 'not_exists' })]);
    expect(r.conditions[0]).toBe('(JSONHas(metadata, {p_mfk0:String}) OR JSONHas(metadata, {p_mfk0s0:String}, {p_mfk0s1:String}))');
    expect(r.conditions[1]).toBe('NOT ((JSONHas(metadata, {p_mfk1:String}) OR JSONHas(metadata, {p_mfk1s0:String}, {p_mfk1s1:String})))');
  });

  it('contains is a case-insensitive substring of the scalar text', () => {
    const r = compile([mf({ key: 'user.name', op: 'contains', value: 'ALI' })]);
    expect(r.conditions[0].startsWith('ifNull(positionCaseInsensitiveUTF8(multiIf(')).toBe(true);
    expect(r.conditions[0].endsWith(', {p_mfv0:String}), 0) > 0')).toBe(true);
    expect(r.queryParams.p_mfv0).toBe('ALI');
  });

  it('span columns are supported', () => {
    const r = compile([mf({ key: 'http.method', op: 'equals', value: 'GET' })], 'attributes');
    expect(r.conditions[0]).toContain('JSONHas(attributes, {p_mfk0:String})');
    expect(chJsonRawExpr('resource_attributes', { candidates: [['{k:String}']] })).toBe('JSONExtractRaw(resource_attributes, {k:String})');
    expect(chJsonExistsExpr('resource_attributes', { candidates: [['{k:String}'], ['{a:String}', '{b:String}']] })).toBe(
      '(JSONHas(resource_attributes, {k:String}) OR JSONHas(resource_attributes, {a:String}, {b:String}))',
    );
  });

  it('rejects an unknown column', () => {
    expect(() => compile([mf({ key: 'env', op: 'exists' })], 'message' as 'metadata')).toThrow('Unsupported JSON column');
    expect(() => chJsonRawExpr('metadata; DROP' as 'metadata', { candidates: [['{k:String}']] })).toThrow('Unsupported JSON column');
  });

  it('the log translator routes metadata filters through the resolver', () => {
    const translator = new ClickHouseQueryTranslator('logs');
    const r = translator.translateCount({
      projectId: 'p',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-02T00:00:00Z'),
      metadataFilters: [mf({ key: 'user.id', op: 'equals', value: '42' })],
    });
    expect(r.query).toContain('multiIf(JSONHas(metadata, {p_mfk0:String})');
    expect(r.query).not.toContain('JSONExtractString(metadata,');
  });
});
