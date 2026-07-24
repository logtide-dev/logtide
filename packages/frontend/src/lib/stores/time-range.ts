import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Remembers the last time window the user picked, so it carries across the
// time-driven pages (logs, traces) instead of each resetting to its own default.
// Consumers validate `type` against what they support and fall back otherwise,
// since not every page offers the same presets.
const STORAGE_KEY = 'logtide_time_range';

export interface StoredTimeRange {
  type: string;
  from: string;
  to: string;
}

function load(): StoredTimeRange | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === 'string') return parsed as StoredTimeRange;
    return null;
  } catch {
    return null;
  }
}

function createTimeRangeStore() {
  // Source of truth in memory, hydrated from localStorage once. get() reads this
  // so the value survives within a session even if localStorage is blocked (a
  // failed setItem must not make get() return null while subscribers see it).
  let current = load();
  const { subscribe, set } = writable<StoredTimeRange | null>(current);

  return {
    subscribe,
    set: (value: StoredTimeRange | null) => {
      current = value;
      if (browser) {
        try {
          if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
          else localStorage.removeItem(STORAGE_KEY);
        } catch {
          // localStorage may be unavailable
        }
      }
      set(value);
    },
    get: (): StoredTimeRange | null => current,
  };
}

export const timeRangeStore = createTimeRangeStore();
