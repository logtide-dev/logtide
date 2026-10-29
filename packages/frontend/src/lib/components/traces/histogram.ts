import { formatDuration } from './format';

/**
 * Buckets are upper-inclusive: `counts[i]` holds durations with
 * `bounds[i - 1] < d <= bounds[i]`, the last bucket (`i === bounds.length`) is
 * open ended. There are `bounds.length + 1` buckets.
 */
export function bucketLower(bounds: number[], index: number): number {
  return index <= 0 ? 0 : bounds[Math.min(index, bounds.length) - 1];
}

export function bucketUpper(bounds: number[], index: number): number | null {
  return index >= bounds.length ? null : bounds[Math.max(index, 0)];
}

/** "120ms to 250ms", first bucket "up to 1ms", last bucket "over 60s". */
export function bucketLabel(bounds: number[], index: number): string {
  const upper = bucketUpper(bounds, index);
  if (upper === null) return `over ${formatDuration(bounds[bounds.length - 1] ?? 0)}`;
  if (index <= 0) return `up to ${formatDuration(upper)}`;
  return `${formatDuration(bucketLower(bounds, index))} to ${formatDuration(upper)}`;
}

/** Short x axis label: the upper bound, or "max" for the open bucket. */
export function bucketAxisLabel(bounds: number[], index: number): string {
  const upper = bucketUpper(bounds, index);
  return upper === null ? `>${formatDuration(bounds[bounds.length - 1] ?? 0)}` : formatDuration(upper);
}

/**
 * Map a brushed bucket span to a duration range: lower bound of the first
 * selected bucket, upper bound of the last, `null` for the open last bucket.
 * Reversed indexes are swapped and out of range ones clamped.
 */
export function brushToRange(
  bounds: number[],
  startIndex: number,
  endIndex: number,
): { minMs: number; maxMs: number | null } {
  const last = bounds.length;
  const clamp = (n: number) => Math.min(Math.max(Math.round(Number.isFinite(n) ? n : 0), 0), last);
  const a = clamp(startIndex);
  const b = clamp(endIndex);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { minMs: bucketLower(bounds, lo), maxMs: bucketUpper(bounds, hi) };
}

/** Whether a bucket lies inside the selected duration range. */
export function bucketInSelection(
  bounds: number[],
  index: number,
  selection: { minMs: number | null; maxMs: number | null },
): boolean {
  if (selection.minMs === null && selection.maxMs === null) return false;
  const lower = bucketLower(bounds, index);
  const upper = bucketUpper(bounds, index);
  if (selection.minMs !== null && lower < selection.minMs) return false;
  if (selection.maxMs !== null && (upper === null || upper > selection.maxMs)) return false;
  return true;
}
