import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get as storeGet } from 'svelte/store';

// $app/environment is a SvelteKit virtual module that does not resolve under
// plain vitest; mock it as a browser context so the localStorage path runs.
vi.mock('$app/environment', () => ({ browser: true }));

import { scopeStore } from './scope.js';

// Regression: get() must return the in-memory value, not re-read localStorage.
// If localStorage.setItem is blocked (private mode, quota, disabled), set() still
// updates subscribers, so get() must agree with them within the session instead
// of falling back to a stale/empty localStorage read.
describe('scopeStore falls back to memory when localStorage is blocked', () => {
  let setItem: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    scopeStore.reset();
    setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
  });

  afterEach(() => {
    setItem.mockRestore();
    localStorage.clear();
  });

  it('get() returns the range set in-session', () => {
    const range = { kind: 'custom' as const, from: '2026-07-01T00:00:00.000Z', to: '2026-07-02T00:00:00.000Z' };
    scopeStore.setRange(range);

    expect(scopeStore.get().range).toEqual(range);
    expect(storeGet(scopeStore).range).toEqual(range);
    expect(localStorage.getItem('logtide_scope')).toBeNull();
  });

  it('get() returns the projects set in-session', () => {
    scopeStore.setProjects(['project-123']);

    expect(scopeStore.get().projectIds).toEqual(['project-123']);
    expect(storeGet(scopeStore).projectIds).toEqual(['project-123']);
    expect(localStorage.getItem('logtide_scope')).toBeNull();
  });
});

describe('legacy keys', () => {
  beforeEach(() => {
    localStorage.clear();
    scopeStore.reset();
  });

  it('are no longer written', () => {
    scopeStore.setProjects(['p1']);
    scopeStore.setRange({ kind: 'preset', preset: '1h' });
    expect(localStorage.getItem('logtide_current_project')).toBeNull();
    expect(localStorage.getItem('logtide_time_range')).toBeNull();
  });
});
