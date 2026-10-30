import { describe, it, expect } from 'vitest';
import {
  decideRateOfChange,
  decideThreshold,
  episodeNotified,
  isSnoozed,
  renotifyDue,
  type LifecycleDecision,
  type LifecycleSnapshot,
  type RateOfChangeSignal,
} from '../../../modules/alerts/lifecycle.js';

const NOW = new Date('2026-10-21T10:00:00.000Z');
const MINUTE = 60_000;
const minus = (d: Date, minutes: number) => new Date(d.getTime() - minutes * MINUTE);
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MINUTE);

const okSnap: LifecycleSnapshot = {
  state: 'ok',
  lastTriggeredAt: null,
  lastNotifiedAt: null,
  snoozedUntil: null,
  renotifyMinutes: null,
};

const firingNotified: LifecycleSnapshot = {
  state: 'firing',
  lastTriggeredAt: minus(NOW, 40),
  lastNotifiedAt: minus(NOW, 40),
  snoozedUntil: null,
  renotifyMinutes: 30,
};

describe('decideThreshold', () => {
  it.each<[string, LifecycleSnapshot, boolean, LifecycleDecision]>([
    ['T1', okSnap, false, { type: 'none' }],
    ['T1 snoozed', { ...okSnap, snoozedUntil: plus(NOW, 60) }, false, { type: 'none' }],
    ['T1 after an old episode', { ...okSnap, lastTriggeredAt: minus(NOW, 600), lastNotifiedAt: minus(NOW, 600) }, false, { type: 'none' }],
    ['T2', okSnap, true, { type: 'fire', notification: 'triggered' }],
    ['T2 after an old episode', { ...okSnap, lastTriggeredAt: minus(NOW, 600), lastNotifiedAt: minus(NOW, 600) }, true, { type: 'fire', notification: 'triggered' }],
    ['T3', { ...okSnap, snoozedUntil: plus(NOW, 60) }, true, { type: 'fire', notification: null }],
    ['T4', firingNotified, true, { type: 'notify', notification: 'renotify' }],
    ['T5', { ...firingNotified, renotifyMinutes: null }, true, { type: 'none' }],
    ['T5 not due yet', { ...firingNotified, lastNotifiedAt: minus(NOW, 10) }, true, { type: 'none' }],
    ['T6', { ...firingNotified, lastNotifiedAt: minus(NOW, 90) }, true, { type: 'notify', notification: 'triggered' }],
    ['T6 never notified', { ...firingNotified, lastNotifiedAt: null }, true, { type: 'notify', notification: 'triggered' }],
    ['T7', { ...firingNotified, snoozedUntil: plus(NOW, 5) }, true, { type: 'none' }],
    ['T7 never notified', { ...firingNotified, lastNotifiedAt: null, snoozedUntil: plus(NOW, 5) }, true, { type: 'none' }],
    ['T8', firingNotified, false, { type: 'resolve', notification: 'resolved' }],
    ['T9', { ...firingNotified, lastNotifiedAt: null }, false, { type: 'resolve', notification: null }],
    ['T9 notified for an older episode', { ...firingNotified, lastNotifiedAt: minus(NOW, 90) }, false, { type: 'resolve', notification: null }],
    ['T10', { ...firingNotified, snoozedUntil: plus(NOW, 5) }, false, { type: 'resolve', notification: 'resolved' }],
    ['T10b', { ...firingNotified, lastNotifiedAt: null, snoozedUntil: plus(NOW, 5) }, false, { type: 'resolve', notification: null }],
  ])('threshold %s', (_row, snap, breaching, expected) => {
    expect(decideThreshold(snap, breaching, NOW)).toEqual(expected);
  });

  it('renotify is due exactly at renotify_minutes', () => {
    const snap = { ...firingNotified, lastTriggeredAt: minus(NOW, 30), lastNotifiedAt: minus(NOW, 30), renotifyMinutes: 30 };
    expect(decideThreshold(snap, true, NOW)).toEqual({ type: 'notify', notification: 'renotify' });
    const oneMsEarly = new Date(NOW.getTime() - 1);
    expect(decideThreshold(snap, true, oneMsEarly)).toEqual({ type: 'none' });
  });

  it('an expired snooze counts as not snoozed', () => {
    const expired = new Date(NOW.getTime() - 1);
    expect(decideThreshold({ ...okSnap, snoozedUntil: expired }, true, NOW)).toEqual({ type: 'fire', notification: 'triggered' });
    // fired while snoozed, snooze now over -> one triggered notification (T6)
    const firedWhileSnoozed = { ...firingNotified, lastTriggeredAt: minus(NOW, 10), lastNotifiedAt: minus(NOW, 600), snoozedUntil: expired };
    expect(decideThreshold(firedWhileSnoozed, true, NOW)).toEqual({ type: 'notify', notification: 'triggered' });
  });

  it('a snooze ending exactly now is over', () => {
    expect(decideThreshold({ ...okSnap, snoozedUntil: NOW }, true, NOW)).toEqual({ type: 'fire', notification: 'triggered' });
  });
});

