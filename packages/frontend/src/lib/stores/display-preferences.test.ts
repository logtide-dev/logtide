import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get as storeGet } from 'svelte/store';

// $app/environment is a SvelteKit virtual module that does not resolve under
// plain vitest; mock it as a browser context so the localStorage path runs.
vi.mock('$app/environment', () => ({ browser: true }));

const STORAGE_KEY = 'logtide_display_prefs';

async function freshStore() {
  vi.resetModules();
  const mod = await import('./display-preferences.js');
  return mod.displayPreferences;
}

describe('resolveTimeZone', () => {
  it('treats null, browser and empty as the browser zone', async () => {
    vi.resetModules();
    const { resolveTimeZone, BROWSER_TIME_ZONE } = await import('./display-preferences.js');
    expect(BROWSER_TIME_ZONE).toBe('browser');
    expect(resolveTimeZone(null)).toBeUndefined();
    expect(resolveTimeZone(undefined)).toBeUndefined();
    expect(resolveTimeZone('browser')).toBeUndefined();
    expect(resolveTimeZone('')).toBeUndefined();
  });

  it('passes real zones through', async () => {
    vi.resetModules();
    const { resolveTimeZone } = await import('./display-preferences.js');
    expect(resolveTimeZone('UTC')).toBe('UTC');
    expect(resolveTimeZone('Europe/Rome')).toBe('Europe/Rome');
  });
});

describe('displayPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults to 24h and the browser timezone', async () => {
    const store = await freshStore();
    expect(store.get()).toEqual({ hour12: false, timeZone: null });
  });

  it('round-trips through localStorage', async () => {
    const store = await freshStore();
    store.set({ hour12: true, timeZone: 'America/Los_Angeles' });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
      hour12: true,
      timeZone: 'America/Los_Angeles',
    });

    const reloaded = await freshStore();
    expect(reloaded.get()).toEqual({ hour12: true, timeZone: 'America/Los_Angeles' });
  });

  it('loads a persisted browser zone as is', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hour12: true, timeZone: 'browser' }));
    const store = await freshStore();
    expect(store.get()).toEqual({ hour12: true, timeZone: 'browser' });
  });

  it('falls back to defaults on corrupted JSON', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const store = await freshStore();
    expect(store.get()).toEqual({ hour12: false, timeZone: null });
  });

  it('falls back to defaults on a wrong-shaped payload', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hour12: 'yes', timeZone: 12 }));
    const store = await freshStore();
    expect(store.get()).toEqual({ hour12: false, timeZone: null });
  });

  // Regression: get() must return the in-memory value, not re-read localStorage.
  it('get() returns the value set in-session when localStorage is blocked', async () => {
    const store = await freshStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    const value = { hour12: true, timeZone: 'UTC' };
    store.set(value);

    expect(store.get()).toEqual(value);
    expect(storeGet(store)).toEqual(value);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
