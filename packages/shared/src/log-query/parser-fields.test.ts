import { it, expect } from 'vitest';
import { parseLogQuery } from './parser.js';
import { ok, expectError } from './test-helpers.js';

const md = (k: string) => ({ metadata: k });
const b = (f: string) => ({ builtin: f });

it.each([
  ['env:prod', { field: md('env'), op: 'equals', value: 'prod' }],
  ['-env:prod', { field: md('env'), op: 'not_equals', value: 'prod' }],
  ['msg:"hello world"', { field: md('msg'), op: 'equals', value: 'hello world' }],
  ['k:"*"', { field: md('k'), op: 'equals', value: '*' }],
  ['k:""', { field: md('k'), op: 'equals', value: '' }],
  ['k:foo*', { field: md('k'), op: 'equals', value: 'foo*' }],
  ['env:(a OR "b c")', { field: md('env'), op: 'in', values: ['a', 'b c'] }],
  ['-env:(a OR b)', { field: md('env'), op: 'not_in', values: ['a', 'b'] }],
  ['user.id:*', { field: md('user.id'), op: 'exists' }],
  ['-user.id:*', { field: md('user.id'), op: 'not_exists' }],
  ['reason:*card*', { field: md('reason'), op: 'contains', value: 'card' }],
  ['user.id:42', { field: md('user.id'), op: 'equals', value: '42' }],
  ['path:a:b', { field: md('path'), op: 'equals', value: 'a:b' }],
  ['service:a OR service:(b OR c)', { field: b('service'), op: 'in', values: ['a', 'b', 'c'] }],
  ['k:**', { field: md('k'), op: 'equals', value: '**' }],
  ['k:*a*b*', { field: md('k'), op: 'contains', value: 'a*b' }],
  ['env:a OR env:"b c" OR env:d', { field: md('env'), op: 'in', values: ['a', 'b c', 'd'] }],
])('parses %j', (q, clause) => expect(ok(q).fields).toEqual([clause]));

// spec 5.3 built-in operator rule, table driven over every operator form
const FORMS = ['K:V', '-K:V', 'K:(V OR W)', '-K:(V OR W)', 'K:*', '-K:*', 'K:*V*'] as const;
const ALLOWED: Record<string, boolean[]> = {
  level: [true, true, true, true, false, false, false],
  service: [true, true, true, true, false, false, false],
  host: [true, true, true, true, false, false, false],
  hostname: [true, true, true, true, false, false, false],
  trace: [true, false, false, false, false, false, false],
  trace_id: [true, false, false, false, false, false, false],
  session: [true, false, false, false, false, false, false],
  session_id: [true, false, false, false, false, false, false],
  span: [true, false, false, false, false, false, false],
  span_id: [true, false, false, false, false, false, false],
};
it.each(Object.keys(ALLOWED).flatMap((k) => FORMS.map((f, i) => [k, f, ALLOWED[k][i]] as const)))(
  'built-in %s with %s allowed=%s',
  (key, form, allowed) => {
    const [v, w] = key === 'level' ? ['error', 'warn'] : ['x', 'y'];
    const q = form.replace('K', key).replace('V', v).replace('W', w);
    const r = parseLogQuery(q);
    expect(r.ok).toBe(allowed);
    if (!r.ok)
      expect(r.error.message).toBe(
        ['trace', 'trace_id', 'session', 'session_id', 'span', 'span_id'].includes(key)
          ? `The ${key} field supports only ${key}:value`
          : `The ${key} field supports only ${key}:value, -${key}:value and ${key}:(a OR b)`
      );
  }
);
it('the negated contains form is a built-in operator error too', () => {
  expectError('-service:*x*', 'The service field supports only service:value, -service:value and service:(a OR b)', 0);
  expectError('-span:*x*', 'The span field supports only span:value', 0);
});
it('a merged OR on an equals-only built-in is an operator error', () => {
  expectError('trace:a OR trace:b', 'The trace field supports only trace:value', 0);
});

it.each([
  ['level:ERROR', { field: b('level'), op: 'equals', value: 'error' }],
  ['host:web-1', { field: b('hostname'), op: 'equals', value: 'web-1' }],
  ['trace_id:abc', { field: b('traceId'), op: 'equals', value: 'abc' }],
  ['session:s1', { field: b('sessionId'), op: 'equals', value: 's1' }],
  ['span_id:x', { field: b('spanId'), op: 'equals', value: 'x' }],
  ['service:api*', { field: b('service'), op: 'equals', value: 'api*' }],
  ['level:(Warn OR ERROR)', { field: b('level'), op: 'in', values: ['warn', 'error'] }],
  ['-level:Debug', { field: b('level'), op: 'not_equals', value: 'debug' }],
  ['Level:ERROR', { field: md('Level'), op: 'equals', value: 'ERROR' }],
])('maps built-in %j', (q, clause) => expect(ok(q).fields).toEqual([clause]));

