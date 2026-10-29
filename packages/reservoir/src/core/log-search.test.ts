import { describe, it, expect } from 'vitest';
import { parseLogQuery, metadataFiltersSchema } from '@logtide/shared';
import type { LogSearchQuery } from '@logtide/shared';
import { compileLogSearch, mergeCompiledSearch } from './log-search.js';
import type { CompiledLogSearch } from './log-search.js';
import type { MetadataFilter, QueryParams } from './types.js';

const c = (q: string) => {
  const r = parseLogQuery(q);
  if (!r.ok) throw new Error(r.error.message);
  return compileLogSearch(r.query);
};
const w = (value: string) => ({ kind: 'word' as const, value });
const ph = (value: string) => ({ kind: 'phrase' as const, value });
const EMPTY_TEXT = { all: [], anyOf: [], none: [] };

const T1 = (0x701).toString(16).padStart(32, '0');
const S1 = (0x7001).toString(16).padStart(16, '0');
const SESS1 = '00000000-0000-4000-8000-00000000c001';

/**
 * Inputs that parse OK: the q values of the conformance tables (text query,
 * field clauses, combinations) and the parser's field clause success rows.
 */
const ACCEPTED_QUERIES = [
  // text query conformance
  'timeout', 'connection', '"connection refused"', '"CONNECTION REFUSED"', '"conn"', 'timeout OR refused',
  'timeout OR refused db', '-timeout', 'payment -failed', 'ошибка', 'ÉCHOUÉ', '東京', '"東京"', 'user_id', 'user',
  'not', 'the', 'example', '10.0.0.1', '/api/v1/users', '12ms', 'error', 'error-prone', '"failed"', 'fail',
  'timeout OR refused -db', 'alice OR fox OR redis', 'timeout OR refused upstream OR redis', '"failed: card"',
  'Job finished: 12', '-"connection refused" -timeout', 'payment AND succeeded', 'timeout or refused',
  '-"api.example.com"', '"ошибка ПОВТОРИЛАСЬ"', 'service:(auth OR billing)', `trace:${T1}`,
  // field clause conformance
  'level:error', 'level:(warn OR critical)', '-level:info', '-level:(info OR debug)', 'service:worker',
  '-service:api', 'host:web-3', 'hostname:web-3', '-host:web-1', '-host:(web-1 OR web-2)', `trace_id:${T1}`,
  `span:${S1}`, `span_id:${S1}`, `session:${SESS1}`, `session_id:${SESS1}`, 'service:api level:error -host:web-2',
  'env:staging', '-env:prod', 'env:(staging OR dev)', '-env:(prod OR staging)', 'env:*', '-env:*', 'status:500',
  'status:(200 OR 504)', 'status:*50*', 'reason:*CARD*', 'user.id:42', 'http.method:GET', 'http.method:POST',
  'geo.city:literal', 'geo.city:nested', 'geo.city:"Las Vegas"', 'ok:false', 'ok:true', 'note:*', 'note:null',
  'tags:a', 'retries:3', 'user:*', '-user.id:42', 'disk.path:"/var/lib/data"', 'amount:1999 ok:true',
  'region:(eu OR ap) -level:error', '-geo.city:*', 'user.name:*ALI*', 'timeout -service:worker',
  'payment env:prod -ok:true',
  // parser field clause success rows
  'env:prod', 'msg:"hello world"', 'k:"*"', 'k:""', 'k:foo*', 'env:(a OR "b c")', '-env:(a OR b)', 'user.id:*',
  '-user.id:*', 'reason:*card*', 'path:a:b', 'service:a OR service:(b OR c)', 'k:**', 'k:*a*b*',
  'env:a OR env:"b c" OR env:d', 'level:ERROR', 'trace_id:abc', 'session:s1', 'span_id:x', 'service:api*',
  'level:(Warn OR ERROR)', '-level:Debug', 'Level:ERROR',
  // pasted text and the limits
  'Error: connect ECONNREFUSED 127.0.0.1:5432', 'https://api.example.com/v1', '10:42:13', 'fe80::1', 'level:',
  Array.from({ length: 10 }, (_, i) => `k${i}:v`).join(' '),
  `env:(${Array.from({ length: 50 }, (_, i) => `v${i}`).join(' OR ')})`,
  `k:${'x'.repeat(1000)}`,
  `${'k'.repeat(200)}:v`,
];

