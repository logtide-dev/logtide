import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore plain ESM shared with the guard tests
import { FRONTEND_ROOT, listSourceFiles, hasNativeConfirm, countUnlabelledIconButtons } from '../../../../tests/guards/detectors.mjs';

// Spec section 3 rules, enforced over the files the detection rules workstream
// owns. Incident pages and the legacy rule list/details components (still used
// by the project alerts page until it is rewritten) are deliberately not here.
const OWNED_PREFIXES = [
  'src/lib/components/siem/dashboard/',
  'src/lib/components/siem/shared/',
  'src/lib/components/siem/rules/',
  'src/routes/dashboard/security/+page.svelte',
  'src/routes/dashboard/security/+layout.svelte',
  'src/routes/dashboard/security/overview-links.ts',
  'src/routes/dashboard/security/rules/',
];
const OWNED_FILES = [
  'src/lib/components/SigmaSyncDialog.svelte',
  'src/lib/components/SigmaTreeMultiSelect.svelte',
  'src/lib/components/EditSigmaChannelsDialog.svelte',
  'src/lib/components/DetectionPackDialog.svelte',
  'src/lib/components/DetectionPacksGalleryDialog.svelte',
];

// Explicit exceptions, file -> reason. Must stay empty.
const PALETTE_ALLOWLIST: Record<string, string> = {};

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

const isTest = (f: string) => /\.test\.ts$/.test(f) || f.endsWith('test-stub.svelte');

const files: string[] = (listSourceFiles(['.svelte', '.ts']) as string[]).filter(
  (f) =>
    !isTest(f) &&
    (OWNED_FILES.includes(f) || OWNED_PREFIXES.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)))
);

const sources = new Map<string, string>(
  files.map((f) => [f, readFileSync(path.join(FRONTEND_ROOT as string, f), 'utf8')])
);

function offenders(test: (source: string, file: string) => boolean): string[] {
  return files.filter((f) => test(sources.get(f) as string, f));
}

const PALETTE = /(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:red|orange|yellow|green|blue|purple|gray|emerald|amber|slate|zinc|neutral|stone|lime|teal|cyan|sky|indigo|violet|fuchsia|pink|rose)-\d{2,3}/;

const BANNED_PHRASES = [
  'Sigma Rules',
  'Security Dashboard',
  'Top Threats',
  'Disable Pack',
  'Detection Packs',
  'Delete Sigma Rule',
  'Conversion Status',
  'Detection Logic',
  'Log Source',
];

describe('detection rule files follow the UI rules', () => {
  it('covers the owned file set', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('src/routes/dashboard/security/+page.svelte');
    expect(files).toContain('src/lib/components/DetectionPackDialog.svelte');
  });

  it('uses no native confirm()', () => {
    expect(offenders((s) => hasNativeConfirm(s))).toEqual([]);
  });

  it('uses no em dash or en dash', () => {
    expect(offenders((s) => s.includes(EM_DASH) || s.includes(EN_DASH))).toEqual([]);
  });

  it('uses no raw palette utility classes', () => {
    expect(offenders((s, f) => !(f in PALETTE_ALLOWLIST) && PALETTE.test(s))).toEqual([]);
  });

  it('formats dates only through the shared datetime helpers', () => {
    const dateApi = /toLocaleDateString|toLocaleTimeString|Intl\.DateTimeFormat/;
    const bareToLocaleString = /toLocaleString\(\s*(?:\)|undefined)/;
    const dateOptions =
      /toLocaleString\(\s*['"][\w-]+['"]\s*,\s*\{[^}]*(?:hour|minute|second|year|month|day|weekday|timeZone|dateStyle|timeStyle)/;
    expect(
      offenders((s) => dateApi.test(s) || bareToLocaleString.test(s) || dateOptions.test(s))
    ).toEqual([]);
  });

  it('gives every icon button an aria-label', () => {
    expect(
      offenders((s, f) => f.endsWith('.svelte') && (countUnlabelledIconButtons(s) as number) > 0)
    ).toEqual([]);
  });

  it('keeps copy in sentence case and free of "successfully"', () => {
    const bad = offenders((s) => {
      if (/successfully/i.test(s)) return true;
      return BANNED_PHRASES.some((phrase) => s.includes(phrase));
    });
    expect(bad).toEqual([]);
  });

  it('keeps the palette allowlist empty', () => {
    expect(Object.keys(PALETTE_ALLOWLIST)).toEqual([]);
  });
});
