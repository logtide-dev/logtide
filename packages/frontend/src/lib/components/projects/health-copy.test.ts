import { describe, it, expect } from 'vitest';
import { issueCopy, isMuted } from './health-copy';

describe('issueCopy', () => {
  it('explains log skew with the counts and direction', () => {
    const c = issueCopy({ checkKey: 'timestamp_skew_logs', details: { count24h: 1200, maxPastHours: 3 } });
    expect(c.explanation).toContain('1,200 logs');
    expect(c.explanation).toContain('up to 3 hours in the past');
    expect(c.explanation).toContain('cannot trigger an alert');
  });

  it('prefers the future direction when it is larger', () => {
    const c = issueCopy({ checkKey: 'timestamp_skew_spans', details: { count24h: 1, maxPastHours: 1, maxFutureHours: 5 } });
    expect(c.explanation).toContain('1 span ended');
    expect(c.explanation).toContain('5 hours ahead of the server clock');
  });

  it('covers silent, pii and revoked key', () => {
    expect(issueCopy({ checkKey: 'silent', details: { silentMinutes: 60 } }).explanation).toContain('60 minutes');
    expect(issueCopy({ checkKey: 'pii_rejected', details: { count60m: 4 } }).explanation).toContain('4 records were rejected');
    expect(issueCopy({ checkKey: 'revoked_key', details: { count60m: 1 } }).explanation).toContain('1 request used a revoked');
  });
});

describe('isMuted', () => {
  it('handles null, until-resolved, future and past mutes', () => {
    const now = new Date('2026-10-28T10:00:00Z');
    expect(isMuted({ mute: null }, now)).toBe(false);
    expect(isMuted({ mute: { until: null, untilResolved: true } }, now)).toBe(true);
    expect(isMuted({ mute: { until: '2026-10-29T10:00:00Z', untilResolved: false } }, now)).toBe(true);
    expect(isMuted({ mute: { until: '2026-10-27T10:00:00Z', untilResolved: false } }, now)).toBe(false);
  });
});
