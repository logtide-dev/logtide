import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ratchet guard for the copy rules (spec section 3) on the files the logs
// backend ships into the UI: route errors and descriptions shown verbatim by
// the query bar and the saved-search dialogs.

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const MODULE_DIRS = [
  'src/modules/query',
  'src/modules/streaming',
  'src/modules/saved-searches',
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function guardedFiles(): string[] {
  const files = MODULE_DIRS.flatMap((d) => listTsFiles(path.join(BACKEND_ROOT, d)));
  const migrationsDir = path.join(BACKEND_ROOT, 'migrations');
  for (const entry of readdirSync(migrationsDir)) {
    if (entry.startsWith('063') && entry.endsWith('.sql')) {
      files.push(path.join(migrationsDir, entry));
    }
  }
  return files.sort();
}

// Built from code points so this file never carries the characters it bans.
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
const SUCCESSFULLY = /successfully/i;
const BANG_STRING = /['"`][^'"`\n]*!['"`]/;
const LOCALE_FORMAT = /toLocaleDateString|toLocaleTimeString|toLocaleString\((?!['"]en-US['"])/;

const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'en or em dash', pattern: DASHES },
  { name: '"successfully" in copy', pattern: SUCCESSFULLY },
  { name: 'string literal ending in "!"', pattern: BANG_STRING },
  { name: "locale formatting without 'en-US'", pattern: LOCALE_FORMAT },
];

function violations(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of guardedFiles()) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        hits.push(`${path.relative(BACKEND_ROOT, file).split(path.sep).join('/')}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

describe('log query api copy guard', () => {
  it('scans the logs backend modules and migration 063', () => {
    const files = guardedFiles().map((f) => path.relative(BACKEND_ROOT, f).split(path.sep).join('/'));
    expect(files).toContain('src/modules/query/build-log-filter.ts');
    expect(files).toContain('src/modules/query/explorer-routes.ts');
    expect(files).toContain('src/modules/streaming/live-tail-filter.ts');
    expect(files).toContain('src/modules/saved-searches/routes.ts');
    expect(files).toContain('migrations/063_saved_searches.sql');
  });

  it('the rules catch what they are meant to catch', () => {
    expect(DASHES.test(`a ${String.fromCodePoint(0x2014)} b`)).toBe(true);
    expect(DASHES.test(`1${String.fromCodePoint(0x2013)}2`)).toBe(true);
    expect(DASHES.test('Project context missing - provide projectId query parameter')).toBe(false);
    expect(SUCCESSFULLY.test("'Saved search deleted successfully'")).toBe(true);
    expect(BANG_STRING.test("reply.send({ error: 'Saved!' })")).toBe(true);
    expect(BANG_STRING.test("if (a !== 'b') return")).toBe(false);
    expect(LOCALE_FORMAT.test('n.toLocaleString()')).toBe(true);
    expect(LOCALE_FORMAT.test("n.toLocaleString('en-US')")).toBe(false);
    expect(LOCALE_FORMAT.test('d.toLocaleDateString()')).toBe(true);
  });

  it.each(RULES)('no $name', ({ pattern }) => {
    expect(violations(pattern)).toEqual([]);
  });
});
