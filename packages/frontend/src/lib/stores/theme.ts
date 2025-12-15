import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'logward-theme';

function getInitialTheme(): Theme {
  if (!browser) return 'dark';

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (incognito, etc.)
  }

  // Check OS preference
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  return 'dark';
}

function createThemeStore() {
  const initialTheme = getInitialTheme();
  const { subscribe, set, update } = writable<Theme>(initialTheme);

  function applyTheme(theme: Theme) {
    if (browser) {
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }

      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // localStorage may be unavailable
      }
    }
  }

  // Apply initial theme
  if (browser) {
    applyTheme(initialTheme);
  }

  return {
    subscribe,
    set: (theme: Theme) => {
      set(theme);
      applyTheme(theme);
    },
    toggle: () => {
      update((current) => {
        const newTheme = current === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        return newTheme;
      });
    },
  };
}

export const themeStore = createThemeStore();
