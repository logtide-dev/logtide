import { describe, it, expect } from 'vitest';
import { formatCount, formatCompact, formatBytes, formatPercent } from './format-number';

describe('format-number', () => {
  it('returns a dash for null, undefined and NaN', () => {
    for (const fn of [formatCount, formatCompact, formatBytes, formatPercent]) {
      expect(fn(null)).toBe('-');
      expect(fn(undefined)).toBe('-');
      expect(fn(NaN)).toBe('-');
    }
  });

  it('formatCount groups with en-US separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(-1500)).toBe('-1,500');
  });

  it('formatCompact uses compact notation', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(1200)).toBe('1.2K');
    expect(formatCompact(3_400_000)).toBe('3.4M');
    expect(formatCompact(2_000_000_000)).toBe('2B');
  });

  it('formatBytes uses 1024 base with one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(2.5 * 1024 ** 4)).toBe('2.5 TB');
    expect(formatBytes(5000 * 1024 ** 4)).toBe('5000.0 TB');
  });

  it('formatPercent takes a percentage and honors digits', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatPercent(12.345, 0)).toBe('12%');
    expect(formatPercent(0, 2)).toBe('0.00%');
  });
});
