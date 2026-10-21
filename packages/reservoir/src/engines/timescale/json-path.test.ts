import { describe, it, expect } from 'vitest';
import {
  compileJsonFilters,
  jsonExistsExpr,
  jsonTextExpr,
  jsonValueExpr,
  scalarTextExpr,
  type JsonColumn,
} from './json-path.js';
import type { MetadataFilter } from '../../core/types.js';

function mf(o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter {
  return { include_missing: false, ...o } as MetadataFilter;
}

const DOTTED_TEXT = 'CASE WHEN metadata ? $1 THEN metadata->>$1 ELSE metadata #>> $2::text[] END';
const DOTTED_EXISTS = '(metadata ? $1 OR metadata #> $2::text[] IS NOT NULL)';

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
      [mf({ key: 'env', op: 'not_exists', include_missing: true }), '(NOT (metadata ? $1))'],
      [mf({ key: 'env', op: 'contains', value: 'x' }), '(metadata->>$1 ILIKE $2)'],
    ];
    for (const [filter, sql] of shapes) {
      expect(compileJsonFilters([filter], 'metadata', 1).conditions, filter.op).toEqual([sql]);
    }
  });

  it('dotted key prefers the literal key then the nested path', () => {
    const r = compileJsonFilters([mf({ key: 'http.status', op: 'equals', value: '200' })], 'metadata', 1);
    expect(r.conditions).toEqual([`(${DOTTED_TEXT} = $3)`]);
    expect(r.values).toEqual(['http.status', ['http', 'status'], '200']);
    expect(r.nextIdx).toBe(4);
  });

  it('dotted exists checks both forms', () => {
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'exists' })], 'metadata', 1).conditions).toEqual([`(${DOTTED_EXISTS})`]);
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_exists', include_missing: true })], 'metadata', 1).conditions).toEqual([
      `(NOT ${DOTTED_EXISTS})`,
    ]);
  });

  it('negated dotted clauses match when the key does not resolve', () => {
    // The text expression is NULL when the key does not resolve.
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_equals', value: '42', include_missing: true })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_TEXT} IS DISTINCT FROM $3)`,
    ]);
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_in', values: ['42'], include_missing: true })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_TEXT} IS NULL OR ${DOTTED_TEXT} <> ALL($3))`,
    ]);
  });

  it('not_equals include_missing false on a dotted key requires it to resolve', () => {
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_equals', value: '42' })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_EXISTS} AND ${DOTTED_TEXT} <> $3)`,
    ]);
    expect(compileJsonFilters([mf({ key: 'user.id', op: 'not_in', values: ['42'] })], 'metadata', 1).conditions).toEqual([
      `(${DOTTED_EXISTS} AND ${DOTTED_TEXT} <> ALL($3))`,
    ]);
  });

  it('dotted in and contains use the resolved text', () => {
    const r = compileJsonFilters(
      [mf({ key: 'user.id', op: 'in', values: ['42', '43'] }), mf({ key: 'user.name', op: 'contains', value: '50%' })],
      'metadata',
      1,
    );
    expect(r.conditions).toEqual([
      `(${DOTTED_TEXT} = ANY($3))`,
      '(CASE WHEN metadata ? $4 THEN metadata->>$4 ELSE metadata #>> $5::text[] END ILIKE $6)',
    ]);
    expect(r.values).toEqual(['user.id', ['user', 'id'], ['42', '43'], 'user.name', ['user', 'name'], '%50\\%%']);
  });

  it('binds keys and values, never inlines them', () => {
    const r = compileJsonFilters([mf({ key: "a'.b", op: 'equals', value: "x'; DROP TABLE logs; --" })], 'metadata', 1);
    expect(r.conditions[0]).not.toContain('DROP');
    expect(r.conditions[0]).not.toContain("a'");
  });

  it('works on span attribute columns', () => {
    for (const column of ['attributes', 'resource_attributes', 's.attributes', 's.resource_attributes'] as JsonColumn[]) {
      const r = compileJsonFilters([mf({ key: 'http.route', op: 'equals', value: '/x' })], column, 1);
      expect(r.conditions[0]).toBe(`(CASE WHEN ${column} ? $1 THEN ${column}->>$1 ELSE ${column} #>> $2::text[] END = $3)`);
    }
  });

  it('rejects an unknown column', () => {
    expect(() => compileJsonFilters([], 'metadata; DROP TABLE logs' as JsonColumn, 1)).toThrow('Unsupported JSON column');
    expect(() => jsonTextExpr('message' as JsonColumn, 1, null)).toThrow('Unsupported JSON column');
  });

  it('empty filter lists add nothing', () => {
    expect(compileJsonFilters([], 'metadata', 5)).toEqual({ conditions: [], values: [], nextIdx: 5 });
  });
});

describe('json expressions', () => {
  it('text, value and exists expressions for simple and dotted keys', () => {
    expect(jsonTextExpr('metadata', 1, null)).toBe('metadata->>$1');
    expect(jsonTextExpr('metadata', 1, 2)).toBe(DOTTED_TEXT);
    expect(jsonValueExpr('metadata', 1, null)).toBe('metadata->$1');
    expect(jsonValueExpr('metadata', 1, 2)).toBe('CASE WHEN metadata ? $1 THEN metadata->$1 ELSE metadata #> $2::text[] END');
    expect(jsonExistsExpr('metadata', 1, null)).toBe('metadata ? $1');
    expect(jsonExistsExpr('metadata', 1, 2)).toBe(DOTTED_EXISTS);
  });

  it('scalar text keeps strings, numbers and booleans only', () => {
    expect(scalarTextExpr('metadata->$1')).toBe(
      "CASE WHEN jsonb_typeof(metadata->$1) IN ('string', 'number', 'boolean') THEN (metadata->$1) #>> '{}' END",
    );
  });
});
