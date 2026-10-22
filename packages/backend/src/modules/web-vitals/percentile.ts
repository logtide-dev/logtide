/**
 * Percentile of an ascending sorted array with linear interpolation
 * (the "inclusive" method: rank = p * (n - 1)).
 *
 * `p` is a fraction in [0, 1] (0.75 for p75). Returns null for empty input.
 */
export function percentile(sorted: number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  const clamped = Math.min(1, Math.max(0, p));
  const rank = clamped * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}
