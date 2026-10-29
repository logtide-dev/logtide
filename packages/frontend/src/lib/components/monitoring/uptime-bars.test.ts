import { describe, it, expect } from 'vitest';
import { buildDaySlots, formatBucketDay, weightedUptime } from './uptime-bars';

const TODAY = new Date('2026-10-22T15:30:00Z');

describe('buildDaySlots', () => {
  it('returns 90 slots ending today with null for missing days', () => {
    const slots = buildDaySlots(
      [
        { bucket: '2026-10-22T00:00:00.000Z', uptimePct: '99.5', totalChecks: 100 },
        { bucket: '2026-10-20T00:00:00.000Z', uptimePct: 100, totalChecks: 50 },
      ],
      90,
      TODAY
    );
    expect(slots).toHaveLength(90);
    expect(slots[89]).toEqual({ day: '2026-10-22', uptimePct: 99.5, totalChecks: 100 });
    expect(slots[88]).toEqual({ day: '2026-10-21', uptimePct: null });
    expect(slots[87].uptimePct).toBe(100);
    expect(slots[0].day).toBe('2026-07-25');
  });

  it('does not pad a short history with fake days (first real day keeps its date)', () => {
    const slots = buildDaySlots([{ bucket: '2026-10-21T00:00:00Z', uptimePct: 90, totalChecks: 10 }], 90, TODAY);
    const real = slots.filter((s) => s.uptimePct !== null);
    expect(real).toHaveLength(1);
    expect(real[0].day).toBe('2026-10-21');
    expect(slots.filter((s) => s.uptimePct === null)).toHaveLength(89);
  });

  it('treats a day with zero checks as no data', () => {
    const slots = buildDaySlots([{ bucket: '2026-10-22T00:00:00Z', uptimePct: 0, totalChecks: 0 }], 3, TODAY);
    expect(slots[2].uptimePct).toBeNull();
  });
});

describe('weightedUptime', () => {
  it('weights by totalChecks and returns null without data', () => {
    const slots = buildDaySlots(
      [
        { bucket: '2026-10-22T00:00:00Z', uptimePct: 100, totalChecks: 300 },
        { bucket: '2026-10-21T00:00:00Z', uptimePct: 50, totalChecks: 100 },
      ],
      3,
      TODAY
    );
    expect(weightedUptime(slots)).toBe(87.5);
    expect(weightedUptime(buildDaySlots([], 3, TODAY))).toBeNull();
  });
});

describe('formatBucketDay', () => {
  it('formats the UTC calendar day', () => {
    expect(formatBucketDay('2026-10-22')).toBe('Oct 22');
    expect(formatBucketDay('2026-01-01')).toBe('Jan 1');
  });
});
