import { describe, it, expect } from 'vitest';
import { computeOpenChecks, type ProjectHealthInputs } from '../../../modules/project-health/checks.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function inputs(overrides: Partial<ProjectHealthInputs> = {}): ProjectHealthInputs {
  return {
    lastEventAt: minutesAgo(1),
    silentMinutes: 60,
    piiRejected60m: 0,
    revokedKey60m: 0,
    skew24h: {
      logs: 0,
      spans: 0,
      metrics: 0,
      maxPastMs: { logs: null, spans: null, metrics: null },
    },
    now: NOW,
    ...overrides,
  };
}

describe('computeOpenChecks', () => {
  it('returns nothing for a healthy project', () => {
    expect(computeOpenChecks(inputs()).size).toBe(0);
  });

  describe('silent', () => {
    it('opens when the last event is older than silentMinutes', () => {
      const open = computeOpenChecks(inputs({ lastEventAt: minutesAgo(61) }));
      expect(open.has('silent')).toBe(true);
      expect(open.get('silent')).toEqual({
        lastEventAt: minutesAgo(61).toISOString(),
        silentMinutes: 60,
      });
    });

    it('stays closed exactly at the threshold', () => {
      expect(computeOpenChecks(inputs({ lastEventAt: minutesAgo(60) })).has('silent')).toBe(false);
    });

    it('does not flap on the 5 minute has_*_at debounce (last event 6 min ago, threshold 10)', () => {
      const open = computeOpenChecks(inputs({ lastEventAt: minutesAgo(6), silentMinutes: 10 }));
      expect(open.has('silent')).toBe(false);
    });

    it('never opens for a project that never received an event', () => {
      expect(computeOpenChecks(inputs({ lastEventAt: null })).has('silent')).toBe(false);
    });

    it('has no 24h precondition: a long dead project stays silent', () => {
      expect(computeOpenChecks(inputs({ lastEventAt: minutesAgo(60 * 24 * 30) })).has('silent')).toBe(true);
    });
  });

  it('pii_rejected opens on any rejection in 60 min', () => {
    expect(computeOpenChecks(inputs({ piiRejected60m: 0 })).has('pii_rejected')).toBe(false);
    const open = computeOpenChecks(inputs({ piiRejected60m: 3 }));
    expect(open.get('pii_rejected')).toEqual({ count60m: 3 });
  });

  it('revoked_key opens on any attempt in 60 min', () => {
    expect(computeOpenChecks(inputs({ revokedKey60m: 0 })).has('revoked_key')).toBe(false);
    expect(computeOpenChecks(inputs({ revokedKey60m: 1 })).get('revoked_key')).toEqual({ count60m: 1 });
  });

  it.each([
    ['logs', 'timestamp_skew_logs'],
    ['spans', 'timestamp_skew_spans'],
    ['metrics', 'timestamp_skew_metrics'],
  ] as const)('skew on %s opens %s', (signal, key) => {
    const off = inputs();
    expect(computeOpenChecks(off).has(key)).toBe(false);

    const on = inputs({
      skew24h: {
        logs: 0,
        spans: 0,
        metrics: 0,
        maxPastMs: { logs: null, spans: null, metrics: null },
        [signal]: 900,
      },
    });
    on.skew24h.maxPastMs[signal] = 3 * 3_600_000;
    const open = computeOpenChecks(on);
    expect(open.get(key)).toEqual({ count24h: 900, maxPastHours: 3 });
    expect(open.size).toBe(1);
  });

  it('skew details keep maxPastHours null when unknown and include future skew when given', () => {
    const open = computeOpenChecks(
      inputs({
        skew24h: {
          logs: 2,
          spans: 0,
          metrics: 0,
          maxPastMs: { logs: null, spans: null, metrics: null },
          maxFutureMs: { logs: 7_200_000, spans: null, metrics: null },
        },
      })
    );
    expect(open.get('timestamp_skew_logs')).toEqual({ count24h: 2, maxPastHours: null, maxFutureHours: 2 });
  });
});
