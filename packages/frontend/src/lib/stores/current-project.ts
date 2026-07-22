import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Remembers the last project the user looked at, so pages that have a project
// selector default to the same one across navigations and reloads instead of
// each falling back to "the first project".
const STORAGE_KEY = 'logtide_current_project';

function load(): string | null {
  if (!browser) return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function createCurrentProjectStore() {
  const { subscribe, set } = writable<string | null>(load());

  return {
    subscribe,
    set: (projectId: string | null) => {
      if (browser) {
        try {
          if (projectId) localStorage.setItem(STORAGE_KEY, projectId);
          else localStorage.removeItem(STORAGE_KEY);
        } catch {
          // localStorage may be unavailable
        }
      }
      set(projectId);
    },
    /** Current value without subscribing. */
    get: (): string | null => load(),
  };
}

export const currentProjectStore = createCurrentProjectStore();
