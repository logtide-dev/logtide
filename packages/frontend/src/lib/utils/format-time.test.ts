import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimestamp, type TimestampStyle } from './format-time';
import { formatTimestamp as formatInstant, type TimestampOptions } from './datetime';
import { displayPreferences } from '$lib/stores/display-preferences';

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
  it('dateTime honors 12h clock', () => {
    expect(formatTimestamp(T, 'dateTime', { hour12: true, timeZone: 'UTC' })).toBe('Mar 5, 09:07 PM');
  });
  it('falls back to browser zone on invalid timeZone instead of throwing', () => {
    expect(() => formatTimestamp(T, 'time', { hour12: false, timeZone: 'Not/AZone' })).not.toThrow();
  });
});

describe('formatTimestamp agrees with datetime.ts', () => {
  const cases: Array<[TimestampStyle, TimestampOptions]> = [
    ['time', { precision: 'minute', withDate: false }],
    ['timeSeconds', { precision: 'second', withDate: false }],
    ['dateTime', { precision: 'minute', withDate: true }],
    ['monthDay', { dateOnly: true }],
  ];
  const prefsList = [
    { hour12: false, timeZone: 'UTC' },
    { hour12: true, timeZone: 'UTC' },
    { hour12: false, timeZone: 'America/Los_Angeles' },
    { hour12: true, timeZone: 'Asia/Kolkata' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    displayPreferences.set({ hour12: false, timeZone: null });
  });

  for (const prefs of prefsList) {
    for (const [style, opts] of cases) {
      it(`${style} ${prefs.hour12 ? '12h' : '24h'} ${prefs.timeZone}`, () => {
        displayPreferences.set(prefs);
        expect(formatTimestamp(T, style, prefs)).toBe(formatInstant(T, opts));
      });

      it(`${style} with explicit prefs ignores the live store (${prefs.timeZone})`, () => {
        displayPreferences.set({ hour12: !prefs.hour12, timeZone: null });
        expect(formatTimestamp(T, style, prefs)).toBe(formatInstant(T, { ...opts, prefs }));
      });
    }
  }
});
