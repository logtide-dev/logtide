import { describe, it, expect } from 'vitest';
import login from './+page.svelte?raw';

// The small logo files differ between themes (one has the orbit ring), so the
// auth pages use the same theme-aware full logo as the app header.
describe('login logo', () => {
  it('uses the theme-aware full logo like the app header', () => {
    const src = login;
    expect(src).toContain("import { logoPath } from '$lib/utils/theme'");
    expect(src).not.toContain('smallLogoPath');
  });
});
