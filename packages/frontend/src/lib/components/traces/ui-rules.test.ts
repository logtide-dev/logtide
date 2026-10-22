import { describe, it, expect } from 'vitest';

// Spec section 3 rules, applied to every file the Traces workstream owns.
const sources = {
  ...import.meta.glob(
    [
      '/src/lib/components/traces/**/*.{svelte,ts}',
      '!/src/lib/components/traces/**/*.test.ts',
      '/src/routes/dashboard/traces/**/*.{svelte,ts}',
      '!/src/routes/dashboard/traces/**/*.test.ts',
      '/src/lib/components/ServiceMap.svelte',
      '/src/lib/components/EmptyTraces.svelte',
      '/src/lib/api/traces.ts',
      '/src/lib/utils/trace-filters.ts',
      '/src/lib/utils/trace-links.ts',
      '/src/lib/utils/span-events.ts',
      '/src/lib/utils/trace-resolve.ts',
      '/src/lib/utils/latest.ts',
    ],
    { query: '?raw', import: 'default', eager: true }
  ),
} as Record<string, string>;

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

function offenders(test: (source: string) => boolean): string[] {
  return Object.entries(sources)
    .filter(([, source]) => test(source))
    .map(([file]) => file)
    .sort();
}

/** Every `<Button ...>` opening tag, scanned so `=>` inside `{...}` does not end it. */
function buttonTags(source: string): string[] {
  const tags: string[] = [];
  let from = source.indexOf('<Button');
  while (from !== -1) {
    let depth = 0;
    let quote: string | null = null;
    let end = from;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(from, end + 1));
    from = source.indexOf('<Button', end);
  }
  return tags;
}

describe('traces ui rules', () => {
  it('scans the owned files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it('owned traces files contain no em or en dash', () => {
    expect(offenders((s) => s.includes(EM_DASH) || s.includes(EN_DASH))).toEqual([]);
  });

  it('owned traces files use no native confirm', () => {
    expect(offenders((s) => /\bconfirm\(/.test(s))).toEqual([]);
  });

  it('owned traces files format numbers with en-US', () => {
    expect(offenders((s) => /toLocaleString\((?!\s*['"]en-US['"])/.test(s))).toEqual([]);
  });

  it('owned traces files use no raw status palette classes', () => {
    expect(
      offenders((s) =>
        /\b(?:bg|text|border|ring|fill|stroke)-(?:red|green|amber|yellow|emerald|orange|rose|lime)-\d{2,3}/.test(s)
      )
    ).toEqual([]);
  });

  it('owned traces files use no raw hex colours', () => {
    expect(offenders((s) => /#[0-9a-fA-F]{6}\b/.test(s))).toEqual([]);
  });

  it('owned traces files use no ad hoc date formatting', () => {
    expect(
      offenders((s) =>
        /\.toISOString\(\)\.slice\(|\.getHours\(\)|\.getMinutes\(\)|toLocaleTimeString|toLocaleDateString/.test(s)
      )
    ).toEqual([]);
  });

  it('owned traces files have icon buttons with aria-label', () => {
    const bad = offenders((s) =>
      buttonTags(s).some((tag) => /size=["']icon["']/.test(tag) && !/aria-label=/.test(tag))
    );
    expect(bad).toEqual([]);
  });

  it('owned traces files carry no title case or success-toast strings', () => {
    expect(offenders((s) => /successfully!?['"`]/.test(s))).toEqual([]);
    expect(offenders((s) => /['">]Total Traces\b|Distributed Traces|Back to Traces|No Traces Yet/.test(s))).toEqual([]);
  });

  it('buttonTags keeps an arrow function in a handler inside the tag', () => {
    const tags = buttonTags('<Button size="icon" onclick={() => go()}>x</Button>');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('go()');
  });
});

describe('operations card layout', () => {
  it('lets the grid cards shrink so the table scrolls inside its card', () => {
    const file = Object.keys(sources).find((f) => f.endsWith('/TracesExplorer.svelte'));
    expect(file).toBeTruthy();
    const src = sources[file as string];
    const grid = src.slice(src.indexOf('lg:grid-cols-2'));
    const cards = grid.match(/<Card[ >][^\n]*/g)!.slice(0, 2);
    expect(cards[0]).toContain('min-w-0');
    expect(cards[1]).toContain('min-w-0');
  });
});
