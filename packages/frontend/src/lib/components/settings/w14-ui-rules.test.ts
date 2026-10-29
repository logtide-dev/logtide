// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore plain ESM shared with the guards
import { countUnlabelledIconButtons } from '../../../../tests/guards/detectors.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Every frontend path owned by workstream W14 (relative to src/).
const OWNED = [
  'routes/dashboard/settings/general',
  'routes/dashboard/settings/members',
  'routes/dashboard/settings/audit-log',
  'routes/dashboard/settings/usage',
  'routes/dashboard/settings/pii-masking',
  'routes/dashboard/settings/pipelines',
  'routes/dashboard/settings/patterns',
  'routes/dashboard/settings/account',
  'routes/dashboard/admin',
  'lib/components/admin',
  'lib/components/pipelines',
  'lib/components/settings',
  'lib/components/InviteMemberDialog.svelte',
  'lib/components/QuotaStateBadge.svelte',
  'lib/components/QuotaBanner.svelte',
  'lib/components/EmailVerificationBanner.svelte',
  'lib/components/TermsAcceptanceModal.svelte',
];

function collect(rel: string, out: string[]) {
  const full = path.join(SRC, rel);
  const st = statSync(full);
  if (st.isDirectory()) {
    for (const name of readdirSync(full)) collect(path.join(rel, name), out);
  } else if (/\.(svelte|ts)$/.test(rel) && !/\.test\.ts$/.test(rel)) {
    out.push(rel);
  }
}

const files: string[] = [];
for (const rel of OWNED) collect(rel, files);
const sources = files.map((f) => ({ file: f.split(path.sep).join('/'), text: readFileSync(path.join(SRC, f), 'utf8') }));

const DASH = new RegExp('[\\u2013\\u2014]');

describe('W14 owned files follow the UI rules', () => {
  it('scans a non-trivial number of files', () => {
    expect(sources.length).toBeGreaterThan(30);
  });

  it('never calls the native confirm()', () => {
    const bad = sources.filter(({ text }) => /(?<![\w.$])(?:window\.)?confirm\(/.test(text.replace(/function\s+confirm\(/g, '')));
    expect(bad.map((s) => s.file)).toEqual([]);
  });

  it('contains no em or en dash', () => {
    expect(sources.filter(({ text }) => DASH.test(text)).map((s) => s.file)).toEqual([]);
  });

  it('gives every icon-only Button an aria-label', () => {
    const bad = sources
      .filter(({ file, text }) => file.endsWith('.svelte') && countUnlabelledIconButtons(text) > 0)
      .map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it('has no "successfully" in toasts', () => {
    const bad = sources.filter(({ text }) =>
      /toastStore\.(success|error|info|warning)\(\s*['"`][^'"`]*successfully/.test(text),
    );
    expect(bad.map((s) => s.file)).toEqual([]);
  });

  it('uses no raw palette status colours', () => {
    const re = /\b(?:text|bg|border)-(?:red|green|yellow|amber|orange|blue)-\d{2,3}\b/;
    expect(sources.filter(({ text }) => re.test(text)).map((s) => s.file)).toEqual([]);
  });

  it('formats dates through the shared datetime util', () => {
    const re = /\.toLocale(?:Date|Time)?String\(/;
    expect(sources.filter(({ text }) => re.test(text.replace(/\.toLocaleString\('en-US'\)/g, ''))).map((s) => s.file)).toEqual([]);
  });

  it('formats bare numbers with the en-US locale', () => {
    expect(sources.filter(({ text }) => /\.toLocaleString\(\)/.test(text)).map((s) => s.file)).toEqual([]);
  });
});
