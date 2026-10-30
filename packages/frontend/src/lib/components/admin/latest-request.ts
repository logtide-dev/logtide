/**
 * Race guard for async loads keyed by a changing input (e.g. the selected
 * organization): only the response of the most recent request may be applied.
 */
export function createLatestGuard() {
  let current = 0;
  return {
    /** Start a request; returns its ticket. Invalidates every earlier ticket. */
    begin(): number {
      current += 1;
      return current;
    },
    /** True while no newer request has started. */
    isCurrent(ticket: number): boolean {
      return ticket === current;
    },
    /** Invalidate every in-flight request without starting a new one. */
    cancel(): void {
      current += 1;
    },
  };
}
