import { describe, it, expect } from 'vitest';
import { createSkewTracker } from '../../../modules/ingestion/skew.js';

const NOW = new Date('2026-07-17T12:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms);

describe('createSkewTracker', () => {
  it('returns null when nothing is skewed', () => {
    const t = createSkewTracker(NOW);
    t.observe(ago(0));
    t.observe(ago(60_000));
    t.observe(ago(86_399_000));
    expect(t.summary()).toBeNull();
  });

  it('counts a log older than the past threshold and records the worst delta', () => {
    const t = createSkewTracker(NOW);
    t.observe(ago(97_200_000)); // 27h in the past, the #279 case
    t.observe(ago(90_000_000)); // 25h, skewed but less extreme
    expect(t.summary()).toEqual({ count: 2, maxPastMs: 97_200_000, maxFutureMs: 0 });
  });

  it('counts a log ahead of the future threshold and records the worst delta', () => {
    const t = createSkewTracker(NOW);
    t.observe(ago(-600_000)); // 10m in the future
    expect(t.summary()).toEqual({ count: 1, maxPastMs: 0, maxFutureMs: 600_000 });
  });

  it('tracks both directions in one batch', () => {
    const t = createSkewTracker(NOW);
    t.observe(ago(97_200_000));
    t.observe(ago(-600_000));
    t.observe(ago(1000));
    expect(t.summary()).toEqual({ count: 2, maxPastMs: 97_200_000, maxFutureMs: 600_000 });
  });

  it('does not count an Invalid Date as skew', () => {
    const t = createSkewTracker(NOW);
    t.observe(new Date('garbage'));
    expect(t.summary()).toBeNull();
  });

  it('does not count a missing time', () => {
    const t = createSkewTracker(NOW);
    t.observe(undefined);
    expect(t.summary()).toBeNull();
  });
});
