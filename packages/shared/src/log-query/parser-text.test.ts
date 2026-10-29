import { it, expect } from 'vitest';
import { parseLogQuery, legacySubstringQuery } from './parser.js';
import { ok, expectError, expectTokenCoverage, TOKEN_INPUTS } from './test-helpers.js';

const w = (value: string) => ({ kind: 'word', value });
const p = (value: string) => ({ kind: 'phrase', value });

it('empty input is the empty query', () =>
  expect(ok('   ')).toEqual({ text: { all: [], anyOf: [], none: [] }, fields: [] }));

it.each([
  ['timeout', { all: [w('timeout')], anyOf: [], none: [] }],
  ['"connection refused"', { all: [p('connection refused')], anyOf: [], none: [] }],
  [
    '10.0.0.1 /api/v1/users error-prone foo*',
    { all: [p('10.0.0.1'), p('/api/v1/users'), p('error-prone'), p('foo*')], anyOf: [], none: [] },
  ],
  ['-word -"a b"', { all: [], anyOf: [], none: [w('word'), p('a b')] }],
  ['a - b --verbose', { all: [w('a'), p('-'), w('b'), p('--verbose')], anyOf: [], none: [] }],
  ['"a"b ""', { all: [p('a'), w('b')], anyOf: [], none: [] }],
  ['timeout OR refused db', { all: [w('db')], anyOf: [[w('timeout'), w('refused')]], none: [] }],
  [
    'a OR b c OR "d e" OR f',
    {
      all: [],
      anyOf: [
        [w('a'), w('b')],
        [w('c'), p('d e'), w('f')],
      ],
      none: [],
    },
  ],
  ['payment AND succeeded', { all: [w('payment'), w('succeeded')], anyOf: [], none: [] }],
  ['timeout or refused', { all: [w('timeout'), w('or'), w('refused')], anyOf: [], none: [] }],
  ['ÉCHOUÉ 東京', { all: [w('ÉCHOUÉ'), w('東京')], anyOf: [], none: [] }],
])('parses %j', (q, text) => expect(ok(q).text).toEqual(text));

it.each([
  ['OR timeout', 'OR needs a term on both sides', 0],
  ['timeout OR', 'OR needs a term on both sides', 8],
  ['a OR OR b', 'OR needs a term on both sides', 2],
  ['AND a', 'AND needs a term on both sides', 0],
  ['-a OR b', 'OR cannot join excluded terms', 3],
  ['a OR env:x', 'OR can only join free-text terms, or values of the same field; use key:(a OR b)', 2],
])('rejects %j', (q, message, position) => expectError(q, message, position));

it.each(TOKEN_INPUTS)('tokens cover every non-whitespace char of %j', (q) =>
  expectTokenCoverage(q, parseLogQuery(q).tokens)
);

it('maps token kinds', () => {
  expect(parseLogQuery('-10.0.0.1 a OR x').tokens.map((t) => t.kind)).toEqual([
    'negation',
    'phrase',
    'word',
    'operator',
    'word',
  ]);
  // OR next to an excluded term fails, so the OR is the underlined error token
  expect(parseLogQuery('-10.0.0.1 OR x').tokens.map((t) => t.kind)).toEqual([
    'negation',
    'phrase',
    'error',
    'word',
  ]);
  expect(parseLogQuery('timeout foo(bar) db').tokens.map((t) => t.kind)).toEqual(['word', 'error', 'word']);
});

it('maps token spans for negated fields and failing operators', () => {
  expect(parseLogQuery('-env:prod ""').tokens).toEqual([
    { kind: 'negation', start: 0, end: 1 },
    { kind: 'field', start: 1, end: 9 },
    { kind: 'phrase', start: 10, end: 12 },
  ]);
  expect(parseLogQuery('a OR').tokens).toEqual([
    { kind: 'word', start: 0, end: 1 },
    { kind: 'error', start: 2, end: 4 },
  ]);
});

it('an empty phrase in an OR chain leaves the other side as a required term', () => {
  expect(ok('a OR ""').text).toEqual({ all: [w('a')], anyOf: [], none: [] });
});

it('reports the first error by position', () => {
  expectError('a OR foo(bar)', 'Parentheses are only supported in field lists like key:(a OR b); put text in quotes to search for it', 8);
  expectError('OR a "open', 'OR needs a term on both sides', 0);
});

it('legacySubstringQuery keeps the raw string as one phrase', () => {
  expect(legacySubstringQuery('  conn ref ').text.all).toEqual([p('  conn ref ')]);
  expect(legacySubstringQuery('   ')).toEqual({ text: { all: [], anyOf: [], none: [] }, fields: [] });
});
