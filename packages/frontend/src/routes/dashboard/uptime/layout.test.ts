import { describe, it, expect } from 'vitest';
import src from './+page.svelte?raw';

describe('uptime page container', () => {
  it('uses the shared centered container like the other dashboard pages', () => {
    expect(src).toContain("from '$lib/stores/layout'");
    expect(src).toMatch(/class="container mx-auto [^"]*\{containerPadding\} \{maxWidthClass\}"/);
    expect(src).not.toContain('class="flex flex-col gap-2 p-6"');
  });
});
