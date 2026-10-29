// Test helpers for the log query tests (not exported from the package index).
import { expect } from 'vitest';
import { parseLogQuery } from './parser.js';
import type { LogSearchQuery, QueryToken } from './types.js';

/** Parses `q` and returns the query, throwing with the parse error otherwise. */
export function ok(q: string): LogSearchQuery {
  const r = parseLogQuery(q);
  if (!r.ok) throw new Error(`${r.error.message} at ${r.error.position}`);
  return r.query;
}

export function expectError(q: string, message: string, position: number): void {
  const r = parseLogQuery(q);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toEqual({ message, position });
}

/** Tokens are sorted, non-overlapping, non-empty and cover every non-whitespace char exactly once. */
export function expectTokenCoverage(q: string, tokens: QueryToken[]): void {
  const covered = new Array<number>(q.length).fill(0);
  tokens.forEach((t, k) => {
    expect(t.end).toBeGreaterThan(t.start);
    if (k > 0) expect(t.start).toBeGreaterThanOrEqual(tokens[k - 1].end);
    for (let c = t.start; c < t.end; c++) covered[c]++;
  });
  const uncovered: number[] = [];
  for (let c = 0; c < q.length; c++) {
    if (!/\s/u.test(q[c]) && covered[c] !== 1) uncovered.push(c);
  }
  expect(uncovered).toEqual([]);
}

/** Valid and invalid inputs from the lexer and parser tests. */
export const TOKEN_INPUTS: string[] = [
  '',
  '   ',
  '  x  ',
  'timeout',
  '-"a b" x',
  'timeout OR refused db',
  'a OR b c OR "d e" OR f',
  'payment AND succeeded',
  'a OR OR b',
  'OR timeout',
  '-a OR b',
  '"open',
  'a -"b c',
  'env:(a OR b',
  'foo(bar) timeout',
  '(timeout OR refused)',
  'env:(a OR (b))',
  'env:( "us east" OR eu )',
  'env:(a b) x',
  '-10.0.0.1 OR x',
  'Error: connect ECONNREFUSED 127.0.0.1:5432',
  'a - b --verbose',
  '"a"b ""',
  'k:"say \\"hi\\""  -user.id:*  path:a:b',
  'service:a service:b',
  '-env:*x* level:warning',
  'level:(warn OR fatal) host:a hostname:b',
  'service:a OR service:(b OR c) -trace:x',
  'a'.repeat(4097),
];
