import { describe, it, expect } from 'vitest';
import { formatDuration } from './format';

describe('formatDuration', () => {
  it('rounds and picks units', () => {
    expect(formatDuration(0)).toBe('<1ms');
    expect(formatDuration(0.4)).toBe('<1ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(123.4)).toBe('123ms');
    expect(formatDuration(999.6)).toBe('1s');
    expect(formatDuration(1230)).toBe('1.23s');
    expect(formatDuration(59999)).toBe('1m');
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(90000)).toBe('1.5m');
  });

  it('never prints raw floats or NaN', () => {
    expect(formatDuration(NaN)).toBe('<1ms');
    expect(formatDuration(Infinity)).toBe('<1ms');
    expect(formatDuration(-5)).toBe('<1ms');
    expect(formatDuration(1234.56789)).toBe('1.23s');
  });
});
