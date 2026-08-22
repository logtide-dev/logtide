import { describe, it, expect } from 'vitest';
import {
  PANEL_TIME_RANGES,
  PANEL_TIME_RANGE_MS,
  PANEL_TIME_RANGE_LABELS,
  panelTimeRangeToMs,
} from './dashboard.js';

describe('panel time range catalog', () => {
  it('has an ms value and a label for every preset', () => {
    for (const range of PANEL_TIME_RANGES) {
      expect(PANEL_TIME_RANGE_MS[range]).toBeGreaterThan(0);
      expect(PANEL_TIME_RANGE_LABELS[range]).toBeTruthy();
    }
    expect(Object.keys(PANEL_TIME_RANGE_MS).sort()).toEqual([...PANEL_TIME_RANGES].sort());
    expect(Object.keys(PANEL_TIME_RANGE_LABELS).sort()).toEqual([...PANEL_TIME_RANGES].sort());
  });

  it('is ordered from shortest to longest window', () => {
    const values = PANEL_TIME_RANGES.map((r) => PANEL_TIME_RANGE_MS[r]);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it('covers every preset previously accepted by any panel enum', () => {
    // Union of the pre-#305 per-panel enums; losing one would break stored dashboards.
    for (const legacy of ['15m', '1h', '6h', '24h', '7d', '30d']) {
      expect(PANEL_TIME_RANGES).toContain(legacy);
    }
  });

  it('resolves known presets and falls back to 24h for unknown strings', () => {
    expect(panelTimeRangeToMs('48h')).toBe(48 * 60 * 60 * 1000);
    expect(panelTimeRangeToMs('3d')).toBe(3 * 24 * 60 * 60 * 1000);
    expect(panelTimeRangeToMs('bogus')).toBe(24 * 60 * 60 * 1000);
  });
});
