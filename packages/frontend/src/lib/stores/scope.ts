import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import {
  DEFAULT_RANGE,
  legacyTimeRangeToRange,
  rangesEqual,
  readScopeFromUrl,
  sanitizeScope,
  type Scope,
  type TimeRangeValue,
} from './scope-url.js';

export * from './scope-url.js';

// One shared project and time scope for every explore page. Persisted per
// browser (not per organization), so consumers reconcile it against the
// projects they can actually see (see reconcileScope).
const STORAGE_KEY = 'logtide_scope';
const LEGACY_PROJECT_KEY = 'logtide_current_project';
const LEGACY_RANGE_KEY = 'logtide_time_range';

export interface ScopeStore {
  subscribe: Readable<Scope>['subscribe'];
  get(): Scope;
  set(scope: Scope): void;
  setProjects(ids: string[]): void;
  setRange(range: TimeRangeValue): void;
  /** Merge the scope parts carried by a URL, without project validation. */
  applyUrl(url: URL): void;
  reset(): void;
}

function defaults(): Scope {
  return { projectIds: [], range: DEFAULT_RANGE };
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function load(): Scope {
  if (!browser) return defaults();

  const raw = readKey(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = sanitizeScope(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      // corrupt JSON: fall through to legacy keys and defaults
    }
  }

  // One-time migration from the two legacy keys. They are only read, never
  // deleted, so a downgrade keeps working.
  const scope = defaults();
  const legacyProject = readKey(LEGACY_PROJECT_KEY);
  if (legacyProject && legacyProject.trim()) scope.projectIds = [legacyProject.trim()];
  const legacyRange = readKey(LEGACY_RANGE_KEY);
  if (legacyRange) {
    try {
      const parsed = JSON.parse(legacyRange);
      const range = parsed && typeof parsed === 'object' ? legacyTimeRangeToRange(parsed) : null;
      if (range) scope.range = range;
    } catch {
      // ignore garbage
    }
  }
  return scope;
}

function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.projectIds.length === b.projectIds.length &&
    a.projectIds.every((id, i) => id === b.projectIds[i]) &&
    rangesEqual(a.range, b.range)
  );
}

function createScopeStore(): ScopeStore {
  // In-memory source of truth, hydrated once. get() reads this so the scope
  // survives within a session even if localStorage is blocked.
  let current = load();
  const { subscribe, set: emit } = writable<Scope>(current);

  function persist() {
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // localStorage may be unavailable or full
    }
  }

  function set(scope: Scope) {
    if (sameScope(current, scope)) return;
    current = { projectIds: [...scope.projectIds], range: scope.range };
    persist();
    emit(current);
  }

  return {
    subscribe,
    get: () => current,
    set,
    setProjects: (ids) => set({ ...current, projectIds: ids }),
    setRange: (range) => set({ ...current, range }),
    applyUrl: (url) => set({ ...current, ...readScopeFromUrl(url) }),
    reset: () => {
      current = defaults();
      if (browser) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      }
      emit(current);
    },
  };
}

export const scopeStore = createScopeStore();
