import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { displayPreferences } from '$lib/stores/display-preferences';
import {
  formatTimestamp,
  formatRelative,
  formatRange,
  getDisplayZoneLabel,
  formatDateTime,
  formatDateTimeLong,
  formatTimeAgo,
  formatDateShort,
} from './datetime';

const INSTANT = '2026-03-05T21:07:09.047Z';

function prefs(timeZone: string | null, hour12 = false) {
  displayPreferences.set({ hour12, timeZone });
}

describe('datetime', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    prefs('UTC');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    prefs(null);
  });

  describe('formatTimestamp', () => {
    it('formats 24 hour UTC with seconds', () => {
      expect(formatTimestamp(INSTANT)).toBe('Mar 5, 21:07:09');
    });

    it('uses explicit prefs instead of the live store', () => {
      prefs('UTC', false);
      expect(formatTimestamp(INSTANT, { prefs: { hour12: true, timeZone: 'Asia/Kolkata' } })).toBe(
        'Mar 6, 02:37:09 AM'
      );
      expect(formatTimestamp(INSTANT)).toBe('Mar 5, 21:07:09');
      expect(
        formatTimestamp(INSTANT, { withZone: true, prefs: { hour12: false, timeZone: 'Asia/Kolkata' } })
      ).toBe('Mar 6, 02:37:09 UTC+5:30');
    });

    it('dateOnly gives month and day with no clock and no year', () => {
      expect(formatTimestamp(INSTANT, { dateOnly: true })).toBe('Mar 5');
      expect(formatTimestamp('2024-03-05T21:07:09Z', { dateOnly: true })).toBe('Mar 5');
      expect(
        formatTimestamp(INSTANT, { dateOnly: true, prefs: { hour12: false, timeZone: 'Asia/Kolkata' } })
      ).toBe('Mar 6');
    });

    it('supports minute and ms precision', () => {
      expect(formatTimestamp(INSTANT, { precision: 'minute' })).toBe('Mar 5, 21:07');
      expect(formatTimestamp(INSTANT, { precision: 'ms' })).toBe('Mar 5, 21:07:09.047');
    });

    it('can drop the date', () => {
      expect(formatTimestamp(INSTANT, { withDate: false })).toBe('21:07:09');
    });

    it('uses 12 hour clock with AM/PM', () => {
      prefs('UTC', true);
      expect(formatTimestamp(INSTANT)).toBe('Mar 5, 09:07:09 PM');
    });

    it('converts to the preferred zone', () => {
      prefs('America/Los_Angeles');
      expect(formatTimestamp(INSTANT)).toBe('Mar 5, 13:07:09');
    });

    it('renders midnight as 00:00, never 24:00', () => {
      expect(formatTimestamp('2026-03-05T00:00:30Z', { precision: 'minute', withDate: false })).toBe('00:00');
    });

    it('appends the zone label when asked', () => {
      expect(formatTimestamp(INSTANT, { withZone: true })).toMatch(/ UTC$/);
      prefs('Europe/Rome');
      expect(formatTimestamp(INSTANT, { withZone: true })).toMatch(/ UTC\+1$/);
      prefs('Asia/Kolkata');
      expect(formatTimestamp(INSTANT, { withZone: true })).toMatch(/ UTC\+5:30$/);
      prefs('America/New_York');
      expect(formatTimestamp(INSTANT, { withZone: true })).toMatch(/ UTC-5$/);
    });

    it('shows the year only when it differs from the current one', () => {
      expect(formatTimestamp('2025-03-05T21:07:09Z')).toBe('Mar 5, 2025, 21:07:09');
      expect(formatTimestamp('2026-03-05T21:07:09Z')).toBe('Mar 5, 21:07:09');
    });

    it('uses the current year in the display zone', () => {
      vi.setSystemTime(new Date('2025-12-31T23:30:00Z'));
      prefs('Pacific/Auckland'); // already 2026 there
      expect(formatTimestamp('2026-01-01T09:00:00Z')).toBe('Jan 1, 22:00:00');
    });

    it('never emits narrow no-break spaces', () => {
      prefs('UTC', true);
      expect(formatTimestamp(INSTANT)).not.toMatch(/[  ]/);
      expect(formatTimestamp(INSTANT, { withZone: true })).not.toMatch(/[  ]/);
    });
  });

  describe('getDisplayZoneLabel', () => {
    it('labels offsets', () => {
      expect(getDisplayZoneLabel(new Date(INSTANT))).toBe('UTC');
      prefs('Europe/London');
      expect(getDisplayZoneLabel(new Date(INSTANT))).toBe('UTC');
      prefs('Europe/Rome');
      expect(getDisplayZoneLabel(new Date(INSTANT))).toBe('UTC+1');
      expect(getDisplayZoneLabel(new Date('2026-07-05T12:00:00Z'))).toBe('UTC+2');
    });

    it('accepts the browser sentinel', () => {
      prefs('browser');
      expect(getDisplayZoneLabel()).toMatch(/^UTC([+-]\d{1,2}(:\d{2})?)?$/);
    });
  });

  describe('formatRange', () => {
    it('collapses a same-day range', () => {
      expect(formatRange('2026-10-21T10:00:00Z', '2026-10-21T11:00:00Z')).toBe('Oct 21, 10:00 to 11:00');
    });

    it('spells out both dates across days', () => {
      expect(formatRange('2026-10-21T10:00:00Z', '2026-10-22T09:00:00Z')).toBe('Oct 21, 10:00 to Oct 22, 09:00');
    });

    it('decides same day in the display zone, not UTC', () => {
      prefs('Europe/Rome');
      // 23:30Z and 00:30Z straddle midnight UTC, but are 00:30 and 01:30 on the same Rome day
      expect(formatRange('2026-10-21T23:30:00Z', '2026-10-22T00:30:00Z')).toBe('Oct 22, 01:30 to 02:30');
    });

    it('honours the 12 hour clock', () => {
      prefs('UTC', true);
      expect(formatRange('2026-10-21T10:00:00Z', '2026-10-21T13:00:00Z')).toBe('Oct 21, 10:00 AM to 01:00 PM');
    });

    it('returns Invalid date for bad input', () => {
      expect(formatRange('garbage', '2026-10-21T10:00:00Z')).toBe('Invalid date');
    });
  });

  describe('formatRelative', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms);

    it('has the documented boundaries', () => {
      expect(formatRelative(ago(59_000), now)).toBe('just now');
      expect(formatRelative(ago(60_000), now)).toBe('1 minute ago');
      expect(formatRelative(ago(61 * 60_000), now)).toBe('1 hour ago');
      expect(formatRelative(ago(3 * 86_400_000), now)).toBe('3 days ago');
    });

    it('handles the future', () => {
      expect(formatRelative(new Date(now.getTime() + 5 * 60_000 + 1000), now)).toBe('in 5 minutes');
    });

    it('falls back to an absolute date after 30 days', () => {
      expect(formatRelative(ago(30 * 86_400_000), now)).toBe('30 days ago');
      expect(formatRelative(ago(31 * 86_400_000), now)).toBe('May 15, 12:00');
    });
  });

  describe('legacy exports', () => {
    it('formatDateTime honours the zone and stays 24 hour', () => {
      prefs('UTC', true);
      expect(formatDateTime(new Date('2026-03-05T21:07:09Z'))).toBe('2026-03-05 21:07:09');
      prefs('America/Los_Angeles');
      expect(formatDateTime('2026-03-05T21:07:09Z')).toBe('2026-03-05 13:07:09');
    });

    it('formatDateTimeLong includes the short zone name', () => {
      const out = formatDateTimeLong(new Date('2026-03-05T21:07:09Z'));
      expect(out).toContain('Mar 5, 2026');
      expect(out).toContain('UTC');
    });

    it('formatDateShort uses the zone', () => {
      prefs('Pacific/Auckland');
      expect(formatDateShort('2026-03-05T21:07:09Z')).toBe('Mar 6, 2026');
    });

    it('formatTimeAgo keeps its wording and has no cutoff', () => {
      const now = new Date('2026-06-15T12:00:00Z');
      expect(formatTimeAgo(new Date(now.getTime() - 5 * 60_000), now)).toBe('5 minutes ago');
      expect(formatTimeAgo(new Date(now.getTime() - 45 * 86_400_000), now)).toBe('45 days ago');
      expect(formatTimeAgo('garbage', now)).toBe('Invalid date');
    });
  });

  describe('Review Focus 1: invalid stored zone', () => {
    it('falls back to the browser zone without throwing or spamming', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      prefs(null);
      const expected = {
        ts: formatTimestamp(INSTANT),
        long: formatDateTimeLong(INSTANT),
        dt: formatDateTime(INSTANT),
        short: formatDateShort(INSTANT),
        label: getDisplayZoneLabel(new Date(INSTANT)),
        range: formatRange(INSTANT, '2026-03-05T22:07:09Z'),
      };
      prefs('Not/AZone');
      for (let i = 0; i < 100; i++) {
        expect(formatTimestamp(INSTANT)).toBe(expected.ts);
        expect(formatDateTimeLong(INSTANT)).toBe(expected.long);
        expect(formatDateTime(INSTANT)).toBe(expected.dt);
        expect(formatDateShort(INSTANT)).toBe(expected.short);
        expect(getDisplayZoneLabel(new Date(INSTANT))).toBe(expected.label);
        expect(formatRange(INSTANT, '2026-03-05T22:07:09Z')).toBe(expected.range);
        expect(formatRelative(INSTANT)).toBeTruthy();
      }
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Review Focus 2: invalid values', () => {
    it.each(['garbage', NaN, null, undefined, ''])('%s', (bad) => {
      expect(formatTimestamp(bad as any)).toBe('Invalid date');
      expect(formatRelative(bad as any)).toBe('Invalid date');
      expect(formatDateTime(bad as any)).toBe('Invalid date');
      expect(formatDateTimeLong(bad as any)).toBe('Invalid date');
      expect(formatDateShort(bad as any)).toBe('Invalid date');
      expect(formatTimeAgo(bad as any)).toBe('Invalid date');
    });
  });
});