describe('compileLogSearch', () => {
  it.each([
    ['level:(warn OR error) service:api host:web-1 trace:t1 session:s1 span:x',
      { level: ['warn', 'error'], service: ['api'], hostname: ['web-1'], traceId: 't1', sessionId: 's1', spanId: 'x' }],
    ['-level:debug -level:(info OR debug) -service:a -host:h', { exclude: { level: ['debug', 'info'], service: ['a'], hostname: ['h'] } }],
    ['timeout OR refused db', { textQuery: { all: [{ kind: 'word', value: 'db' }], anyOf: [[{ kind: 'word', value: 'timeout' }, { kind: 'word', value: 'refused' }]], none: [] } }],
    ['', {}],
    ['   ', {}],
    ['"a b" -c -"d e"', { textQuery: { all: [ph('a b')], anyOf: [], none: [w('c'), ph('d e')] } }],
    ['hostname:web-1 trace_id:t session_id:s span_id:x', { hostname: ['web-1'], traceId: 't', sessionId: 's', spanId: 'x' }],
    ['service:a OR service:(b OR c)', { service: ['a', 'b', 'c'] }],
    ['service:a OR service:a', { service: ['a'] }],
    ['-host:(web-1 OR web-2) -hostname:web-1', { exclude: { hostname: ['web-1', 'web-2'] } }],
  ])('compiles %j', (q, expected) => expect(c(q)).toEqual(expected));

  it('omits empty parts entirely', () => {
    const out = c('timeout');
    expect(Object.keys(out)).toEqual(['textQuery']);
    expect(Object.keys(c('env:prod'))).toEqual(['metadataFilters']);
    expect(Object.keys(c('-service:a'))).toEqual(['exclude']);
    expect(Object.keys(c('-service:a')['exclude'] ?? {})).toEqual(['service']);
  });

  it('compiles metadata clauses with include_missing', () => {
    expect(c('env:prod -env:dev env:(a OR b) -env:(c OR d) user.id:* -x:* k:*v*').metadataFilters).toEqual([
      { key: 'env', op: 'equals', value: 'prod', include_missing: false },
      { key: 'env', op: 'not_equals', value: 'dev', include_missing: true },
      { key: 'env', op: 'in', values: ['a', 'b'], include_missing: false },
      { key: 'env', op: 'not_in', values: ['c', 'd'], include_missing: true },
      { key: 'user.id', op: 'exists', include_missing: false },
      { key: 'x', op: 'not_exists', include_missing: true },
      { key: 'k', op: 'contains', value: 'v', include_missing: false },
    ]);
  });

  it('emits only the properties each metadata op uses', () => {
    const filters = c('a:1 -b:2 c:(3 OR 4) -d:(5 OR 6) e:* -f:* g:*7*').metadataFilters ?? [];
    expect(filters.map((f) => Object.keys(f).sort())).toEqual([
      ['include_missing', 'key', 'op', 'value'],
      ['include_missing', 'key', 'op', 'value'],
      ['include_missing', 'key', 'op', 'values'],
      ['include_missing', 'key', 'op', 'values'],
      ['include_missing', 'key', 'op'],
      ['include_missing', 'key', 'op'],
      ['include_missing', 'key', 'op', 'value'],
    ]);
  });

  it('keeps metadata keys and values as typed', () => {
    expect(c('Level:ERROR k:"" geo.city:"Las Vegas" path:a:b').metadataFilters).toEqual([
      { key: 'Level', op: 'equals', value: 'ERROR', include_missing: false },
      { key: 'k', op: 'equals', value: '', include_missing: false },
      { key: 'geo.city', op: 'equals', value: 'Las Vegas', include_missing: false },
      { key: 'path', op: 'equals', value: 'a:b', include_missing: false },
    ]);
  });

  it.each(ACCEPTED_QUERIES)('every accepted query compiles and fits metadataFiltersSchema: %j', (q) => {
    const compiled = c(q);
    expect(metadataFiltersSchema.safeParse(compiled.metadataFilters ?? []).success).toBe(true);
  });

  it('the schema round trip keeps every compiled filter as is', () => {
    const filters = c('env:prod -env:dev env:(a OR b) -env:(c OR d) user.id:* -x:* k:*v*').metadataFilters ?? [];
    expect(metadataFiltersSchema.parse(filters)).toEqual(filters);
  });

  it('does not share arrays with the parsed query', () => {
    const r = parseLogQuery('a OR b c -d service:(x OR y) -level:debug env:(p OR q)');
    if (!r.ok) throw new Error(r.error.message);
    const snapshot = structuredClone(r.query);
    const out = compileLogSearch(r.query);
    out.textQuery?.all.push(w('zz'));
    out.textQuery?.anyOf[0]?.push(w('zz'));
    out.textQuery?.none.push(w('zz'));
    (out.service as string[]).push('zz');
    out.exclude?.level?.push('info');
    const inList = out.metadataFilters?.[0];
    if (inList && inList.values) inList.values.push('zz');
    expect(r.query).toEqual(snapshot);
  });

  it('rejects hand-built unsupported built-in ops', () => {
    expect(() => compileLogSearch({ text: { all: [], anyOf: [], none: [] }, fields: [{ field: { builtin: 'service' }, op: 'contains', value: 'a' }] })).toThrow(RangeError);
  });

  const field = (f: LogSearchQuery['fields'][number]): LogSearchQuery => ({ text: EMPTY_TEXT, fields: [f] });
  it.each([
    ['exists on service', field({ field: { builtin: 'service' }, op: 'exists' })],
    ['not_exists on level', field({ field: { builtin: 'level' }, op: 'not_exists' })],
    ['in on trace', field({ field: { builtin: 'traceId' }, op: 'in', values: ['a'] })],
    ['not_equals on session', field({ field: { builtin: 'sessionId' }, op: 'not_equals', value: 'a' })],
    ['not_in on span', field({ field: { builtin: 'spanId' }, op: 'not_in', values: ['a'] })],
    ['contains on span', field({ field: { builtin: 'spanId' }, op: 'contains', value: 'a' })],
    ['unknown level value', field({ field: { builtin: 'level' }, op: 'equals', value: 'fatal' })],
    ['unknown excluded level value', field({ field: { builtin: 'level' }, op: 'not_in', values: ['ERROR'] })],
    ['equals without a value', field({ field: { builtin: 'service' }, op: 'equals' })],
    ['metadata equals without a value', field({ field: { metadata: 'env' }, op: 'equals' })],
    ['metadata contains without a value', field({ field: { metadata: 'env' }, op: 'contains' })],
    ['an empty in-list', field({ field: { metadata: 'env' }, op: 'in', values: [] })],
    ['an empty built-in in-list', field({ field: { builtin: 'service' }, op: 'in', values: [] })],
    ['an invalid metadata key', field({ field: { metadata: 'bad key' }, op: 'exists' })],
    ['an unknown built-in', field({ field: { builtin: 'message' as never }, op: 'equals', value: 'a' })],
    ['two positive service clauses', {
      text: EMPTY_TEXT,
      fields: [
        { field: { builtin: 'service' as const }, op: 'equals' as const, value: 'a' },
        { field: { builtin: 'service' as const }, op: 'in' as const, values: ['a', 'b'] },
      ],
    }],
    ['two trace clauses', {
      text: EMPTY_TEXT,
      fields: [
        { field: { builtin: 'traceId' as const }, op: 'equals' as const, value: 'a' },
        { field: { builtin: 'traceId' as const }, op: 'equals' as const, value: 'a' },
      ],
    }],
  ])('rejects a hand-built query with %s', (_name, query) => {
    expect(() => compileLogSearch(query)).toThrow(RangeError);
  });

  it('accepts hand-built repeated negative built-ins and unions them', () => {
    expect(compileLogSearch({
      text: EMPTY_TEXT,
      fields: [
        { field: { builtin: 'service' }, op: 'not_equals', value: 'a' },
        { field: { builtin: 'service' }, op: 'not_in', values: ['b', 'a'] },
        { field: { builtin: 'service' }, op: 'equals', value: 'c' },
      ],
    })).toEqual({ service: ['c'], exclude: { service: ['a', 'b'] } });
  });
});

