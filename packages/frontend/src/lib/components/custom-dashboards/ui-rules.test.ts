// @vitest-environment node
//
// Static guard for the UX 1.6 global rules (spec section 3) over the files the
// dashboards workstream owns: severity colours only through the severity
// module, no native confirm(), no long dashes, aria-labels on icon-only
// controls, en-US pinned number formatting and the shared datetime formatter.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.resolve(HERE, '..');

const OWNED_FILES = [
  path.resolve(COMPONENTS, '../../routes/dashboard/+page.svelte'),
  ...['EmptyDashboard', 'LogsChart', 'RecentErrorsWidget', 'StatsCard', 'TopServicesWidget', 'WebVitalsWidget'].map(
    (name) => path.join(COMPONENTS, 'dashboard', `${name}.svelte`)
  ),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const SOURCES = [...walk(HERE), ...OWNED_FILES].sort();

function rel(file: string): string {
  return path.relative(COMPONENTS, file).split(path.sep).join('/');
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

// Files that may use a raw palette colour. Starts empty: severity and state
// colours go through $lib/utils/severity.ts, chart colours through tone.chart
// or echarts-theme.ts.
const PALETTE_ALLOWLIST: string[] = [];

const COLOURS =
  'red|amber|green|yellow|orange|blue|emerald|purple|sky|cyan|teal|violet|indigo|pink|rose|lime|fuchsia';
const PALETTE = new RegExp(
  `(?:^|[^\\w-])(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline)-(?:${COLOURS})-\\d{2,3}`,
  'g'
);

function offenders(test: (source: string, file: string) => string[]): string[] {
  const found: string[] = [];
  for (const file of SOURCES) {
    for (const hit of test(read(file), file)) found.push(`${rel(file)}: ${hit}`);
  }
  return found;
}

describe('dashboards UI rules', () => {
  it('scans the owned sources', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES.some((f) => rel(f).endsWith('dashboard/StatsCard.svelte'))).toBe(true);
    expect(SOURCES.some((f) => rel(f).endsWith('custom-dashboards/PanelRenderer.svelte'))).toBe(true);
  });

  it('uses no raw palette colour classes', () => {
    const found = offenders((source, file) => {
      if (PALETTE_ALLOWLIST.includes(rel(file))) return [];
      return Array.from(source.matchAll(PALETTE)).map((m) => m[0].trim());
    });
    expect(found).toEqual([]);
  });

  it('never calls the native confirm()', () => {
    const found = offenders((source) =>
      /(?<![\w.$])(?:window\.)?confirm\(/.test(source.replace(/function\s+confirm\(/g, '')) ? ['confirm('] : []
    );
    expect(found).toEqual([]);
  });

  it('contains no em or en dash', () => {
    const dash = new RegExp('[\\u2014\\u2013]');
    const found = offenders((source) => (dash.test(source) ? ['long dash'] : []));
    expect(found).toEqual([]);
  });

  it('formats numbers with en-US', () => {
    const found = offenders((source) =>
      Array.from(source.matchAll(/toLocaleString\((?!\s*'en-US')/g)).map(() => 'toLocaleString without en-US')
    );
    expect(found).toEqual([]);
  });

  it('uses the shared datetime formatter, not toLocale date or time strings', () => {
    const found = offenders((source) =>
      Array.from(source.matchAll(/toLocale(?:Date|Time)String\(/g)).map((m) => m[0])
    );
    expect(found).toEqual([]);
  });

  it('gives every icon-only button and link an aria-label', () => {
    const found: string[] = [];
    for (const file of SOURCES.filter((f) => f.endsWith('.svelte'))) {
      const ast = parse(read(file), { modern: true }) as unknown as { fragment: unknown };
      const visit = (node: any): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        if (node.type === 'RegularElement' && (node.name === 'button' || node.name === 'a')) {
          const labelled = (node.attributes ?? []).some(
            (a: any) =>
              a.type === 'SpreadAttribute' ||
              (a.type === 'Attribute' && (a.name === 'aria-label' || a.name === 'aria-labelledby'))
          );
          if (!labelled && !hasText(node.fragment)) found.push(`${rel(file)}: <${node.name}> without text or aria-label`);
        }
        for (const key of Object.keys(node)) {
          if (key === 'attributes' || key === 'parent') continue;
          visit(node[key]);
        }
      };
      visit(ast.fragment);
    }
    expect(found).toEqual([]);
  });
});

function hasText(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasText);
  if (node.type === 'Text') return node.data.trim().length > 0;
  if (node.type === 'ExpressionTag') return true;
  for (const key of Object.keys(node)) {
    if (key === 'attributes' || key === 'parent') continue;
    if (hasText(node[key])) return true;
  }
  return false;
}
