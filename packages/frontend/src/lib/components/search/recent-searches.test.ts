import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RECENT_SEARCHES_KEY,
  LEGACY_RECENT_SEARCHES_KEY,
  MAX_RECENT_SEARCHES,
  loadRecentSearches,
  recordRecentSearch,
  clearRecentSearches,
  createRecentRecorder,
  recentLabel,
  type RecentSearch,
} from './recent-searches';
import type { SavedSearchState } from '$lib/api/saved-searches';

const state = (q: string, extra: Partial<SavedSearchState> = {}): SavedSearchState => ({
  q,
  projectIds: [],
  range: '24h',
  ...extra,
});

const stored = (): RecentSearch[] => JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? 'null');

beforeEach(() => {
  localStorage.clear();
  clearRecentSearches();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('recent searches', () => {
  it('uses the v2 key and keeps 8 entries', () => {
    expect(RECENT_SEARCHES_KEY).toBe('logtide_recent_searches_v2');
    expect(LEGACY_RECENT_SEARCHES_KEY).toBe('logtide_recent_searches');
    expect(MAX_RECENT_SEARCHES).toBe(8);
  });

  it('keeps newest first, dedupes by state and caps at 8', () => {
    const t0 = new Date('2026-10-22T10:00:00Z');
    for (let i = 0; i < 10; i++) {
      recordRecentSearch(state(`q${i}`), new Date(t0.getTime() + i * 1000));
    }
    let list = loadRecentSearches();
    expect(list).toHaveLength(8);
    expect(list.map((r) => r.q)).toEqual(['q9', 'q8', 'q7', 'q6', 'q5', 'q4', 'q3', 'q2']);

    // same q, projects and range again: moves to the top, no duplicate, view and columns follow the newest
    list = recordRecentSearch(state('q5', { view: 'terminal', columns: ['user.id'] }), new Date('2026-10-22T11:00:00Z'));
    expect(list).toHaveLength(8);
    expect(list.map((r) => r.q)).toEqual(['q5', 'q9', 'q8', 'q7', 'q6', 'q4', 'q3', 'q2']);
    expect(list[0]).toEqual({
      q: 'q5',
      projectIds: [],
      range: '24h',
      view: 'terminal',
      columns: ['user.id'],
      at: '2026-10-22T11:00:00.000Z',
    });
    expect(stored()).toEqual(list);
    expect(loadRecentSearches()).toEqual(list);
  });

  it('treats the same q with other projects as a different entry', () => {
    recordRecentSearch(state('timeout', { projectIds: ['p1'] }));
    recordRecentSearch(state('timeout', { projectIds: ['p1', 'p2'] }));
    recordRecentSearch(state('timeout', { projectIds: ['p2', 'p1'] }));
    const list = loadRecentSearches();
    expect(list).toHaveLength(2);
    expect(list[0].projectIds).toEqual(['p2', 'p1']);
    expect(list[1].projectIds).toEqual(['p1']);
  });

  it('treats another time range as a different entry', () => {
    recordRecentSearch(state('timeout', { range: '24h' }));
    recordRecentSearch(state('timeout', { range: '7d' }));
    recordRecentSearch(
      state('timeout', { range: undefined, from: '2026-10-22T10:00:00.000Z', to: '2026-10-22T11:00:00.000Z' }),
    );
    recordRecentSearch(
      state('timeout', { range: undefined, from: '2026-10-22T10:00:00.000Z', to: '2026-10-22T11:00:00.000Z' }),
    );
    expect(loadRecentSearches()).toHaveLength(3);
  });

  it('never records an empty query', () => {
    recordRecentSearch(state('first'));
    expect(recordRecentSearch(state(''))).toHaveLength(1);
    expect(recordRecentSearch(state('   '))).toHaveLength(1);
    expect(loadRecentSearches().map((r) => r.q)).toEqual(['first']);
  });

  it('stores the trimmed query', () => {
    recordRecentSearch(state('  level:error  '));
    recordRecentSearch(state('level:error'));
    const list = loadRecentSearches();
    expect(list).toHaveLength(1);
    expect(list[0].q).toBe('level:error');
  });

  it('migrates legacy string entries once', () => {
    localStorage.setItem(LEGACY_RECENT_SEARCHES_KEY, JSON.stringify(['timeout', 42, '', 'level:error']));
    const list = loadRecentSearches();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ q: 'timeout', projectIds: [] });
    expect(list[1]).toMatchObject({ q: 'level:error', projectIds: [] });
    expect(typeof list[0].at).toBe('string');
    expect(localStorage.getItem(LEGACY_RECENT_SEARCHES_KEY)).toBeNull();
    expect(stored().map((r) => r.q)).toEqual(['timeout', 'level:error']);

    // a legacy key that shows up again is ignored once v2 exists
    localStorage.setItem(LEGACY_RECENT_SEARCHES_KEY, JSON.stringify(['other']));
    expect(loadRecentSearches().map((r) => r.q)).toEqual(['timeout', 'level:error']);
    expect(localStorage.getItem(LEGACY_RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, '{not json');
    expect(loadRecentSearches()).toEqual([]);
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([
        null,
        'plain',
        { q: 'ok', projectIds: ['p1'], range: '1h', at: '2026-10-22T10:00:00.000Z' },
        { q: 3, projectIds: [], at: 'x' },
        { q: 'bad projects', projectIds: 'p1', at: 'x' },
        { q: '', projectIds: [], at: 'x' },
      ]),
    );
    expect(loadRecentSearches()).toEqual([
      { q: 'ok', projectIds: ['p1'], range: '1h', at: '2026-10-22T10:00:00.000Z' },
    ]);
  });

  it('clears', () => {
    recordRecentSearch(state('timeout'));
    clearRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('records immediately on submit', () => {
    vi.useFakeTimers();
    const record = vi.fn();
    const recorder = createRecentRecorder(record);
    recorder.submit(state('timeout'));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(state('timeout'));
  });

  it('records 3 s after results load', () => {
    vi.useFakeTimers();
    const record = vi.fn();
    const recorder = createRecentRecorder(record);
    recorder.loaded(state('timeout'));
    vi.advanceTimersByTime(2999);
    expect(record).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(state('timeout'));
  });

  it('a new load reschedules and records only the latest state', () => {
    vi.useFakeTimers();
    const record = vi.fn();
    const recorder = createRecentRecorder(record, 1000);
    recorder.loaded(state('first'));
    vi.advanceTimersByTime(900);
    recorder.loaded(state('second'));
    vi.advanceTimersByTime(900);
    expect(record).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(state('second'));
  });

  it('submit cancels a pending delayed record', () => {
    vi.useFakeTimers();
    const record = vi.fn();
    const recorder = createRecentRecorder(record);
    recorder.loaded(state('old'));
    recorder.submit(state('new'));
    vi.advanceTimersByTime(5000);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(state('new'));
  });

  it('cancel prevents the delayed record', () => {
    vi.useFakeTimers();
    const record = vi.fn();
    const recorder = createRecentRecorder(record);
    recorder.loaded(state('timeout'));
    vi.advanceTimersByTime(2000);
    recorder.cancel();
    vi.advanceTimersByTime(5000);
    expect(record).not.toHaveBeenCalled();
  });

  it('works when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadRecentSearches()).toEqual([]);
    const list = recordRecentSearch(state('timeout'));
    expect(list.map((r) => r.q)).toEqual(['timeout']);
    recordRecentSearch(state('level:error'));
    expect(loadRecentSearches().map((r) => r.q)).toEqual(['level:error', 'timeout']);
    expect(() => clearRecentSearches()).not.toThrow();
    expect(loadRecentSearches()).toEqual([]);
  });

  it('labels with the query cut to 40 chars', () => {
    const short: RecentSearch = { q: 'level:error', projectIds: [], at: '2026-10-22T10:00:00.000Z' };
    expect(recentLabel(short)).toBe('level:error');
    const long: RecentSearch = { ...short, q: 'a'.repeat(60) };
    const label = recentLabel(long);
    expect(label).toHaveLength(40);
    expect(label.startsWith('a'.repeat(39))).toBe(true);
    expect(label.endsWith('…')).toBe(true);
    const exact: RecentSearch = { ...short, q: 'b'.repeat(40) };
    expect(recentLabel(exact)).toBe('b'.repeat(40));
  });
});
