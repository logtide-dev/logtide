import { describe, it, expect } from 'vitest';
import { bindJsonKey, compileJsonFilters, scalarTextExpr, type JsonColumn } from './json-path.js';
import type { MetadataFilter } from '../../core/types.js';

function mf(o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter {
  return { include_missing: false, ...o } as MetadataFilter;
}

/** The resolved jsonb of a two-segment key bound at $1: the literal key, then the nested path. */
const DOTTED_VALUE = 'COALESCE(metadata -> ($1::text[])[1], metadata -> ($1::text[])[2] -> ($1::text[])[3])';
const DOTTED_TEXT = `(${DOTTED_VALUE}) #>> '{}'`;
const DOTTED_EXISTS = `(${DOTTED_VALUE}) IS NOT NULL`;

describe('compileJsonFilters', () => {
  it('simple key keeps the existing ->> shape', () => {
    expect(compileJsonFilters([mf({ key: 'env', op: 'equals', value: 'prod' })], 'metadata', 1)).toEqual({
      conditions: ['(metadata->>$1 = $2)'],
      values: ['env', 'prod'],
      nextIdx: 3,
    });
  });

  it('simple keys keep every existing operator shape', () => {
    const shapes: [MetadataFilter, string][] = [
      [mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: true }), '(metadata->>$1 IS DISTINCT FROM $2)'],
      [mf({ key: 'env', op: 'not_equals', value: 'dev' }), '(metadata ? $1 AND metadata->>$1 <> $2)'],
      [mf({ key: 'env', op: 'in', values: ['a', 'b'] }), '(metadata->>$1 = ANY($2))'],
      [mf({ key: 'env', op: 'not_in', values: ['a'], include_missing: true }), '(metadata->>$1 IS NULL OR metadata->>$1 <> ALL($2))'],
      [mf({ key: 'env', op: 'not_in', values: ['a'] }), '(metadata ? $1 AND metadata->>$1 <> ALL($2))'],
      [mf({ key: 'env', op: 'exists' }), '(metadata ? $1)'],
      [mf({ key: 'env', op: 'not_exists', include_missing: true }), '(metadata IS NULL OR NOT (metadata ? $1))'],
      [mf({ key: 'env', op: 'contains', value: 'x' }), '(metadata->>$1 ILIKE $2)'],
    ];
    for (const [filter, sql] of shapes) {
      expect(compileJsonFilters([filter], 'metadata', 1).conditions, filter.op).toEqual([sql]);
    }
  });

  it('dotted key prefers the literal key then the nested path', () => {
    const r = compileJsonFilters([mf({ key: 'http.status', op: 'equals', value: '200' })], 'metadata', 1);
    expect(r.conditions).toEqual([`(${DOTTED_TEXT} = $2)`]);
    expect(r.values).toEqual([['http.status', 'http', 'status'], '200']);
    expect(r.nextIdx).toBe(3);
  });

  it('dotted exists checks both forms', () => {
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'exists' })], 'metadata', 1).conditions).toEqual([`(${DOTTED_EXISTS})`]);
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_exists', include_missing: true })], 'metadata', 1).conditions).toEqual([
      `(metadata IS NULL OR NOT (${DOTTED_EXISTS}))`,
    ]);
  });

  it('not_exists matches a record whose JSON column is NULL', () => {
    // `col ? key` is NULL on a NULL column; logs and spans without metadata or attributes store NULL.
    for (const key of ['env', 'user.id']) {
      const [sql] = compileJsonFilters([mf({ key, op: 'not_exists', include_missing: true })], 'attributes', 1).conditions;
      expect(sql.startsWith('(attributes IS NULL OR NOT ')).toBe(true);
    }
  });

  it('negated dotted clauses match when the key does not resolve', () => {
    // The text expression is NULL when the key does not resolve.
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_equals', value: '42', include_missing: true })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_TEXT} IS DISTINCT FROM $2)`,
    ]);
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_in', values: ['42'], include_missing: true })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_TEXT} IS NULL OR ${DOTTED_TEXT} <> ALL($2))`,
    ]);
  });

  it('not_equals include_missing false on a dotted key requires it to resolve', () => {
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_equals', value: '42' })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_EXISTS} AND ${DOTTED_TEXT} <> $2)`,
    ]);
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_in', values: ['42'] })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_EXISTS} AND ${DOTTED_TEXT} <> ALL($2))`,
    ]);
  });

  it('dotted in and contains use the resolved text', () => {
    const r = compileJsonFilters(
      [mf({ key: 'user.id', op: 'in', values: ['42', '43'] }), mf({ key: 'user.name', op: 'contains', value: '50%' })],
      'metadata',
      1,
    );
    expect(r.conditions).toEqual([
      `(${DOTTED_TEXT} = ANY($2))`,
      "((COALESCE(metadata -> ($3::text[])[1], metadata -> ($3::text[])[2] -> ($3::text[])[3])) #>> '{}' ILIKE $4)",
    ]);
    expect(r.values).toEqual([['user.id', 'user', 'id'], ['42', '43'], ['user.name', 'user', 'name'], '%50\\%%']);
  });

  it('binds keys and values, never inlines them', () => {
    const r = compileJsonFilters([mf({ key: "a'.b", op: 'equals', value: "x'; DROP TABLE logs; --" })], 'metadata', 1);
    expect(r.conditions[0]).not.toContain('DROP');
    expect(r.conditions[0]).not.toContain("a'");
  });

  it('works on span attribute columns', () => {
    for (const column of ['attributes', 'resource_attributes', 's.attributes', 's.resource_attributes'] as JsonColumn[]) {
      const r = compileJsonFilters([mf({ key: 'http.route', op: 'equals', value: '/x' })], column, 1);
      expect(r.conditions[0]).toBe(`((COALESCE(${column} -> ($1::text[])[1], ${column} -> ($1::text[])[2] -> ($1::text[])[3])) #>> '{}' = $2)`);
    }
  });

  it('rejects an unknown column', () => {
    expect(() => compileJsonFilters([], 'metadata; DROP TABLE logs' as JsonColumn, 1)).toThrow('Unsupported JSON column');
    expect(() => bindJsonKey('message' as JsonColumn, 'a', 1)).toThrow('Unsupported JSON column');
  });

  it('empty filter lists add nothing', () => {
    expect(compileJsonFilters([], 'metadata', 5)).toEqual({ conditions: [], values: [], nextIdx: 5 });
  });
});

