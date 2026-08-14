import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Per-viewer clock preferences (issue #297): dashboards are read by people in
// different places, so the clock format and the timezone are a display choice,
// not a property of the data. Kept client-side because it describes the viewer,
// not the organization.
const STORAGE_KEY = 'logtide_display_prefs';

export interface DisplayPreferences {
  /** true renders 12-hour AM/PM clocks, false renders 24-hour ones. */
  hour12: boolean;
  /** IANA zone name, or null for the browser timezone. */
  timeZone: string | null;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  hour12: false,
  timeZone: null,
};

function load(): DisplayPreferences {
  if (!browser) return { ...DEFAULT_DISPLAY_PREFERENCES };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DISPLAY_PREFERENCES };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_DISPLAY_PREFERENCES };
    if (typeof parsed.hour12 !== 'boolean') return { ...DEFAULT_DISPLAY_PREFERENCES };
    if (parsed.timeZone !== null && typeof parsed.timeZone !== 'string') {
      return { ...DEFAULT_DISPLAY_PREFERENCES };
    }
    return { hour12: parsed.hour12, timeZone: parsed.timeZone };
  } catch {
    return { ...DEFAULT_DISPLAY_PREFERENCES };
  }
}

function createDisplayPreferencesStore() {
  // Source of truth in memory, hydrated from localStorage once. get() reads this
  // so the value survives within a session even if localStorage is blocked (a
  // failed setItem must not make get() disagree with what subscribers see).
  let current = load();
  const { subscribe, set } = writable<DisplayPreferences>(current);

  return {
    subscribe,
    set: (value: DisplayPreferences) => {
      current = value;
      if (browser) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        } catch {
          // localStorage may be unavailable
        }
      }
      set(value);
    },
    /** Current value without subscribing. */
    get: (): DisplayPreferences => current,
  };
}

export const displayPreferences = createDisplayPreferencesStore();
