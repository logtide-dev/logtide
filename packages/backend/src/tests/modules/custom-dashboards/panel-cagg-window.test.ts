import { describe, it, expect } from 'vitest';
import { computeCaggBackfillWindow } from '../../../modules/custom-dashboards/panel-data-service.js';

// Regression coverage for #274: the Activity Overview panel read continuous
// aggregates for the whole window, so the most recent 1-2 (unmaterialized) buckets
// showed empty while logs were still arriving. The fix reads the cagg up to
// `caggCutoff` and backfills [caggCutoff, now] from the raw tables. These tests pin
// the boundary math that keeps the two reads disjoint and the tail inclusive of now.
describe('computeCaggBackfillWindow', () => {
  it('cuts the cagg off two whole hours before the current hour bucket', () => {
    const now = new Date('2026-07-07T15:52:34.123Z');
    const { caggCutoff, tailEnd } = computeCaggBackfillWindow(now, 'hour');

    expect(caggCutoff.toISOString()).toBe('2026-07-07T13:00:00.000Z');
    // tailEnd is exclusive but one ms past now, so `time < tailEnd` still includes now.
    expect(tailEnd.getTime()).toBe(now.getTime() + 1);
    expect(tailEnd.getTime()).toBeGreaterThan(now.getTime());
  });

  it('cuts the cagg off two whole days before the current day bucket', () => {
    const now = new Date('2026-07-07T15:52:34.123Z');
    const { caggCutoff, tailEnd } = computeCaggBackfillWindow(now, 'day');

    expect(caggCutoff.toISOString()).toBe('2026-07-05T00:00:00.000Z');
    expect(tailEnd.getTime()).toBe(now.getTime() + 1);
  });

  it('aligns the cutoff to the bucket boundary (zeroed sub-bucket fields)', () => {
    const now = new Date('2026-07-07T15:52:34.123Z');

    const hourCutoff = computeCaggBackfillWindow(now, 'hour').caggCutoff;
    expect(hourCutoff.getUTCMinutes()).toBe(0);
    expect(hourCutoff.getUTCSeconds()).toBe(0);
    expect(hourCutoff.getUTCMilliseconds()).toBe(0);

    const dayCutoff = computeCaggBackfillWindow(now, 'day').caggCutoff;
    expect(dayCutoff.getUTCHours()).toBe(0);
    expect(dayCutoff.getUTCMinutes()).toBe(0);
  });

  it('keeps the cutoff strictly before now so the raw tail is non-empty', () => {
    const now = new Date('2026-07-07T15:00:00.000Z'); // exactly on a bucket boundary
    const { caggCutoff } = computeCaggBackfillWindow(now, 'hour');

    // Even when now sits on a boundary, the cutoff is two full buckets back.
    expect(caggCutoff.toISOString()).toBe('2026-07-07T13:00:00.000Z');
    expect(caggCutoff.getTime()).toBeLessThan(now.getTime());
  });
});
