import { it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogQuery } from './parser.js';
import { LOG_QUERY_MESSAGES } from './lexer.js';

// Parser errors are shown verbatim by the explorer (inline error) and returned
// by the API ({ error, position }), so they follow the UI copy rules.
const BAD = ['"open', 'env:(a', 'foo(bar)', 'OR a', 'AND a', '-a OR b', 'a OR env:x', 'env:()', 'env:(a b)', '-env:*a*',
  'level:warning', 'service:*a*', '-trace:x', 'service:a service:b', Array.from({ length: 11 }, (_, i) => `k${i}:v`).join(' '),
  `k:(${Array.from({ length: 51 }, (_, i) => `v${i}`).join(' OR ')})`, `k:${'v'.repeat(1001)}`, `${'k'.repeat(201)}:v`, 'a'.repeat(4097),
  'env:(a OR)', 'a OR OR b', 'timeout OR', 'env:(a OR (b))', 'level:(warn OR fatal)', 'host:a hostname:b'];

function expectCopyRules(msg: string): void {
  expect(msg[0]).toMatch(/[A-Z]/);
  expect(msg).not.toMatch(/[.!]$/);
  expect(msg).not.toMatch(/\u2014|\u2013/);
  expect(msg.toLowerCase()).not.toContain('successfully');
}

it.each(BAD.map((q) => [q.slice(0, 40), q]))('error copy for %j follows the rules', (_label, q) => {
  const r = parseLogQuery(q);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expectCopyRules(r.error.message);
  expect(r.tokens.some((t) => t.kind === 'error' && t.start <= r.error.position && r.error.position <= t.end)).toBe(true);
});

it('every message template follows the rules', () => {
  for (const entry of Object.values(LOG_QUERY_MESSAGES)) {
    expectCopyRules(typeof entry === 'function' ? entry('service') : entry);
  }
});

it('numbers in messages use en-US grouping', () => {
  const r = parseLogQuery('a'.repeat(4097));
  expect(!r.ok && r.error.message).toContain('4,096');
  expect(LOG_QUERY_MESSAGES.VALUE_TOO_LONG).toContain('1,000');
});

it('source files contain no dash characters or control bytes', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(10);
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    if (/\u2014|\u2013/.test(text)) offenders.push(`${file}: dash`);
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) offenders.push(`${file}: control byte`);
  }
  expect(offenders).toEqual([]);
});
