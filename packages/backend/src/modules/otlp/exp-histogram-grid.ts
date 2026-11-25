// Canonical grid of the exponential histograms (1.8): the single definition
// shared by the OTLP transformer (which re-buckets every exponential point
// onto it and stores only the grid id plus the counts) and the metrics query
// histogram math (which expands the grid id back to explicit bounds before
// any merge, diff or percentile).
//
// A grid id names an immutable set of explicit bounds. Never change the
// bounds of an existing id: add a new id (and keep the old one here) so
// points stored earlier keep their meaning.

/**
 * Canonical grid for exponential histograms converted to explicit buckets.
 *
 * Every exponential histogram point is re-bucketed onto ONE fixed set of
 * explicit bounds, whatever its scale, offset or populated range, so every
 * point of a series (and every series of a metric) carries identical buckets:
 * the histogram aggregations merge only points of the same grid, and a
 * cumulative series diffs cleanly snapshot to snapshot. Nothing is trimmed.
 *
 * Grid (OTLP explicit layout: counts has bounds.length + 1 entries, bucket i
 * holds (bounds[i-1], bounds[i]], the last one is +Inf):
 * - scale EXP_CANONICAL_SCALE = 2, base = 2^(2^-2) = 2^(1/4) ~ 1.1892;
 * - canonical bucket index i holds (base^i, base^(i+1)], for i from
 *   EXP_GRID_MIN_INDEX (-80) to EXP_GRID_MAX_INDEX (159): positive values
 *   from 2^-20 (~9.5e-7) to 2^40 (~1.1e12), 60 octaves of 4 buckets;
 * - bounds = [0, base^-80, base^-79, ..., base^160] (242 bounds, 243 counts):
 *   counts[0] = (-Inf, 0] holds zero_count and the negative buckets (folded
 *   for simplicity: percentiles read negative values as 0), counts[1] =
 *   (0, 2^-20] the positive values below the grid, then one count per
 *   canonical bucket, and the last one (2^40, +Inf) the values above it.
 *
 * Precision: neighbouring bounds differ by a factor 2^(1/4), so a bucket is
 * ~18.9% wide relative to its lower edge and a percentile interpolated inside
 * it is off by less than that (usually far less). Values outside
 * [2^-20, 2^40] only keep their side (underflow / overflow bucket).
 */
export const EXP_CANONICAL_SCALE = 2;
export const EXP_GRID_MIN_INDEX = -80;
export const EXP_GRID_MAX_INDEX = 159;

/** Id of the canonical grid above, stored in histogram_data.grid. */
export const EXP_GRID_ID = 'exp2-s2-v1';

/** base^i at the canonical scale, i.e. 2^(i / 4) (exact for multiples of 4). */
function canonicalBound(index: number): number {
  return Math.pow(2, index / Math.pow(2, EXP_CANONICAL_SCALE));
}

/** The canonical explicit bounds (always the same doubles). */
export const EXP_CANONICAL_BOUNDS: readonly number[] = Object.freeze([
  0,
  ...Array.from(
    { length: EXP_GRID_MAX_INDEX - EXP_GRID_MIN_INDEX + 2 },
    (_, k) => canonicalBound(EXP_GRID_MIN_INDEX + k),
  ),
]);

/** Every known grid id and its explicit bounds. */
const HISTOGRAM_GRIDS: ReadonlyMap<string, readonly number[]> = new Map([[EXP_GRID_ID, EXP_CANONICAL_BOUNDS]]);

/** The explicit bounds of a grid id, or undefined when the id is unknown. */
export function histogramGridBounds(grid: string): readonly number[] | undefined {
  return HISTOGRAM_GRIDS.get(grid);
}
