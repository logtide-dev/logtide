import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

// The theme actually applied to the DOM.
export type Theme = 'light' | 'dark';
// What the user picked. "system" follows the OS and tracks it live.
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'logtide-theme';

function systemTheme(): Theme {
  if (!browser) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getStoredPreference(): ThemePreference {
  if (!browser) return 'dark';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (incognito, etc.)
  }
  // No explicit choice yet: follow the OS.
  return 'system';
}

function resolve(pref: ThemePreference): Theme {
  return pref === 'system' ? systemTheme() : pref;
}

function createThemeStore() {
  const initialPref = getStoredPreference();
  const preference = writable<ThemePreference>(initialPref);
  // Public store yields the RESOLVED theme, so existing consumers keep working.
  const resolved = writable<Theme>(resolve(initialPref));

  function apply(theme: Theme) {
    if (!browser) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }

  function persist(pref: ThemePreference) {
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // localStorage may be unavailable
    }
  }

  if (browser) {
    apply(resolve(initialPref));
    // Track OS changes while the preference follows the system.
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (get(preference) === 'system') {
          const t = systemTheme();
          resolved.set(t);
          apply(t);
        }
      });
  }

  function setPreference(pref: ThemePreference) {
    preference.set(pref);
    persist(pref);
    const t = resolve(pref);
    resolved.set(t);
    apply(t);
  }

  return {
    subscribe: resolved.subscribe,
    preference: { subscribe: preference.subscribe },
    setPreference,
    // Backward-compatible helpers.
    set: (theme: Theme) => setPreference(theme),
    toggle: () => {
      setPreference(get(resolved) === 'dark' ? 'light' : 'dark');
    },
  };
}

export const themeStore = createThemeStore();
