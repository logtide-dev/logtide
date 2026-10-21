// Which body the explorer shows under the query bar (spec 5.4 empty and error states).

export type ResultsState = 'loading' | 'error' | 'onboarding' | 'no-results' | 'results';

export interface ResultsStateInput {
  /** The first page of the current run has been requested at least once. */
  hasRun: boolean;
  loading: boolean;
  /** The first page of the current run failed; a failed load-more never sets this. */
  error: string | null;
  rowCount: number;
  /** Projects the user can see in the organization. */
  projectCount: number;
  /** Whether the scoped projects ever received a log; null while unknown. */
  everReceivedLogs: boolean | null;
}

/**
 * Precedence: error > loading (no rows yet and loading or not run) > results >
 * onboarding (no project, or the scoped projects never received a log) > no-results.
 * An unknown `everReceivedLogs` shows "no results", never the onboarding nag.
 */
export function resolveResultsState(i: ResultsStateInput): ResultsState {
  if (i.error !== null) return 'error';
  if (i.rowCount === 0 && (i.loading || !i.hasRun)) return 'loading';
  if (i.rowCount > 0) return 'results';
  if (i.projectCount === 0 || i.everReceivedLogs === false) return 'onboarding';
  return 'no-results';
}
