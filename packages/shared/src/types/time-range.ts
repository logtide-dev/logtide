import {
  PANEL_TIME_RANGES,
  PANEL_TIME_RANGE_LABELS,
  panelTimeRangeToMs,
  type PanelTimeRange,
} from './dashboard.js';

// Shared names for the explore pages time scope. Same catalog as dashboard
// panels so every window picker offers the same presets.
export const TIME_RANGE_PRESETS = PANEL_TIME_RANGES;
export type TimeRangePreset = PanelTimeRange;
export const TIME_RANGE_LABELS = PANEL_TIME_RANGE_LABELS;

export function timeRangePresetToMs(preset: TimeRangePreset): number {
  return panelTimeRangeToMs(preset);
}

export function isTimeRangePreset(value: unknown): value is TimeRangePreset {
  return typeof value === 'string' && (TIME_RANGE_PRESETS as readonly string[]).includes(value);
}
