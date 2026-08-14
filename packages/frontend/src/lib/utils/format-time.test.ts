import { describe, it, expect } from 'vitest';
import { formatTimestamp } from './format-time';

const T = '2026-03-05T21:07:09.000Z';

describe('formatTimestamp', () => {
  it('24h UTC', () => {
    expect(formatTimestamp(T, 'timeSeconds', { hour12: false, timeZone: 'UTC' })).toBe('21:07:09');
  });
  it('12h UTC', () => {
    expect(formatTimestamp(T, 'timeSeconds', { hour12: true, timeZone: 'UTC' })).toBe('09:07:09 PM');
  });
  it('explicit timezone shifts the clock', () => {
    expect(formatTimestamp(T, 'time', { hour12: false, timeZone: 'America/Los_Angeles' })).toBe('13:07');
  });
  it('monthDay ignores hour12', () => {
    expect(formatTimestamp(T, 'monthDay', { hour12: true, timeZone: 'UTC' })).toBe('Mar 5');
  });
  it('dateTime combines date and clock', () => {
    expect(formatTimestamp(T, 'dateTime', { hour12: false, timeZone: 'UTC' })).toBe('Mar 5, 21:07');
  });
  it('falls back to browser zone on invalid timeZone instead of throwing', () => {
    expect(() => formatTimestamp(T, 'time', { hour12: false, timeZone: 'Not/AZone' })).not.toThrow();
  });
});
