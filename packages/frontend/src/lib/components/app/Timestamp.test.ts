import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { displayPreferences } from '$lib/stores/display-preferences';
import Timestamp from './Timestamp.svelte';

const ISO = '2026-03-05T21:07:09.047Z';

beforeEach(() => {
  vi.useFakeTimers();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
  // jsdom schedules a storage event timer when the store persists; drop it
  vi.clearAllTimers();
  vi.setSystemTime(new Date('2026-03-05T22:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  displayPreferences.set({ hour12: false, timeZone: null });
});

describe('Timestamp', () => {
  it('renders the absolute time with a datetime attribute', () => {
    const { container } = render(Timestamp, { value: ISO });
    const el = container.querySelector('time')!;
    expect(el.textContent).toBe('Mar 5, 21:07:09');
    expect(el.getAttribute('datetime')).toBe(ISO);
  });

  it('honours precision and showZone', () => {
    const { container } = render(Timestamp, { value: ISO, precision: 'ms', showZone: true });
    expect(container.querySelector('time')!.textContent).toBe('Mar 5, 21:07:09.047 UTC');
  });

  it('title holds the full absolute timestamp with ms', () => {
    const { container } = render(Timestamp, { value: ISO });
    const title = container.querySelector('time')!.getAttribute('title')!;
    expect(title).toContain('21:07:09.047');
    expect(title).toContain('UTC');
  });

  it('re-renders when display preferences change', async () => {
    const { container } = render(Timestamp, { value: ISO });
    displayPreferences.set({ hour12: true, timeZone: 'UTC' });
    await tick();
    expect(container.querySelector('time')!.textContent).toBe('Mar 5, 09:07:09 PM');
  });

  it('relative mode refreshes every 30 seconds', async () => {
    const { container } = render(Timestamp, { value: '2026-03-05T21:55:00Z', relative: true });
    await tick();
    expect(container.querySelector('time')!.textContent).toBe('5 minutes ago');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(container.querySelector('time')!.textContent).toBe('6 minutes ago');
  });

  it.each([['garbage'], [null], [undefined], ['']])('renders a dash for %s', (v) => {
    const { container } = render(Timestamp, { value: v as any });
    expect(container.querySelector('time')).toBeNull();
    expect(container.textContent?.trim()).toBe('-');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a timer for an invalid relative value', () => {
    render(Timestamp, { value: 'garbage', relative: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the interval on unmount', async () => {
    const { unmount } = render(Timestamp, { value: ISO, relative: true });
    await tick();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
