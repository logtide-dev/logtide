import { TIME_RANGE_LABELS, type TimeRangePreset } from '@logtide/shared';
import { formatRange, getDisplayZoneLabel } from '$lib/utils/datetime';
import type { TimeRangeValue } from '$lib/stores/scope-url';

// Thin wrappers over the shared datetime formatter, which reads the display
// preferences (clock format and time zone) at call time. No date formatting
// lives here.

/** `UTC`, `UTC+2`, `UTC-5`, `UTC+5:30` for the display zone at the given instant. */
export function zoneLabel(at: Date = new Date()): string {
  return getDisplayZoneLabel(at);
}

export function formatRangeLabel(from: Date, to: Date): string {
  return formatRange(from, to);
}

export function presetLabel(preset: TimeRangePreset): string {
  return TIME_RANGE_LABELS[preset];
}

export function rangeLabel(value: TimeRangeValue): string {
  if (value.kind === 'preset') return presetLabel(value.preset);
  return formatRangeLabel(new Date(value.from), new Date(value.to));
}
