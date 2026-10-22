import { describe, it, expect } from 'vitest';
import { nextQuotaReset, formatResetDate, isMonthlyQuota } from './quota';

describe('quota helpers', () => {
  it('nextQuotaReset from Dec 31 2026 returns Jan 1 2027 UTC', () => {
    const d = nextQuotaReset(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)));
    expect(d.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('nextQuotaReset mid month returns the first of next month', () => {
    expect(nextQuotaReset(new Date(Date.UTC(2026, 9, 21, 12))).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z'
    );
  });
  it('formatResetDate is Nov 1 style and UTC', () => {
    expect(formatResetDate(new Date(Date.UTC(2026, 10, 1)))).toBe('Nov 1');
    expect(formatResetDate(new Date(Date.UTC(2027, 0, 1)))).toBe('Jan 1');
  });
  it('isMonthlyQuota excludes limits and point-in-time storage', () => {
    expect(isMonthlyQuota({ kind: 'quota', capability: 'ingestion.max_events_monthly' })).toBe(true);
    expect(isMonthlyQuota({ kind: 'quota', capability: 'storage.max_bytes' })).toBe(false);
    expect(isMonthlyQuota({ kind: 'limit', capability: 'projects.max' })).toBe(false);
  });
});
