// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import config from '../../tailwind.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(here, '../app.css'), 'utf8');
const pkg = JSON.parse(readFileSync(path.resolve(here, '../../package.json'), 'utf8'));

type Hsl = [number, number, number];
type Block = Record<string, Hsl>;

function extractBlock(selector: string): Block {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`block ${selector} not found`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Block = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

function toRgb([h, s, l]: Hsl): [number, number, number] {
  const sat = s / 100;
  const li = l / 100;
  const c = (1 - Math.abs(2 * li - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = li - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRgb(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function contrast(a: Hsl, b: Hsl): number {
  return contrastRgb(toRgb(a), toRgb(b));
}

function blendRgb(fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as [number, number, number];
}

const modes: Record<string, Block> = {
  light: extractBlock(':root'),
  dark: extractBlock('.dark'),
};

const STATES = ['success', 'warning', 'info', 'critical'];

describe.each(Object.entries(modes))('%s tokens', (mode, t) => {
  const textTokens = ['primary-text', 'destructive-text', ...STATES.map((s) => `${s}-text`)];

  it('defines every new token', () => {
    for (const name of [
      'nav-active', 'nav-active-foreground', 'primary-text', 'destructive-text',
      ...STATES.flatMap((s) => [s, `${s}-foreground`, `${s}-text`]),
    ]) {
      expect(t[name], `--${name}`).toBeDefined();
    }
  });

  it.each(textTokens)('%s reaches 4.5:1 on background and card', (name) => {
    expect(contrast(t[name], t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t[name], t.card)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([...STATES.map((s) => [`${s}-text`, s]), ['destructive-text', 'destructive']])(
    '%s reaches 4.5:1 on its own 15% tint over card',
    (textName, solidName) => {
      const bg = blendRgb(toRgb(t[solidName]), toRgb(t.card), 0.15);
      expect(contrastRgb(toRgb(t[textName]), bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(STATES)('%s-foreground reaches 4.5:1 on its solid', (s) => {
    expect(contrast(t[`${s}-foreground`], t[s])).toBeGreaterThanOrEqual(4.5);
  });

  it('nav-active-foreground on nav-active reaches 4.5:1', () => {
    expect(contrast(t['nav-active-foreground'], t['nav-active'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('surfaces', () => {
  it('light accent is visibly different from card and popover (B5)', () => {
    const t = modes.light;
    expect(Math.abs(t.accent[2] - t.card[2])).toBeGreaterThanOrEqual(5);
    expect(Math.abs(t.accent[2] - t.popover[2])).toBeGreaterThanOrEqual(5);
  });

  it('dark card is lifted from the background', () => {
    const t = modes.dark;
    expect(t.card[2] - t.background[2]).toBeGreaterThanOrEqual(2);
  });
});

describe('tailwind mapping', () => {
  const colors = (config as any).theme.extend.colors;
  const hsl = (n: string) => `hsl(var(--${n}) / <alpha-value>)`;
  it('maps the new tokens', () => {
    expect(colors.primary.text).toBe(hsl('primary-text'));
    expect(colors.nav.active).toBe(hsl('nav-active'));
    expect(colors.nav['active-foreground']).toBe(hsl('nav-active-foreground'));
    expect(colors.success.text).toBe(hsl('success-text'));
    expect(colors.critical.DEFAULT).toBe(hsl('critical'));
    expect(colors.destructive.text).toBe(hsl('destructive-text'));
  });
});

describe('fonts', () => {
  const fam = (config as any).theme.extend.fontFamily;
  it('uses self-hosted Inter and JetBrains Mono', () => {
    expect(fam.sans[0]).toBe('"Inter Variable"');
    expect(fam.mono[0]).toBe('"JetBrains Mono"');
  });
  it('pins the font packages exactly', () => {
    expect(pkg.dependencies['@fontsource-variable/inter']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['@fontsource/jetbrains-mono']).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('imports the fonts first in app.css', () => {
    const stmts = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    expect(stmts.slice(0, 4)).toEqual([
      "@import '@fontsource-variable/inter/index.css';",
      "@import '@fontsource/jetbrains-mono/400.css';",
      "@import '@fontsource/jetbrains-mono/500.css';",
      "@import '@fontsource/jetbrains-mono/600.css';",
    ]);
  });
});
