import { describe, it, expect } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('formats the ranges', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(12_000)).toBe('12 s');
    expect(formatDuration(200_000)).toBe('3 min 20 s');
    expect(formatDuration(180_000)).toBe('3 min');
    expect(formatDuration(7_500_000)).toBe('2 h 5 min');
    expect(formatDuration(7_200_000)).toBe('2 h');
  });

  it('shows a dash for invalid input', () => {
    expect(formatDuration(-1)).toBe('-');
    expect(formatDuration(NaN)).toBe('-');
  });
});
