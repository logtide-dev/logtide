// ============================================================================
// Shared time range options for panel config forms (#305)
// ============================================================================
//
// The preset catalog lives in @logtide/shared next to the panel types, so the
// backend Zod validator and these UI options can never drift apart.

import { PANEL_TIME_RANGES, PANEL_TIME_RANGE_LABELS } from '@logtide/shared';
import type { PanelTimeRange } from '@logtide/shared';

export interface TimeRangeOption {
  value: PanelTimeRange;
  label: string;
}

export const TIME_RANGE_OPTIONS: TimeRangeOption[] = PANEL_TIME_RANGES.map((value) => ({
  value,
  label: PANEL_TIME_RANGE_LABELS[value],
}));

export function timeRangeLabel(value: string): string {
  return PANEL_TIME_RANGE_LABELS[value as PanelTimeRange] ?? value;
}
