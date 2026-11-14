import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startVisiblePolling } from './visible-polling';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('startVisiblePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => vi.useRealTimers());

  it('polls while visible, pauses while hidden, refreshes on return', () => {
    const tick = vi.fn();
    const stop = startVisiblePolling(tick, 1000);
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    expect(tick).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(5000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it('does not poll when started hidden', () => {
    setVisibility('hidden');
    const tick = vi.fn();
    const stop = startVisiblePolling(tick, 1000);
    vi.advanceTimersByTime(3000);
    expect(tick).not.toHaveBeenCalled();
    stop();
  });
});
