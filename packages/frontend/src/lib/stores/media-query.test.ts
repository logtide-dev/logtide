import { describe, it, expect, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { mediaQuery } from './media-query';

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

describe('mediaQuery', () => {
  it('is false when matchMedia is missing', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    expect(get(mediaQuery('(max-width: 10px)'))).toBe(false);
  });

  it('reads the current match and follows changes', () => {
    let handler: () => void = () => {};
    const list = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => (handler = fn),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
    const store = mediaQuery('(max-width: 10px)');
    const seen: boolean[] = [];
    const stop = store.subscribe((v) => seen.push(v));
    list.matches = false;
    handler();
    stop();
    expect(seen).toEqual([true, false]);
    expect(list.removeEventListener).toHaveBeenCalled();
  });
});
