// @vitest-environment node
//
// Static guard: every floating content primitive must stay inside the
// viewport on phones (collision handling, viewport max width, bounded height).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(HERE, f), 'utf8');

const FILES = [
  'popover/popover-content.svelte',
  'dropdown-menu/dropdown-menu-content.svelte',
  'select/select-content.svelte',
];

describe('floating content primitives', () => {
  for (const f of FILES) {
    it(`${f} avoids collisions and caps its size`, () => {
      const src = read(f);
      expect(src).toContain('collisionPadding = 8');
      expect(src).toContain('avoidCollisions = true');
      expect(src).toContain('max-w-[calc(100vw-1rem)]');
      expect(src).toContain('--bits-floating-available-height');
    });
  }

  it('tooltip and submenu content are width capped', () => {
    expect(read('tooltip/tooltip-content.svelte')).toContain('max-w-[calc(100vw-1rem)]');
    expect(read('dropdown-menu/dropdown-menu-sub-content.svelte')).toContain('max-w-[calc(100vw-1rem)]');
  });

  it('range calendar shows one month on phones', () => {
    const src = read('range-calendar/range-calendar.svelte');
    expect(src).toContain('max-width: 639px');
    expect(src).toContain('numberOfMonths={monthCount}');
  });
});
