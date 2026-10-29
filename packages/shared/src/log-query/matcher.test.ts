import { it, expect } from 'vitest';
import { matchesLogSearch } from './matcher.js';
import { ok } from './test-helpers.js';
import type { LogSearchQuery, MatchableLog } from './types.js';

const L = (o: Partial<MatchableLog>): MatchableLog => ({
  message: 'Request timeout after 30s',
  level: 'warn',
  service: 'api',
  ...o,
});
const m = (q: string, log: MatchableLog) => matchesLogSearch(log, ok(q));

it.each([
  ['TIMEOUT', {}, true],
  ['time', {}, false],
  ['user', { message: 'user_id 99' }, false],
  ['東京', { message: '東京リージョンで障害' }, false],
  ['"東京"', { message: '東京リージョンで障害' }, true],
  ['ошибка', { message: 'ОШИБКА повторилась' }, true],
  ['"QUEST TIME"', {}, true],
  ['10.0.0.1', { message: 'from 10.0.0.1 ok' }, true],
  ['timeout OR refused db', { message: 'refused by db' }, true],
  ['timeout OR refused db', {}, false],
  ['-timeout', {}, false],
  ['', {}, true],
  ['ÉCHOUÉ', { message: 'Paiement échoué pour la commande 77' }, true],
  ['-"after 30"', {}, false],
  ['-"after 31"', {}, true],
  ['a OR b c OR timeout', { message: 'b timeout' }, true],
  ['a OR b c OR d', { message: 'b timeout' }, false],
])('text %j on %j is %s', (q, o, expected) => expect(m(q, L(o))).toBe(expected));

it.each([
  ['level:(warn OR error)', {}, true],
  ['-service:api', {}, false],
  ['trace:t1', { traceId: 't1' }, true],
  ['span:s1', { spanId: null }, false],
  ['host:b', { hostname: 'a', metadata: { hostname: 'b' } }, true],
  ['host:a', { hostname: 'a', metadata: { hostname: 'b' } }, false],
  ['host:a', { hostname: 'a' }, true],
  ['host:a', { hostname: 'a', metadata: { hostname: 7 } }, true],
  ['service:API', {}, false],
  ['session:s1', { sessionId: 's1' }, true],
  ['-level:(debug OR info)', {}, true],
  ['-host:(a OR b)', { metadata: { hostname: 'a' } }, false],
])('built-in %j on %j is %s', (q, o, expected) => expect(m(q, L(o))).toBe(expected));

// spec 5.3 missing keys rule
it.each([
  ['-host:web-1', {}],
  ['-env:prod', { metadata: {} }],
  ['-env:(prod OR dev)', { metadata: null }],
  ['-user.id:42', {}],
  ['-user.id:*', { metadata: { user: {} } }],
  ['-tags:a', { metadata: { tags: ['a'] } }],
  ['-note:x', { metadata: { note: null } }],
])('negations include missing fields: %j on %j', (q, o) => expect(m(q, L(o))).toBe(true));

// spec 5.3 metadata key rule plus text form
const MD = {
  status: 500,
  ok: false,
  note: null,
  tags: ['a'],
  user: { id: '42' },
  'geo.city': 'literal',
  geo: { city: 'nested', zip: 89101 },
  reason: 'card_declined',
};
it.each([
  ['status:500', true],
  ['status:*50*', true],
  ['status:(200 OR 500)', true],
  ['ok:false', true],
  ['ok:true', false],
  ['note:*', true],
  ['note:null', false],
  ['tags:a', false],
  ['user:*', true],
  ['user.id:42', true],
  ['user.id:43', false],
  ['geo.city:literal', true],
  ['geo.city:nested', false],
  ['geo.zip:89101', true],
  ['reason:*CARD*', true],
  ['missing:*', false],
  ['-status:500', false],
  ['-status:(200 OR 404)', true],
  ['-reason:*', false],
  ['Status:500', false],
])('metadata %j is %s', (q, expected) => expect(m(q, L({ metadata: MD }))).toBe(expected));

it('ands every clause together', () => {
  const log = L({ metadata: { env: 'prod' }, traceId: 't1' });
  expect(m('timeout env:prod trace:t1 level:warn', log)).toBe(true);
  expect(m('timeout env:prod trace:t2 level:warn', log)).toBe(false);
});

it('handles hand-built clauses the parser never emits', () => {
  const q = (fields: LogSearchQuery['fields']): LogSearchQuery => ({ text: { all: [], anyOf: [], none: [] }, fields });
  expect(matchesLogSearch(L({}), q([{ field: { builtin: 'service' }, op: 'contains', value: 'P' }]))).toBe(true);
  expect(matchesLogSearch(L({}), q([{ field: { builtin: 'traceId' }, op: 'exists' }]))).toBe(false);
  expect(matchesLogSearch(L({}), q([{ field: { builtin: 'traceId' }, op: 'not_exists' }]))).toBe(true);
  expect(matchesLogSearch(L({}), q([{ field: { metadata: 'env' }, op: 'equals' }]))).toBe(false);
});
