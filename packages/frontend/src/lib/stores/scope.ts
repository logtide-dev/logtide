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
  /** The scope this page shows. Differs from the persisted one only by a page fallback. */
  get(): Scope;
  /** The scope remembered per browser (what the URL or the user decided). */
  getPersisted(): Scope;
  set(scope: Scope): void;
  /**
   * ScopeBar reconcile: persists `commit` and shows `effective`. A page
   * fallback (first project on a single-project page, a preset the page does
   * not offer) lives only in `effective`.
   */
  reconcile(commit: Scope, effective: Scope): void;
  /** Drops any page fallback, so the next page starts from the persisted scope. */
  clearEffective(): void;
  /** A user choice: persisted, and shown even over a page fallback of the other part. */
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
  let persisted = load();
  // What the page shows: the persisted scope, or a page-only fallback on top.
  let current = persisted;
  const { subscribe, set: emit } = writable<Scope>(current);

  function persist() {
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // localStorage may be unavailable or full
    }
  }

  function copy(scope: Scope): Scope {
    return { projectIds: [...scope.projectIds], range: scope.range };
  }

  function apply(commit: Scope, effective: Scope) {
    const persistedChanged = !sameScope(persisted, commit);
    const shownChanged = !sameScope(current, effective);
    if (persistedChanged) {
      persisted = copy(commit);
      persist();
    }
    if (shownChanged) {
      current = copy(effective);
      emit(current);
    }
  }

  function set(scope: Scope) {
    apply(scope, scope);
  }

  return {
    subscribe,
    get: () => current,
    getPersisted: () => persisted,
    set,
    reconcile: apply,
    clearEffective: () => apply(persisted, persisted),
    // A user choice changes one part of both views and leaves the other part,
    // which may be a page fallback, as it was.
    setProjects: (ids) =>
      apply({ ...persisted, projectIds: ids }, { ...current, projectIds: ids }),
    setRange: (range) => apply({ ...persisted, range }, { ...current, range }),
    applyUrl: (url) => {
      const fromUrl = readScopeFromUrl(url);
      apply({ ...persisted, ...fromUrl }, { ...current, ...fromUrl });
    },
    reset: () => {
      persisted = defaults();
      current = persisted;
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
