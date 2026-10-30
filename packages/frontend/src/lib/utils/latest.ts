/**
 * Latest-request guard. `begin()` marks a new request and returns a function
 * that reports whether that request is still the newest one, so a slow
 * response never overwrites a fresher one.
 */
export function createLatest(): { begin(): () => boolean } {
  let current = 0;
  return {
    begin() {
      const mine = ++current;
      return () => mine === current;
    },
  };
}
