import { describe, it, expect } from 'vitest';
import { PANEL_TIME_RANGES, PANEL_TIME_RANGE_LABELS } from './dashboard.js';
import {
  TIME_RANGE_PRESETS,
  TIME_RANGE_LABELS,
  timeRangePresetToMs,
  isTimeRangePreset,
} from './time-range.js';

describe('time range aliases', () => {
  it('reuses the panel catalog objects', () => {
    expect(TIME_RANGE_PRESETS).toBe(PANEL_TIME_RANGES);
    expect(TIME_RANGE_LABELS).toBe(PANEL_TIME_RANGE_LABELS);
    expect(TIME_RANGE_PRESETS.length).toBe(10);
  });

  it('converts presets to milliseconds', () => {
    expect(timeRangePresetToMs('15m')).toBe(900000);
    expect(timeRangePresetToMs('1h')).toBe(3600000);
    expect(timeRangePresetToMs('30d')).toBe(2592000000);
  });

  it('has sentence case labels', () => {
    expect(TIME_RANGE_LABELS['1h']).toBe('Last hour');
  });

  it('guards preset values', () => {
    expect(isTimeRangePreset('7d')).toBe(true);
    expect(isTimeRangePreset('bogus')).toBe(false);
    expect(isTimeRangePreset(undefined)).toBe(false);
    expect(isTimeRangePreset('')).toBe(false);
  });
});
