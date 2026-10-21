import { describe, it, expect } from 'vitest';
import { zoneLabel, formatRangeLabel, presetLabel, rangeLabel } from './labels.js';

const now = new Date('2026-10-21T12:00:00Z');

describe('zoneLabel', () => {
  it('formats offsets', () => {
    expect(zoneLabel('UTC', now)).toBe('UTC');
    expect(zoneLabel('Europe/Rome', now)).toBe('UTC+2');
    expect(zoneLabel('Europe/Rome', new Date('2026-12-01T12:00:00Z'))).toBe('UTC+1');
    expect(zoneLabel('Asia/Kolkata', now)).toBe('UTC+5:30');
    expect(zoneLabel('America/New_York', now)).toBe('UTC-4');
  });
});

describe('formatRangeLabel', () => {
  const d = (s: string) => new Date(s);

  it('same day', () => {
    expect(
      formatRangeLabel(d('2026-10-21T10:00:00Z'), d('2026-10-21T11:00:00Z'), {
        zone: 'UTC',
        hour12: false,
      })
    ).toBe('Oct 21, 10:00 to 11:00');
  });

  it('12 hour clock', () => {
    expect(
      formatRangeLabel(d('2026-10-21T10:00:00Z'), d('2026-10-21T11:00:00Z'), {
        zone: 'UTC',
        hour12: true,
      })
    ).toBe('Oct 21, 10:00 AM to 11:00 AM');
  });

  it('across days', () => {
    expect(
      formatRangeLabel(d('2026-10-20T22:00:00Z'), d('2026-10-21T02:00:00Z'), {
        zone: 'UTC',
        hour12: false,
      })
    ).toBe('Oct 20, 22:00 to Oct 21, 02:00');
  });

  it('across years', () => {
    expect(
      formatRangeLabel(d('2026-12-31T22:00:00Z'), d('2027-01-01T02:00:00Z'), {
        zone: 'UTC',
        hour12: false,
      })
    ).toBe('Dec 31, 2026, 22:00 to Jan 1, 2027, 02:00');
  });

  it('zone changes the wall clock', () => {
    expect(
      formatRangeLabel(d('2026-10-21T10:00:00Z'), d('2026-10-21T11:00:00Z'), {
        zone: 'Europe/Rome',
        hour12: false,
      })
    ).toBe('Oct 21, 12:00 to 13:00');
  });

  it('midnight renders as 00:00', () => {
    expect(
      formatRangeLabel(d('2026-10-20T23:00:00Z'), d('2026-10-21T00:00:00Z'), {
        zone: 'UTC',
        hour12: false,
      })
    ).toBe('Oct 20, 23:00 to Oct 21, 00:00');
  });
});

describe('presetLabel and rangeLabel', () => {
  it('preset uses the shared labels', () => {
    expect(presetLabel('1h')).toBe('Last hour');
    expect(rangeLabel({ kind: 'preset', preset: '1h' })).toBe('Last hour');
  });

  it('custom delegates to formatRangeLabel', () => {
    expect(
      rangeLabel(
        {
          kind: 'custom',
          from: '2026-10-21T10:00:00.000Z',
          to: '2026-10-21T11:00:00.000Z',
        },
        { zone: 'UTC', hour12: false }
      )
    ).toBe('Oct 21, 10:00 to 11:00');
  });
});