describe('decideRateOfChange', () => {
  it.each<[string, LifecycleSnapshot, RateOfChangeSignal, LifecycleDecision]>([
    ['R1 skipped', okSnap, 'skipped', { type: 'none' }],
    ['R1 pending', okSnap, 'pending', { type: 'none' }],
    ['R1 recovered', okSnap, 'recovered', { type: 'none' }],
    ['R1 snoozed', { ...okSnap, snoozedUntil: plus(NOW, 60) }, 'pending', { type: 'none' }],
    ['R2', okSnap, 'anomaly', { type: 'fire', notification: 'triggered' }],
    ['R3', { ...okSnap, snoozedUntil: plus(NOW, 60) }, 'anomaly', { type: 'fire', notification: null }],
    ['R4 skipped', firingNotified, 'skipped', { type: 'none' }],
    ['R4 pending', firingNotified, 'pending', { type: 'none' }],
    ['R4 snoozed', { ...firingNotified, snoozedUntil: plus(NOW, 60) }, 'pending', { type: 'none' }],
    ['R5 notified', firingNotified, 'anomaly', { type: 'notify', notification: 'renotify' }],
    ['R5 not notified', { ...firingNotified, lastNotifiedAt: null }, 'anomaly', { type: 'notify', notification: 'triggered' }],
    ['R5 ignores renotify_minutes', { ...firingNotified, renotifyMinutes: null, lastNotifiedAt: minus(NOW, 1) }, 'anomaly', { type: 'notify', notification: 'renotify' }],
    ['R6', { ...firingNotified, snoozedUntil: plus(NOW, 5) }, 'anomaly', { type: 'none' }],
    ['R7', firingNotified, 'recovered', { type: 'resolve', notification: 'resolved' }],
    ['R7 snoozed', { ...firingNotified, snoozedUntil: plus(NOW, 5) }, 'recovered', { type: 'resolve', notification: 'resolved' }],
    ['R8', { ...firingNotified, lastNotifiedAt: null }, 'recovered', { type: 'resolve', notification: null }],
    ['R8 snoozed', { ...firingNotified, lastNotifiedAt: null, snoozedUntil: plus(NOW, 5) }, 'recovered', { type: 'resolve', notification: null }],
  ])('rate of change %s', (_row, snap, signal, expected) => {
    expect(decideRateOfChange(snap, signal, NOW)).toEqual(expected);
  });
});

describe('lifecycle predicates', () => {
  it('isSnoozed compares strictly against now', () => {
    expect(isSnoozed(okSnap, NOW)).toBe(false);
    expect(isSnoozed({ ...okSnap, snoozedUntil: plus(NOW, 1) }, NOW)).toBe(true);
    expect(isSnoozed({ ...okSnap, snoozedUntil: NOW }, NOW)).toBe(false);
    expect(isSnoozed({ ...okSnap, snoozedUntil: new Date(NOW.getTime() - 1) }, NOW)).toBe(false);
  });

  it('episodeNotified needs a notification at or after the episode start', () => {
    expect(episodeNotified(firingNotified)).toBe(true);
    expect(episodeNotified({ ...firingNotified, lastNotifiedAt: null })).toBe(false);
    expect(episodeNotified({ ...firingNotified, lastNotifiedAt: new Date(firingNotified.lastTriggeredAt!.getTime() - 1) })).toBe(false);
    expect(episodeNotified({ ...firingNotified, lastNotifiedAt: plus(firingNotified.lastTriggeredAt!, 30) })).toBe(true);
  });

  it('renotifyDue needs an interval and a previous notification', () => {
    expect(renotifyDue(firingNotified, NOW)).toBe(true);
    expect(renotifyDue({ ...firingNotified, renotifyMinutes: null }, NOW)).toBe(false);
    expect(renotifyDue({ ...firingNotified, lastNotifiedAt: null }, NOW)).toBe(false);
    expect(renotifyDue({ ...firingNotified, renotifyMinutes: 41 }, NOW)).toBe(false);
    expect(renotifyDue({ ...firingNotified, renotifyMinutes: 40 }, NOW)).toBe(true);
  });

  it('decisions never mutate the snapshot', () => {
    const snap = { ...firingNotified };
    const frozen = Object.freeze({ ...snap });
    decideThreshold(frozen, true, NOW);
    decideThreshold(frozen, false, NOW);
    decideRateOfChange(frozen, 'anomaly', NOW);
    expect(frozen).toEqual(snap);
  });
});