describe('mergeCompiledSearch', () => {
  it.each([
    [{ service: 'api' }, { service: ['api', 'auth'] }, { service: ['api'] }],
    [{ service: ['api', 'auth'] }, { service: ['auth', 'billing'] }, { service: ['auth'] }],
    [{}, { hostname: ['h'] }, { hostname: ['h'] }],
    [{ level: ['error'] }, { level: ['warn'] }, { matchNothing: true }],
    [{ traceId: 'a' }, { traceId: 'b' }, { matchNothing: true }],
    [{ traceId: 'a' }, { traceId: 'a' }, { traceId: 'a' }],
    [{ exclude: { service: ['x'] } }, { exclude: { service: ['y'], level: ['debug'] } }, { exclude: { service: ['x', 'y'], level: ['debug'] } }],
  ])('merge narrows, never widens: %j + %j', (base, compiled, expected) =>
    expect(mergeCompiledSearch({ projectId: 'p', ...base } as any, compiled as any)).toEqual({ projectId: 'p', ...expected }));

  it.each([
    ['base order wins', { service: ['b', 'a', 'c'] }, { service: ['c', 'a'] }, { service: ['a', 'c'] }],
    ['a base string not in the list', { level: 'error' }, { level: ['warn', 'critical'] }, { matchNothing: true }],
    ['a base string and a compiled string', { hostname: 'h' }, { hostname: 'h' }, { hostname: ['h'] }],
    ['a base list only', { service: ['a', 'b'] }, {}, { service: ['a', 'b'] }],
    ['a base string only', { level: 'info' }, {}, { level: 'info' }],
    ['duplicates collapse', { service: ['a', 'a', 'b'] }, { service: ['a'] }, { service: ['a'] }],
    ['an empty base list', { service: [] }, { service: ['a'] }, { matchNothing: true }],
    ['session agrees', { sessionId: 's' }, { sessionId: 's' }, { sessionId: 's' }],
    ['session disagrees', { sessionId: 's' }, { sessionId: 't' }, { matchNothing: true }],
    ['span disagrees', { spanId: 'x' }, { spanId: 'y' }, { matchNothing: true }],
    ['span from the query only', {}, { spanId: 'y' }, { spanId: 'y' }],
    ['trace from the base only', { traceId: 'a' }, {}, { traceId: 'a' }],
    ['exclude from the query only', {}, { exclude: { hostname: ['h'] } }, { exclude: { hostname: ['h'] } }],
    ['exclude unions without duplicates', { exclude: { level: ['debug', 'info'] } }, { exclude: { level: ['info', 'warn'] } }, { exclude: { level: ['debug', 'info', 'warn'] } }],
  ])('merge: %s', (_name, base, compiled, expected) =>
    expect(mergeCompiledSearch({ projectId: 'p', ...base } as any, compiled as any)).toEqual({ projectId: 'p', ...expected }));

  it('an empty intersection omits only that field and keeps the others', () => {
    const out = mergeCompiledSearch(
      { projectId: 'p', level: ['error'], service: 'api', limit: 5 },
      { level: ['warn'], service: ['api'], metadataFilters: [{ key: 'a', op: 'exists', include_missing: false }] },
    );
    expect(out).toEqual({
      projectId: 'p', limit: 5, matchNothing: true, service: ['api'],
      metadataFilters: [{ key: 'a', op: 'exists', include_missing: false }],
    });
    expect(out).not.toHaveProperty('level');
  });

  it('keeps a base matchNothing', () => {
    expect(mergeCompiledSearch({ projectId: 'p', matchNothing: true }, { service: ['a'] })).toEqual({ projectId: 'p', matchNothing: true, service: ['a'] });
  });

  it('passes every other base field through', () => {
    const from = new Date(0);
    const to = new Date(1);
    const filters = [{ field: 'x', operator: '=' as const, value: 1 }];
    const base: Partial<QueryParams> = {
      projectId: ['p', 'q'], from, to, fromExclusive: true, toExclusive: true, limit: 7, offset: 3, cursor: 'c',
      sortBy: 'time', sortOrder: 'asc', filters,
    };
    const out = mergeCompiledSearch(base, {});
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect(out.from).toBe(from);
  });

  it('merge concatenates metadata filters and text, folds legacy search, does not mutate', () => {
    const f1 = { key: 'a', op: 'exists' as const, include_missing: false };
    const f2 = { key: 'b', op: 'exists' as const, include_missing: false };
    const base = { projectId: 'p', search: 'redis', metadataFilters: [f1] };
    const copy = structuredClone(base);
    const out = mergeCompiledSearch(base, { metadataFilters: [f2], textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [], none: [] } });
    expect(base).toEqual(copy);
    expect(out).toEqual({ projectId: 'p', metadataFilters: [f1, f2], textQuery: { all: [{ kind: 'word', value: 'redis' }, { kind: 'word', value: 'timeout' }], anyOf: [], none: [] } });
  });

  it('folds legacy search even without a compiled text query', () => {
    expect(mergeCompiledSearch({ projectId: 'p', search: 'conn ref', searchMode: 'substring' }, { service: ['a'] }))
      .toEqual({ projectId: 'p', service: ['a'], textQuery: { all: [ph('conn ref')], anyOf: [], none: [] } });
    const out = mergeCompiledSearch({ projectId: 'p', search: '  ', searchMode: 'fulltext' }, {});
    expect(out).toEqual({ projectId: 'p' });
    expect(out).not.toHaveProperty('search');
    expect(out).not.toHaveProperty('searchMode');
  });

  it('a base textQuery wins over a base search, like the client', () => {
    const tq = { all: [w('a')], anyOf: [[w('b'), ph('c d')]], none: [w('e')] };
    expect(mergeCompiledSearch({ projectId: 'p', search: 'ignored', textQuery: tq }, { textQuery: { all: [w('f')], anyOf: [[w('g')]], none: [ph('h')] } }))
      .toEqual({ projectId: 'p', textQuery: { all: [w('a'), w('f')], anyOf: [[w('b'), ph('c d')], [w('g')]], none: [w('e'), ph('h')] } });
  });

  it('drops an empty merged text query', () => {
    expect(mergeCompiledSearch({ projectId: 'p', textQuery: { all: [], anyOf: [], none: [] } }, { textQuery: EMPTY_TEXT })).toEqual({ projectId: 'p' });
  });

  it('never mutates or aliases base arrays', () => {
    const f1: MetadataFilter = { key: 'a', op: 'in', values: ['1'], include_missing: false };
    const tq = { all: [w('a')], anyOf: [[w('b')]], none: [] };
    const base: Partial<QueryParams> = {
      projectId: 'p', service: ['a', 'b'], exclude: { level: ['debug'] }, metadataFilters: [f1], textQuery: tq,
    };
    const copy = structuredClone(base);
    const out = mergeCompiledSearch(base, {
      service: ['b'], exclude: { level: ['info'], service: ['z'] }, metadataFilters: [{ key: 'b', op: 'exists', include_missing: false }],
      textQuery: { all: [w('c')], anyOf: [[w('d')]], none: [w('e')] },
    });
    expect(base).toEqual(copy);
    out.metadataFilters?.push({ key: 'c', op: 'exists', include_missing: false });
    out.textQuery?.all.push(w('zz'));
    out.textQuery?.anyOf.push([w('zz')]);
    out.exclude?.level?.push('warn');
    expect(base).toEqual(copy);
  });

  it('a compiled search from the grammar narrows a typed alert scope (create alert from this search)', () => {
    const r = parseLogQuery('service:(auth OR billing) -level:debug timeout env:prod');
    if (!r.ok) throw new Error(r.error.message);
    const compiled: CompiledLogSearch = compileLogSearch(r.query);
    expect(mergeCompiledSearch({ projectId: 'p', service: ['api', 'auth'], level: ['error', 'warn'] }, compiled)).toEqual({
      projectId: 'p',
      service: ['auth'],
      level: ['error', 'warn'],
      exclude: { level: ['debug'] },
      metadataFilters: [{ key: 'env', op: 'equals', value: 'prod', include_missing: false }],
      textQuery: { all: [w('timeout')], anyOf: [], none: [] },
    });
  });

  it('is exported from the package index', async () => {
    const r = await import('../index.js');
    expect(r.compileLogSearch).toBe(compileLogSearch);
    expect(r.mergeCompiledSearch).toBe(mergeCompiledSearch);
  });
});
