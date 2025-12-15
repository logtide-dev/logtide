import { derived } from 'svelte/store';
import { themeStore } from '$lib/stores/theme';

/**
 * Derived store that provides the correct logo path based on current theme.
 * Returns '/logo/dark.svg' for light mode, '/logo/white.svg' for dark mode.
 */
export const logoPath = derived(themeStore, ($theme) =>
  $theme === 'light' ? '/logo/dark.svg' : '/logo/white.svg'
);

/**
 * Derived store for small logo variant.
 * Returns '/small_logo/dark.svg' for light mode, '/small_logo/white.svg' for dark mode.
 */
export const smallLogoPath = derived(themeStore, ($theme) =>
  $theme === 'light' ? '/small_logo/dark.svg' : '/small_logo/white.svg'
);
