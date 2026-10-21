import { describe, it, expect } from 'vitest';
import { ROW_HEIGHT, centerScrollTop, computeWindow, isNearBottom, revealScrollTop } from './virtual-window';

describe('computeWindow', () => {
  it('computes the window with overscan', () =>
    expect(computeWindow({ scrollTop: 3600, viewportHeight: 360, rowHeight: 36, count: 1000 })).toEqual({
      start: 90,
      end: 120,
      padTop: 3240,
      padBottom: 31680,
    }));

  it('clamps at both ends', () => {
    const top = computeWindow({ scrollTop: 0, viewportHeight: 360, rowHeight: 36, count: 1000 });
    expect(top.start).toBe(0);
    expect(top.padTop).toBe(0);
    const bottom = computeWindow({ scrollTop: 99999, viewportHeight: 360, rowHeight: 36, count: 1000 });
    expect(bottom.end).toBe(1000);
    expect(bottom.padBottom).toBe(0);
    expect(bottom.start).toBeLessThan(bottom.end);
    expect(bottom.padTop).toBe(bottom.start * 36);
  });

  it('treats a zero viewport as 600px', () =>
    expect(computeWindow({ scrollTop: 0, viewportHeight: 0, rowHeight: 36, count: 1000 }).end).toBe(27));

  it('handles short and empty lists', () => {
    expect(computeWindow({ scrollTop: 0, viewportHeight: 360, rowHeight: 36, count: 3 })).toEqual({
      start: 0,
      end: 3,
      padTop: 0,
      padBottom: 0,
    });
    expect(computeWindow({ scrollTop: 500, viewportHeight: 360, rowHeight: 36, count: 0 })).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it('accepts a custom overscan and a negative scroll', () => {
    expect(computeWindow({ scrollTop: 3600, viewportHeight: 360, rowHeight: 36, count: 1000, overscan: 0 })).toEqual({
      start: 100,
      end: 110,
      padTop: 3600,
      padBottom: 32040,
    });
    expect(computeWindow({ scrollTop: -50, viewportHeight: 360, rowHeight: 36, count: 1000 }).start).toBe(0);
  });

  it('keeps padding plus rows equal to the full list height', () => {
    for (const scrollTop of [0, 17, 1234, 20000, 35640]) {
      const w = computeWindow({ scrollTop, viewportHeight: 360, rowHeight: 28, count: 1000 });
      expect(w.padTop + (w.end - w.start) * 28 + w.padBottom).toBe(28000);
    }
  });
});

describe('scroll targets', () => {
  it('centers and reveals rows', () => {
    expect(centerScrollTop(100, 36, 360)).toBe(3438);
    expect(revealScrollTop(5, 36, 360, 0)).toBe(0);
    expect(revealScrollTop(20, 36, 360, 0)).toBe(396);
  });

  it('never centers above the top', () => expect(centerScrollTop(1, 36, 360)).toBe(0));

  it('reveals a row above the viewport at the top edge', () => expect(revealScrollTop(5, 36, 360, 1000)).toBe(180));

  it('keeps the scroll position for a visible row', () => expect(revealScrollTop(30, 36, 360, 1000)).toBe(1000));
});

describe('isNearBottom', () => {
  it('detects the bottom threshold', () => {
    expect(isNearBottom({ scrollTop: 640, viewportHeight: 360, contentHeight: 1360, threshold: 360 })).toBe(true);
    expect(isNearBottom({ scrollTop: 0, viewportHeight: 360, contentHeight: 1360, threshold: 360 })).toBe(false);
  });
});

describe('ROW_HEIGHT', () => {
  it('matches the h-9 and h-7 row classes', () => expect(ROW_HEIGHT).toEqual({ comfortable: 36, compact: 28 }));
});