describe('json expressions', () => {
  it('text, value and exists expressions for simple and dotted keys', () => {
    expect(bindJsonKey('metadata', 'env', 1)).toEqual({
      key: { value: 'metadata->$1', text: 'metadata->>$1', exists: 'metadata ? $1' },
      values: ['env'],
      nextIdx: 2,
    });
    expect(bindJsonKey('metadata', 'http.status', 1)).toEqual({
      key: { value: DOTTED_VALUE, text: DOTTED_TEXT, exists: DOTTED_EXISTS },
      values: [['http.status', 'http', 'status']],
      nextIdx: 2,
    });
  });

  it('a dotted key tries every shared candidate in order, as object member chains', () => {
    const { key, values } = bindJsonKey('attributes', 'resource.service.name', 4);
    expect(values).toEqual([['resource.service.name', 'resource.service', 'name', 'resource', 'service.name', 'resource', 'service', 'name']]);
    expect(key.value).toBe(
      'COALESCE(attributes -> ($4::text[])[1], ' +
        'attributes -> ($4::text[])[2] -> ($4::text[])[3], ' +
        'attributes -> ($4::text[])[4] -> ($4::text[])[5], ' +
        'attributes -> ($4::text[])[6] -> ($4::text[])[7] -> ($4::text[])[8])',
    );
    // Text keys on `->` read object members only: arrays are never indexed.
    expect(key.value).not.toContain('#>');
  });

  it('scalar text keeps strings, numbers and booleans only', () => {
    expect(scalarTextExpr('metadata->$1')).toBe(
      "CASE WHEN jsonb_typeof(metadata->$1) IN ('string', 'number', 'boolean') THEN (metadata->$1) #>> '{}' END",
    );
  });
});
