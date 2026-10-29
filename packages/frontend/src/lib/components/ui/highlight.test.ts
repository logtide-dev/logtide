// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(__dirname);
const read = (rel: string) => readFileSync(path.join(dir, rel), 'utf8');

// B5: highlighted menu rows must keep the accent background so the light-mode
// accent token (asserted in design-tokens.test.ts) actually shows.
describe('menu highlight classes', () => {
  it('dropdown items highlight with bg-accent', () => {
    expect(read('dropdown-menu/dropdown-menu-item.svelte')).toContain('data-[highlighted]:bg-accent');
  });

  it('select items highlight with bg-accent', () => {
    expect(read('select/select-item.svelte')).toContain('data-[highlighted]:bg-accent');
  });

  it('command items highlight with bg-accent', () => {
    expect(read('command/command-item.svelte')).toContain('aria-selected:bg-accent');
  });

  it('the link button variant uses the readable primary text token', () => {
    expect(read('button/button-variants.ts')).toContain('link: "text-primary-text');
  });
});
