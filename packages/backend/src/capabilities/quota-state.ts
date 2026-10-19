export type QuotaState = 'ok' | 'grace' | 'blocked' | 'unlimited';

/**
 * Pure quota state. Blocked when usage >= limit * (1 + grace/100); in grace when
 * limit <= usage < that ceiling. graceNull/0 collapses the band, so the first
 * state past the limit is 'blocked' (current behaviour).
 */
export function computeQuotaState(
  usage: number,
  limit: number | null,
  gracePercent: number | null
): QuotaState {
  if (limit === null) return 'unlimited';
  const grace = gracePercent && gracePercent > 0 ? gracePercent : 0;
  // Cross-multiplied to avoid float error (100 * 1.1 = 110.00000000000001).
  const blocked = usage * 100 >= limit * (100 + grace);
  if (blocked) return 'blocked';
  if (usage >= limit) return 'grace';
  return 'ok';
}
