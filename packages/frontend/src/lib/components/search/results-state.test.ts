import { describe, it, expect } from 'vitest';
import { resolveResultsState } from './results-state';

describe('resolveResultsState', () => {
  it.each([
    [{ hasRun: true, loading: false, error: 'boom', rowCount: 0, projectCount: 1, everReceivedLogs: true }, 'error'],
    [{ hasRun: false, loading: false, error: null, rowCount: 0, projectCount: 1, everReceivedLogs: true }, 'loading'],
    [{ hasRun: true, loading: true, error: null, rowCount: 0, projectCount: 1, everReceivedLogs: true }, 'loading'],
    [{ hasRun: true, loading: true, error: null, rowCount: 3, projectCount: 1, everReceivedLogs: true }, 'results'],
    [{ hasRun: true, loading: false, error: null, rowCount: 0, projectCount: 0, everReceivedLogs: null }, 'onboarding'],
    [{ hasRun: true, loading: false, error: null, rowCount: 0, projectCount: 2, everReceivedLogs: false }, 'onboarding'],
    [{ hasRun: true, loading: false, error: null, rowCount: 0, projectCount: 2, everReceivedLogs: true }, 'no-results'],
    [{ hasRun: true, loading: false, error: null, rowCount: 0, projectCount: 2, everReceivedLogs: null }, 'no-results'],
  ] as const)('resolves %o to %s', (i, s) => expect(resolveResultsState(i)).toBe(s));

  it('puts a first-page error ahead of rows', () =>
    // error means the first page failed, so it wins whatever the row count
    expect(
      resolveResultsState({ hasRun: true, loading: false, error: 'boom', rowCount: 5, projectCount: 1, everReceivedLogs: true }),
    ).toBe('error'));

  it('keeps results ahead of onboarding', () =>
    expect(
      resolveResultsState({ hasRun: true, loading: false, error: null, rowCount: 2, projectCount: 0, everReceivedLogs: false }),
    ).toBe('results'));
});
