import { describe, it, expect } from 'vitest';
import { describeIgnore, statusTone, regressedTone } from './error-status';
import { stateTone, severityTone } from '$lib/utils/severity';
import { formatTimestamp } from '$lib/utils/datetime';

describe('error status helpers', () => {
  it('describeIgnore covers forever, date and count', () => {
    expect(describeIgnore({ status: 'ignored', ignoredUntil: null, ignoreUntilCount: null, ignoredEventCount: 0 })).toBe(
      'Ignored forever'
    );

    const until = '2026-12-01T10:00:00.000Z';
    expect(describeIgnore({ status: 'ignored', ignoredUntil: until, ignoreUntilCount: null, ignoredEventCount: 0 })).toBe(
      `Ignored until ${formatTimestamp(until)}`
    );

    expect(describeIgnore({ status: 'ignored', ignoredUntil: null, ignoreUntilCount: 50, ignoredEventCount: 12 })).toBe(
      'Ignored until 50 more events (12 so far)'
    );
    expect(describeIgnore({ status: 'ignored', ignoredUntil: null, ignoreUntilCount: 1, ignoredEventCount: 0 })).toBe(
      'Ignored until 1 more event (0 so far)'
    );
    expect(
      describeIgnore({ status: 'ignored', ignoredUntil: null, ignoreUntilCount: 1500, ignoredEventCount: 1234 })
    ).toBe('Ignored until 1,500 more events (1,234 so far)');
  });

  it('describeIgnore is null when not ignored', () => {
    expect(describeIgnore({ status: 'open', ignoredUntil: null, ignoreUntilCount: null, ignoredEventCount: 0 })).toBeNull();
    expect(describeIgnore({ status: 'resolved' })).toBeNull();
  });

  it('statusTone maps ignored to the snoozed state tone', () => {
    expect(statusTone('ignored')).toEqual(stateTone('snoozed'));
    expect(statusTone('resolved')).toEqual(stateTone('resolved'));
    expect(statusTone('open')).toEqual(stateTone('open'));
  });

  it('regressedTone is the medium severity tone', () => {
    expect(regressedTone()).toEqual(severityTone('medium'));
  });
});
