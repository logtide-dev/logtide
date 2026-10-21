import { describe, it, expect } from 'vitest';
import type { IncidentSource } from '@logtide/shared';
import { planStatusChange, higherSeverity } from '../../../modules/incidents/status.js';

const now = new Date('2026-10-21T10:00:00Z');

describe('planStatusChange', () => {
  it('is a no-op for the same status', () =>
    expect(planStatusChange({ status: 'open', source: 'alert' }, 'open', 'u1', now)).toEqual({ ok: true, set: {} }));

  it('acknowledging stamps who and when', () =>
    expect(planStatusChange({ status: 'open', source: 'alert' }, 'investigating', 'u1', now)).toEqual({
      ok: true,
      set: { status: 'investigating', acknowledged_at: now, acknowledged_by: 'u1' },
    }));

  it('resolving stamps who and when', () =>
    expect(planStatusChange({ status: 'investigating', source: 'monitor' }, 'resolved', 'u1', now)).toEqual({
      ok: true,
      set: { status: 'resolved', resolved_at: now, resolved_by: 'u1' },
    }));

  it('resolving without an actor stamps a null resolver', () =>
    expect(planStatusChange({ status: 'open', source: 'manual' }, 'resolved', null, now)).toEqual({
      ok: true,
      set: { status: 'resolved', resolved_at: now, resolved_by: null },
    }));

  it('reopening only sets the status (the trigger clears the rest)', () => {
    expect(planStatusChange({ status: 'resolved', source: 'alert' }, 'open', 'u1', now)).toEqual({
      ok: true,
      set: { status: 'open' },
    });
    expect(planStatusChange({ status: 'investigating', source: 'sigma' }, 'open', 'u1', now)).toEqual({
      ok: true,
      set: { status: 'open' },
    });
  });

  it('false positive is allowed for sigma and stamps resolved_by', () =>
    expect(planStatusChange({ status: 'open', source: 'sigma' }, 'false_positive', 'u1', now)).toEqual({
      ok: true,
      set: { status: 'false_positive', resolved_by: 'u1' },
    }));

  it.each(['alert', 'monitor', 'manual'] as IncidentSource[])('false positive is refused for %s', (source) =>
    expect(planStatusChange({ status: 'open', source }, 'false_positive', 'u1', now)).toEqual({
      ok: false,
      code: 'false_positive_not_allowed',
    }));
});

describe('higherSeverity', () => {
  it('never downgrades', () => {
    expect(higherSeverity('high', 'low')).toBe('high');
    expect(higherSeverity('medium', 'critical')).toBe('critical');
    expect(higherSeverity('informational', 'low')).toBe('low');
    expect(higherSeverity('high', 'high')).toBe('high');
  });
});
