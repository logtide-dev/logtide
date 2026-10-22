/**
 * Drops stale async responses: take a token before a request, and only apply
 * the result when the token is still the latest one.
 */
export function createRequestGuard(): { next(): number; isLatest(token: number): boolean } {
  let latest = 0;
  return {
    next() {
      latest += 1;
      return latest;
    },
    isLatest(token: number) {
      return token === latest;
    },
  };
}