it('allows repeated negative built-ins and repeated metadata keys', () => {
  expect(ok('-level:debug -level:info env:a env:b').fields).toHaveLength(4);
});

it.each([
  ['-env:*x*', 'Excluding a *text* match is not supported', 0],
  ['level:warning', 'Unknown level "warning" (use debug, info, warn, error or critical)', 0],
  ['level:(warn OR fatal)', 'Unknown level "fatal" (use debug, info, warn, error or critical)', 0],
  ['service:a service:b', 'The service field is already filtered (use service:(a OR b))', 10],
  ['host:a hostname:b', 'The hostname field is already filtered (use hostname:(a OR b))', 7],
  ['service:a OR env:b', 'OR can only join free-text terms, or values of the same field; use key:(a OR b)', 10],
  ['env:*x* OR env:y', 'OR can only join free-text terms, or values of the same field; use key:(a OR b)', 8],
  ['env:* OR env:y', 'OR can only join free-text terms, or values of the same field; use key:(a OR b)', 6],
  ['-env:a OR -env:b', 'OR cannot join excluded terms', 7],
  ['x level:error -level:warn level:(info OR debug)', 'The level field is already filtered (use level:(a OR b))', 26],
])('rejects %j', (q, message, position) => expectError(q, message, position));

it('enforces the metadataFilterSchema limits with positions', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `k${i}:v`).join(' ');
  expectError(eleven, 'Too many field filters (max 10)', eleven.indexOf('k10:'));
  expectError(`k:(${Array.from({ length: 51 }, (_, i) => `v${i}`).join(' OR ')})`, 'Too many values in a list (max 50)', 2);
  expectError(`k:${'v'.repeat(1001)}`, 'Value is too long (max 1,000 characters)', 0);
  expectError(`${'k'.repeat(201)}:v`, 'Field name is too long (max 200 characters)', 0);
});

it('accepts values and lists at the limits', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `k${i}:v`).join(' ');
  expect(ok(`${ten} service:a -level:debug`).fields).toHaveLength(12);
  expect(ok(`k:(${Array.from({ length: 50 }, (_, i) => `v${i}`).join(' OR ')})`).fields).toHaveLength(1);
  expect(ok(`k:${'v'.repeat(1000)}`).fields).toHaveLength(1);
  expect(ok(`${'k'.repeat(200)}:v`).fields).toHaveLength(1);
});

it('counts a merged OR chain as one metadata clause and checks its total size', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `k${i}:v`).join(' ');
  expect(ok(`${nine} env:a OR env:b`).fields).toHaveLength(10);
  const list = `env:(${Array.from({ length: 50 }, (_, i) => `v${i}`).join(' OR ')})`;
  expectError(`env:x OR ${list}`, 'Too many values in a list (max 50)', 13);
});

it('pasted log line', () => {
  expect(ok('Error: connect ECONNREFUSED 127.0.0.1:5432')).toEqual({
    text: {
      all: [
        { kind: 'phrase', value: 'Error:' },
        { kind: 'word', value: 'connect' },
        { kind: 'word', value: 'ECONNREFUSED' },
        { kind: 'phrase', value: '127.0.0.1:5432' },
      ],
      anyOf: [],
      none: [],
    },
    fields: [],
  });
});

it.each(['https://api.example.com/v1', '10:42:13', 'fe80::1', 'level:'])('%j is free text', (q) => {
  expect(ok(q)).toEqual({ text: { all: [{ kind: 'phrase', value: q }], anyOf: [], none: [] }, fields: [] });
});

it('combines text and fields', () => {
  const q = ok('timeout OR refused db -service:worker env:(prod OR staging)');
  expect(q.text.anyOf).toHaveLength(1);
  expect(q.fields).toHaveLength(2);
});

it('marks a failing field clause as one error token', () => {
  expect(parseLogQuery('x service:a service:b').tokens).toEqual([
    { kind: 'word', start: 0, end: 1 },
    { kind: 'field', start: 2, end: 11 },
    { kind: 'error', start: 12, end: 21 },
  ]);
  expect(parseLogQuery('-trace:x').tokens).toEqual([{ kind: 'error', start: 0, end: 8 }]);
});
