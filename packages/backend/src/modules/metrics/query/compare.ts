// compareTo: the same queries over an earlier window, shifted forward onto
// the current one.

import type { MetricCompareTo } from '@logtide/shared';

const HOUR_MS = 3_600_000;

export const COMPARE_OFFSET_MS: Record<Exclude<MetricCompareTo, 'none'>, number> = {
  '1h': HOUR_MS,
  '1d': 24 * HOUR_MS,
  '1w': 7 * 24 * HOUR_MS,
};

export function compareOffsetMs(compareTo: MetricCompareTo | undefined): number {
  if (!compareTo || compareTo === 'none') return 0;
  return COMPARE_OFFSET_MS[compareTo] ?? 0;
}

/** The earlier window to read for a comparison. */
export function shiftWindow(from: Date, to: Date, offsetMs: number): { from: Date; to: Date } {
  return { from: new Date(from.getTime() - offsetMs), to: new Date(to.getTime() - offsetMs) };
}
