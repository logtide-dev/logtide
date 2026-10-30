import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { displayPreferences } from '$lib/stores/display-preferences';
import { formatRange, getDisplayZoneLabel } from '$lib/utils/datetime';
import { zoneLabel, formatRangeLabel, presetLabel, rangeLabel } from './labels.js';

const now = new Date('2026-10-21T12:00:00Z');

function setPrefs(timeZone: string | null, hour12 = false) {
  displayPreferences.set({ hour12, timeZone });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  setPrefs('UTC');
});

afterEach(() => {
  vi.useRealTimers();
  displayPreferences.set({ hour12: false, timeZone: null });
});

describe('zoneLabel', () => {
  it('agrees with getDisplayZoneLabel for several zones', () => {
    for (const tz of ['UTC', 'Europe/Rome', 'Asia/Kolkata', 'America/New_York']) {
      setPrefs(tz);
      expect(zoneLabel(now)).toBe(getDisplayZoneLabel(now));
    }
  });

  it('formats offsets', () => {
    setPrefs('Europe/Rome');
    expect(zoneLabel(now)).toBe('UTC+2');
    expect(zoneLabel(new Date('2026-12-01T12:00:00Z'))).toBe('UTC+1');
    setPrefs('Asia/Kolkata');
    expect(zoneLabel(now)).toBe('UTC+5:30');
  });
});

describe('formatRangeLabel', () => {
  const d = (s: string) => new Date(s);

  it('agrees with formatRange', () => {
    const a = d('2026-10-20T22:00:00Z');
    const b = d('2026-10-21T02:00:00Z');
    expect(formatRangeLabel(a, b)).toBe(formatRange(a, b));
  });

  it('same day', () => {
    expect(formatRangeLabel(d('2026-10-21T10:00:00Z'), d('2026-10-21T11:00:00Z'))).toBe(
      'Oct 21, 10:00 to 11:00'
    );
  });

  it('12 hour clock', () => {
    setPrefs('UTC', true);
    expect(formatRangeLabel(d('2026-10-21T10:00:00Z'), d('2026-10-21T11:00:00Z'))).toBe(
      'Oct 21, 10:00 AM to 11:00 AM'
    );
  });

  it('zone changes the wall clock', () => {
    setPrefs('Europe/Rome');
    expect(formatRangeLabel(d('2026-10-21T10:00:00Z'), d('2026-10-21T11:00:00Z'))).toBe(
      'Oct 21, 12:00 to 13:00'
    );
  });
});

describe('presetLabel and rangeLabel', () => {
  it('preset uses the shared labels', () => {
    expect(presetLabel('1h')).toBe('Last hour');
    expect(rangeLabel({ kind: 'preset', preset: '1h' })).toBe('Last hour');
  });

  it('custom delegates to formatRange', () => {
    const from = '2026-10-21T10:00:00.000Z';
    const to = '2026-10-21T11:00:00.000Z';
    expect(rangeLabel({ kind: 'custom', from, to })).toBe(formatRange(from, to));
  });
});
