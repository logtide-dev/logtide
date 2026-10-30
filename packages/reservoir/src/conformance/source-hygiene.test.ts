// Source hygiene for the files F3 owns in this package: no em dash or en
// dash, and no control bytes other than tab, LF and CR (a NUL-byte
// corruption happened once). The patterns are escapes on purpose, so this
// file passes its own check.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const DASHES = /[\u2013\u2014]/;
const CONTROL_BYTES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const FILES = [
  ...tsFilesUnder(join(SRC, 'core')),
  ...tsFilesUnder(join(SRC, 'conformance')),
  join(SRC, 'client.ts'),
  join(SRC, 'buffered', 'reservoir-buffered.ts'),
].sort();

describe('source hygiene', () => {
  it('covers the owned files', () => {
    const names = FILES.map((f) => relative(SRC, f).split('\\').join('/'));
    expect(names).toContain('client.ts');
    expect(names).toContain('buffered/reservoir-buffered.ts');
    expect(names).toContain('core/types.ts');
    expect(names).toContain('conformance/suites/sessions.ts');
    expect(names).toContain('conformance/source-hygiene.test.ts');
  });

  it('has no em dash, en dash or control bytes', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      const name = relative(SRC, file).split('\\').join('/');
      if (DASHES.test(text)) offenders.push(`${name}: em or en dash`);
      if (CONTROL_BYTES.test(text)) offenders.push(`${name}: control byte`);
    }
    expect(offenders).toEqual([]);
  });

  it('the patterns catch what they are meant to', () => {
    expect(DASHES.test(`a${String.fromCharCode(0x2014)}b`)).toBe(true);
    expect(DASHES.test(`a${String.fromCharCode(0x2013)}b`)).toBe(true);
    expect(CONTROL_BYTES.test(`a${String.fromCharCode(0)}b`)).toBe(true);
    expect(CONTROL_BYTES.test('tab\tand\r\nnewlines')).toBe(false);
  });
});
