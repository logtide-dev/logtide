import { describe, it, expect } from 'vitest';
import { barGeometry, spanBarClass, MIN_BAR_WIDTH_PERCENT } from './waterfall';
import { stateTone } from '$lib/utils/severity';

const T0 = Date.parse('2026-10-22T10:00:00.000Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

describe('barGeometry', () => {
  it('positions a normal span', () => {
    const g = barGeometry({ start_time: iso(250), end_time: iso(750), duration_ms: 500 }, T0, 1000);
    expect(g.left).toBeCloseTo(25);
    expect(g.width).toBeCloseTo(50);
  });

  it('clamps a child that starts before the trace', () => {
    const g = barGeometry({ start_time: iso(-200), end_time: iso(300), duration_ms: 500 }, T0, 1000);
    expect(g.left).toBe(0);
    expect(g.width).toBeCloseTo(30);
  });

  it('clamps a span that ends after the trace', () => {
    const g = barGeometry({ start_time: iso(900), end_time: iso(2000), duration_ms: 1100 }, T0, 1000);
    expect(g.left).toBeCloseTo(90);
    expect(g.left + g.width).toBeLessThanOrEqual(100);
  });

  it('handles zero trace duration', () => {
    const g = barGeometry({ start_time: iso(0), end_time: iso(0), duration_ms: 0 }, T0, 0);
    expect(Number.isFinite(g.left)).toBe(true);
    expect(Number.isFinite(g.width)).toBe(true);
    expect(g.left).toBeGreaterThanOrEqual(0);
    expect(g.left + g.width).toBeLessThanOrEqual(100);
  });

  it('enforces min width', () => {
    const g = barGeometry({ start_time: iso(500), end_time: iso(500), duration_ms: 0 }, T0, 100000);
    expect(g.width).toBe(MIN_BAR_WIDTH_PERCENT);
  });

  it('keeps a zero duration span at the right edge inside the track', () => {
    const g = barGeometry({ start_time: iso(1000), end_time: iso(1000), duration_ms: 0 }, T0, 1000);
    expect(g.left + g.width).toBeLessThanOrEqual(100);
    expect(g.width).toBeGreaterThanOrEqual(MIN_BAR_WIDTH_PERCENT);
  });

  it('survives a missing end time and an end before start', () => {
    const noEnd = barGeometry(
      { start_time: iso(100), end_time: undefined as unknown as string, duration_ms: 200 },
      T0,
      1000
    );
    expect(noEnd.left).toBeCloseTo(10);
    expect(noEnd.width).toBeCloseTo(20);

    const inverted = barGeometry({ start_time: iso(500), end_time: iso(100), duration_ms: 100 }, T0, 1000);
    expect(inverted.left).toBeCloseTo(50);
    expect(inverted.width).toBeCloseTo(10);
  });

  it('never returns NaN for garbage input', () => {
    const g = barGeometry({ start_time: 'nope', end_time: 'nope', duration_ms: NaN }, T0, NaN);
    expect(Number.isFinite(g.left)).toBe(true);
    expect(Number.isFinite(g.width)).toBe(true);
  });
});

describe('spanBarClass', () => {
  it('uses the failed tone for ERROR', () => {
    expect(spanBarClass({ status_code: 'ERROR', service_name: 'api' })).toBe(stateTone('failed').dot);
  });

  it('is stable per service and never an error colour otherwise', () => {
    const a = spanBarClass({ status_code: 'OK', service_name: 'checkout' });
    expect(spanBarClass({ status_code: null, service_name: 'checkout' })).toBe(a);
    expect(a).not.toBe(stateTone('failed').dot);
    expect(a).not.toMatch(/red|destructive/);
  });
});
