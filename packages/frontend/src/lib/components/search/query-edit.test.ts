import { describe, it, expect } from 'vitest';
import { parseLogQuery, type FieldClause } from '@logtide/shared';
import {
  BUILTIN_QUERY_KEYS,
  KEY_ALIASES,
  fieldKeyOf,
  isQueryableKey,
  quoteQueryValue,
  quotePhrase,
  formatFieldClause,
  appendClause,
  getFieldValues,
  toggleFieldValue,
  setFieldValues,
} from './query-edit';

function parsed(r: string) {
  const res = parseLogQuery(r);
  if (res.ok === false) throw new Error(`expected ${JSON.stringify(r)} to parse: ${res.error.message}`);
  return res.query;
}

const sortKey = (c: FieldClause) => JSON.stringify(c);

/** Field clauses of `r`, sorted so comparisons are order-insensitive. */
function fields(r: string): FieldClause[] {
  return [...parsed(r).fields].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function sorted(list: FieldClause[]): FieldClause[] {
  return [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

describe('query-edit constants', () => {
  it('lists the built-in grammar keys and their aliases', () => {
    expect([...BUILTIN_QUERY_KEYS]).toEqual(['level', 'service', 'host', 'trace', 'session', 'span']);
    expect(KEY_ALIASES).toEqual({ host: ['hostname'], trace: ['trace_id'], session: ['session_id'], span: ['span_id'] });
  });
});

describe('fieldKeyOf', () => {
  it('maps built-in fields to grammar keys', () => {
    expect(fieldKeyOf({ builtin: 'hostname' })).toBe('host');
    expect(fieldKeyOf({ builtin: 'traceId' })).toBe('trace');
    expect(fieldKeyOf({ builtin: 'sessionId' })).toBe('session');
    expect(fieldKeyOf({ builtin: 'spanId' })).toBe('span');
    expect(fieldKeyOf({ builtin: 'level' })).toBe('level');
    expect(fieldKeyOf({ builtin: 'service' })).toBe('service');
    expect(fieldKeyOf({ metadata: 'user.id' })).toBe('user.id');
  });
});

describe('getFieldValues', () => {
  it('reads include and exclude values, aliases included', () =>
    expect(getFieldValues('hostname:a -host:b timeout', 'host')).toEqual({ include: ['a'], exclude: ['b'] }));

  it('reads in-lists', () =>
    expect(getFieldValues('level:(error OR critical)', 'level').include).toEqual(['error', 'critical']));

  it('reads negated in-lists of metadata keys', () =>
    expect(getFieldValues('-env:(a OR "b c")', 'env')).toEqual({ include: [], exclude: ['a', 'b c'] }));

  it('returns empty lists on a parse error', () =>
    expect(getFieldValues('level:(', 'level')).toEqual({ include: [], exclude: [] }));
});

describe('toggleFieldValue', () => {
  it('adds an include clause and keeps the free text', () => {
    const r = toggleFieldValue('timeout', 'service', 'api', 'include');
    expect(fields(r)).toEqual([{ field: { builtin: 'service' }, op: 'equals', value: 'api' }]);
    expect(parsed(r).text.all).toEqual([{ kind: 'word', value: 'timeout' }]);
  });

  it('merges a second include value into an in-list', () =>
    expect(fields(toggleFieldValue('service:api', 'service', 'web', 'include'))).toEqual([
      { field: { builtin: 'service' }, op: 'in', values: ['api', 'web'] },
    ]));

  it('removes a value toggled twice', () =>
    expect(fields(toggleFieldValue('service:api', 'service', 'api', 'include'))).toEqual([]));

  it('moves a value from include to exclude', () =>
    expect(fields(toggleFieldValue('level:(error OR warn)', 'level', 'warn', 'exclude'))).toEqual(
      sorted([
        { field: { builtin: 'level' }, op: 'equals', value: 'error' },
        { field: { builtin: 'level' }, op: 'not_equals', value: 'warn' },
      ]),
    ));

  it('moves a value from exclude to include', () =>
    expect(fields(toggleFieldValue('-service:api', 'service', 'api', 'include'))).toEqual([
      { field: { builtin: 'service' }, op: 'equals', value: 'api' },
    ]));

  it('edits alias clauses through the canonical key', () =>
    expect(fields(toggleFieldValue('hostname:a', 'host', 'b', 'include'))).toEqual([
      { field: { builtin: 'hostname' }, op: 'in', values: ['a', 'b'] },
    ]));

  it('quotes metadata values that need it', () =>
    expect(fields(toggleFieldValue('', 'user.name', 'Ada Lovelace', 'exclude'))).toEqual([
      { field: { metadata: 'user.name' }, op: 'not_equals', value: 'Ada Lovelace' },
    ]));

  it('leaves an unparseable query unchanged', () =>
    expect(toggleFieldValue('level:(', 'level', 'error', 'include')).toBe('level:('));

  it('leaves the query unchanged for an unqueryable key', () =>
    expect(toggleFieldValue('timeout', 'a b', 'x', 'include')).toBe('timeout'));

  it('never produces a query the grammar rejects', () => {
    // trace supports equals only: a second value or an exclusion would not parse.
    expect(toggleFieldValue('trace:abc', 'trace', 'def', 'include')).toBe('trace:abc');
    expect(toggleFieldValue('timeout', 'trace', 'abc', 'exclude')).toBe('timeout');
  });
});

describe('setFieldValues', () => {
  it('replaces every clause of the key', () =>
    expect(fields(setFieldValues('service:a -hostname:x host:y timeout', 'host', ['h1', 'h2'], ['h3']))).toEqual(
      sorted([
        { field: { builtin: 'service' }, op: 'equals', value: 'a' },
        { field: { builtin: 'hostname' }, op: 'in', values: ['h1', 'h2'] },
        { field: { builtin: 'hostname' }, op: 'not_equals', value: 'h3' },
      ]),
    ));

  it('clears the key when both lists are empty', () =>
    expect(setFieldValues('level:error timeout', 'level', [], [])).toBe('timeout'));
});

describe('formatFieldClause and appendClause', () => {
  it('formats clauses', () => {
    expect(formatFieldClause('service', ['api'], false)).toBe('service:api');
    expect(formatFieldClause('service', ['api'], true)).toBe('-service:api');
    expect(formatFieldClause('level', ['error', 'critical'], false)).toBe('level:(error OR critical)');
    expect(formatFieldClause('env', ['a b', 'c'], true)).toBe('-env:("a b" OR c)');
    expect(formatFieldClause('env', [], false)).toBe('');
  });

  it('quotes OR and AND inside in-lists', () =>
    expect(fields(formatFieldClause('env', ['OR', 'AND', 'x'], false))).toEqual([
      { field: { metadata: 'env' }, op: 'in', values: ['OR', 'AND', 'x'] },
    ]));

  it('appends with a single space', () => {
    expect(appendClause('  timeout  ', 'service:api')).toBe('timeout service:api');
    expect(appendClause('', 'service:api')).toBe('service:api');
    expect(appendClause('timeout', '')).toBe('timeout');
  });
});

const ROUND_TRIP = ['api', 'my-service', '-neg', 'two words', 'a"b', 'back\\slash', 'a:b', '(x)', '*', 'a*b', 'OR',
  'ünïcødé', '10.0.0.1', 'user@example.com', 'C:\\path'];

describe('value quoting', () => {
  it.each(ROUND_TRIP)('quoteQueryValue round-trips %j', (v) =>
    expect(fields(`k:${quoteQueryValue(v)}`)).toEqual([{ field: { metadata: 'k' }, op: 'equals', value: v }]));

  it.each(ROUND_TRIP)('quotePhrase round-trips %j', (v) =>
    expect(parsed(quotePhrase(v)).text.all).toEqual([{ kind: 'phrase', value: v }]));

  it.each(ROUND_TRIP)('an in-list round-trips %j', (v) =>
    expect(fields(formatFieldClause('k', [v, 'other'], false))).toEqual([
      { field: { metadata: 'k' }, op: 'in', values: [v, 'other'] },
    ]));

  it('keeps bare-safe values bare', () => {
    expect(quoteQueryValue('api')).toBe('api');
    expect(quotePhrase('api')).toBe('"api"');
  });
});

describe('isQueryableKey', () => {
  it('accepts and rejects keys', () => {
    for (const key of ['user.id', 'http_status', 'geo.city', 'level', 'host', 'hostname', 'trace']) {
      expect(isQueryableKey(key), key).toBe(true);
    }
    for (const key of ['a b', 'a:b', '', '-x', 'user@host', 'trailing.', 'a(b)']) {
      expect(isQueryableKey(key), key).toBe(false);
    }
  });
});
