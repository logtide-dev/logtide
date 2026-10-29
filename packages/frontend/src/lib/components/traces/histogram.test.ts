import { describe, it, expect } from 'vitest';
import { bucketLabel, brushToRange, bucketInSelection } from './histogram';

const bounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000];

describe('bucketLabel', () => {
  it('labels the first, a middle and the open last bucket', () => {
    expect(bucketLabel(bounds, 0)).toBe('up to 1ms');
    expect(bucketLabel(bounds, 8)).toBe('200ms to 500ms');
    expect(bucketLabel(bounds, bounds.length)).toBe('over 1m');
  });
});

describe('brushToRange', () => {
  it('maps a bucket span to ms bounds', () => {
    expect(brushToRange(bounds, 7, 8)).toEqual({ minMs: 100, maxMs: 500 });
    expect(brushToRange(bounds, 0, 0)).toEqual({ minMs: 0, maxMs: 1 });
  });

  it('swaps reversed indexes and returns maxMs null for the open last bucket', () => {
    expect(brushToRange(bounds, bounds.length, 14)).toEqual({ minMs: 20000, maxMs: null });
  });

  it('clamps out of range indexes', () => {
    expect(brushToRange(bounds, -3, 99)).toEqual({ minMs: 0, maxMs: null });
  });
});

describe('bucketInSelection', () => {
  it('is false without a selection and true for buckets inside it', () => {
    expect(bucketInSelection(bounds, 5, { minMs: null, maxMs: null })).toBe(false);
    const sel = { minMs: 100, maxMs: 500 };
    expect(bucketInSelection(bounds, 7, sel)).toBe(true);
    expect(bucketInSelection(bounds, 8, sel)).toBe(true);
    expect(bucketInSelection(bounds, 6, sel)).toBe(false);
    expect(bucketInSelection(bounds, 9, sel)).toBe(false);
    expect(bucketInSelection(bounds, bounds.length, { minMs: 20000, maxMs: null })).toBe(true);
  });
});
