// Recent searches of the logs explorer, in this browser. Each entry is the
// full explorer state (query, projects, time range, view, columns) so picking
// one restores the search exactly. Storage failures (private mode, quota,
// blocked site data) never break the explorer: an in-memory copy stays
// authoritative for the session.

import { browser } from '$app/environment';
import { isTimeRangePreset } from '@logtide/shared';
import type { SavedSearchState } from '$lib/api/saved-searches';

export interface RecentSearch extends SavedSearchState {
  /** ISO instant of the last time this search ran. */
  at: string;
}

export const RECENT_SEARCHES_KEY = 'logtide_recent_searches_v2';
/** Pre-1.6 key: a plain list of query strings. Migrated once, then removed. */
export const LEGACY_RECENT_SEARCHES_KEY = 'logtide_recent_searches';
export const MAX_RECENT_SEARCHES = 8;

const DEFAULT_RECORD_DELAY_MS = 3000;
const LABEL_MAX = 40;

let memory: RecentSearch[] = [];

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Valid entries only; unknown fields dropped; at most `MAX_RECENT_SEARCHES`. */
function normalizeEntries(value: unknown): RecentSearch[] {
  if (!Array.isArray(value)) return [];
  const out: RecentSearch[] = [];
  for (const item of value) {
    if (out.length >= MAX_RECENT_SEARCHES) break;
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.q !== 'string' || raw.q.trim() === '') continue;
    if (!isStringArray(raw.projectIds)) continue;
    if (typeof raw.at !== 'string') continue;
    const entry: RecentSearch = { q: raw.q, projectIds: [...raw.projectIds], at: raw.at };
    if (typeof raw.range === 'string' && isTimeRangePreset(raw.range)) entry.range = raw.range;
    if (typeof raw.from === 'string') entry.from = raw.from;
    if (typeof raw.to === 'string') entry.to = raw.to;
    if (raw.view === 'table' || raw.view === 'terminal') entry.view = raw.view;
    if (isStringArray(raw.columns)) entry.columns = [...raw.columns];
    out.push(entry);
  }
  return out;
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(list: RecentSearch[]): void {
  memory = list;
  if (!browser) return;
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // blocked or full storage: the in-memory list stays authoritative
  }
}

function removeLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_RECENT_SEARCHES_KEY);
  } catch {
    // nothing to do
  }
}

/** Legacy string entries become `{ q, projectIds: [] }` with no time range. */
function migrateLegacy(raw: string | null): RecentSearch[] | null {
  const value = parse(raw);
  if (!Array.isArray(value)) return null;
  const at = new Date().toISOString();
  const entries = value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((q) => ({ q: q.trim(), projectIds: [], at }));
  return normalizeEntries(entries);
}

export function loadRecentSearches(): RecentSearch[] {
  if (!browser) return [...memory];
  let current: string | null;
  let legacy: string | null;
  try {
    current = localStorage.getItem(RECENT_SEARCHES_KEY);
    legacy = localStorage.getItem(LEGACY_RECENT_SEARCHES_KEY);
  } catch {
    return [...memory];
  }
  if (current !== null) {
    if (legacy !== null) removeLegacy();
    memory = normalizeEntries(parse(current));
    return [...memory];
  }
  if (legacy !== null) {
    const migrated = migrateLegacy(legacy) ?? [];
    write(migrated);
    removeLegacy();
    return [...migrated];
  }
  memory = [];
  return [];
}

/** Identity of a search: trimmed `q`, sorted projects and the time range. View and columns are ignored. */
function identity(state: SavedSearchState): string {
  const projects = [...state.projectIds].sort().join(',');
  const range = state.range ? `range:${state.range}` : `abs:${state.from ?? ''}|${state.to ?? ''}`;
  return JSON.stringify([state.q.trim(), projects, range]);
}

/** Records `state` as the newest entry (an equal entry moves to the top). Returns the new list. */
export function recordRecentSearch(state: SavedSearchState, now: Date = new Date()): RecentSearch[] {
  const list = loadRecentSearches();
  const q = state.q.trim();
  if (q === '') return list;
  const entry: RecentSearch = { q, projectIds: [...state.projectIds], at: now.toISOString() };
  if (state.range) {
    entry.range = state.range;
  } else {
    if (state.from) entry.from = state.from;
    if (state.to) entry.to = state.to;
  }
  if (state.view) entry.view = state.view;
  if (state.columns) entry.columns = [...state.columns];
  const key = identity(entry);
  const next = [entry, ...list.filter((r) => identity(r) !== key)].slice(0, MAX_RECENT_SEARCHES);
  write(next);
  return [...next];
}

export function clearRecentSearches(): void {
  memory = [];
  if (!browser) return;
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // the in-memory list is already empty
  }
  removeLegacy();
}

/**
 * Records a search at once when the user submits it, or `delayMs` after its
 * results loaded (facet clicks, URL changes): a search the user looked at for
 * a few seconds is worth recalling, one skimmed past on the way is not.
 */
export function createRecentRecorder(
  record: (s: SavedSearchState) => void,
  delayMs: number = DEFAULT_RECORD_DELAY_MS,
): { submit(s: SavedSearchState): void; loaded(s: SavedSearchState): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    submit(s) {
      cancel();
      record(s);
    },
    loaded(s) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        record(s);
      }, delayMs);
    },
    cancel,
  };
}

/** The query, cut to 40 characters (ellipsis included). */
export function recentLabel(r: RecentSearch): string {
  const q = r.q.trim();
  return q.length <= LABEL_MAX ? q : `${q.slice(0, LABEL_MAX - 1)}…`;
}
