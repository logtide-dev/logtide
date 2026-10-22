// Stale-response guard for the explorer's async requests.
//
// Each request kind (rows, load-more, histogram, facets) owns one guard. A new
// query, a scope change or Refresh calls `begin()` (or `invalidate()`), and a
// response is applied only when `isCurrent(token)` still holds, so a slow
// answer of an earlier run is never appended or shown.

export interface RequestGuard {
  /** Start a request: returns its token and makes every earlier token stale. */
  begin(): number;
  /** The latest token handed out (stale after `invalidate()`). */
  current(): number;
  isCurrent(token: number): boolean;
  /** Make every token handed out so far stale without starting a request. */
  invalidate(): void;
}

export function createRequestGuard(): RequestGuard {
  let latest = 0;
  let valid = false;
  return {
    begin() {
      latest += 1;
      valid = true;
      return latest;
    },
    current() {
      return latest;
    },
    isCurrent(token) {
      return valid && token === latest;
    },
    invalidate() {
      latest += 1;
      valid = false;
    },
  };
}
