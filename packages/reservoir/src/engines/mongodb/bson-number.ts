/** A JS number from a BSON numeric value, which may arrive as `Long` (promoteLongs off, or values above 2^53). */
export function toNumber(value: unknown): number {
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return Number(value.toNumber());
  }
  return Number(value);
}
