import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get as storeGet } from 'svelte/store';

// $app/environment is a SvelteKit virtual module that does not resolve under
// plain vitest; mock it as a browser context so the localStorage path runs.
vi.mock('$app/environment', () => ({ browser: true }));

import { timeRangeStore } from './time-range.js';
import { currentProjectStore } from './current-project.js';
import { scopeStore } from './scope.js';

// Regression: get() must return the in-memory value, not re-read localStorage.
// If localStorage.setItem is blocked (private mode, quota, disabled), set() still
// updates subscribers, so get() must agree with them within the session instead
// of falling back to a stale/empty localStorage read.
describe('session persistence stores fall back to memory when localStorage is blocked', () => {
  let setItem: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
  });

  afterEach(() => {
    setItem.mockRestore();
    localStorage.clear();
  });

  it('timeRangeStore.get() returns the value set in-session', () => {
    const value = { type: 'custom', from: '2026-07-01T00:00', to: '2026-07-02T00:00' };
    timeRangeStore.set(value);

    expect(timeRangeStore.get()).toEqual(value);
    expect(storeGet(timeRangeStore)).toEqual(value);
    // localStorage write was attempted but rejected, so it stays empty.
    expect(localStorage.getItem('logtide_time_range')).toBeNull();
  });

  it('currentProjectStore.get() returns the value set in-session', () => {
    currentProjectStore.set('project-123');

    expect(currentProjectStore.get()).toBe('project-123');
    expect(storeGet(currentProjectStore)).toBe('project-123');
    expect(localStorage.getItem('logtide_current_project')).toBeNull();
  });
});

describe('legacy facades share state with scopeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    scopeStore.reset();
  });

  it('facades share state with scopeStore', () => {
    currentProjectStore.set('p1');
    expect(scopeStore.get().projectIds).toEqual(['p1']);

    scopeStore.setProjects(['p2', 'p3']);
    expect(currentProjectStore.get()).toBe('p2');
    expect(storeGet(currentProjectStore)).toBe('p2');

    timeRangeStore.set({ type: 'last_7d', from: '', to: '' });
    expect(scopeStore.get().range).toEqual({ kind: 'preset', preset: '7d' });

    scopeStore.setRange({ kind: 'preset', preset: '6h' });
    expect(timeRangeStore.get()).toEqual({ type: '6h', from: '', to: '' });
    expect(storeGet(timeRangeStore)).toEqual({ type: '6h', from: '', to: '' });

    currentProjectStore.set(null);
    expect(scopeStore.get().projectIds).toEqual([]);
    expect(currentProjectStore.get()).toBeNull();
  });

  it('timeRangeStore.set(null) resets to the default range', () => {
    scopeStore.setRange({ kind: 'preset', preset: '6h' });
    timeRangeStore.set(null);
    expect(scopeStore.get().range).toEqual({ kind: 'preset', preset: '24h' });
  });

  it('no longer writes the legacy keys', () => {
    currentProjectStore.set('p1');
    timeRangeStore.set({ type: 'last_hour', from: '', to: '' });
    expect(localStorage.getItem('logtide_current_project')).toBeNull();
    expect(localStorage.getItem('logtide_time_range')).toBeNull();
  });
});
