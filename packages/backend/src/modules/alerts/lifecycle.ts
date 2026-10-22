import type { AlertRuleState } from '../../database/types.js';

/**
 * Pure alert rule lifecycle state machine (no I/O). The tables in the W8 plan
 * ("State machine", rows T1-T10 and R1-R8) are the specification; the tests
 * in tests/modules/alerts/lifecycle-decide.test.ts are named after them.
 *
 * Every comparison uses the run's `now`, so one evaluation run is consistent
 * and tests drive time by passing `now`.
 */

export interface LifecycleSnapshot {
  state: AlertRuleState;
  lastTriggeredAt: Date | null;
  lastNotifiedAt: Date | null;
  snoozedUntil: Date | null;
  renotifyMinutes: number | null;
}

export type LifecycleDecision =
  | { type: 'none' }
  | { type: 'fire'; notification: 'triggered' | null }
  | { type: 'notify'; notification: 'triggered' | 'renotify' }
  | { type: 'resolve'; notification: 'resolved' | null };

/**
 * Rate-of-change evaluation outcome:
 * - skipped: in cooldown while ok, no baseline queries were run
 * - pending: deviating but sustained checks not reached, or in cooldown and still deviating
 * - anomaly: deviating with sustained checks reached (only computed outside cooldown)
 * - recovered: no baseline, baseline below min_baseline_value, or deviation below the multiplier
 */
export type RateOfChangeSignal = 'skipped' | 'pending' | 'anomaly' | 'recovered';

const NONE: LifecycleDecision = { type: 'none' };

/** S: snoozed_until is set and still in the future. */
export function isSnoozed(s: LifecycleSnapshot, now: Date): boolean {
  return s.snoozedUntil !== null && s.snoozedUntil.getTime() > now.getTime();
}

/** N: the current episode already produced a firing notification. */
export function episodeNotified(s: LifecycleSnapshot): boolean {
  if (s.lastNotifiedAt === null) return false;
  if (s.lastTriggeredAt === null) return true;
  return s.lastNotifiedAt.getTime() >= s.lastTriggeredAt.getTime();
}

/** D: a re-notify interval is set and has elapsed since the last notification. */
export function renotifyDue(s: LifecycleSnapshot, now: Date): boolean {
  if (s.renotifyMinutes === null || s.lastNotifiedAt === null) return false;
  return now.getTime() - s.lastNotifiedAt.getTime() >= s.renotifyMinutes * 60_000;
}

export function decideThreshold(s: LifecycleSnapshot, breaching: boolean, now: Date): LifecycleDecision {
  const snoozed = isSnoozed(s, now);

  if (s.state === 'ok') {
    if (!breaching) return NONE; // T1
    return { type: 'fire', notification: snoozed ? null : 'triggered' }; // T2, T3
  }

  // firing
  if (!breaching) {
    // T8, T9, T10: snooze never suppresses a resolve
    return { type: 'resolve', notification: episodeNotified(s) ? 'resolved' : null };
  }
  if (snoozed) return NONE; // T7
  if (!episodeNotified(s)) return { type: 'notify', notification: 'triggered' }; // T6
  if (renotifyDue(s, now)) return { type: 'notify', notification: 'renotify' }; // T4
  return NONE; // T5
}

export function decideRateOfChange(
  s: LifecycleSnapshot,
  signal: RateOfChangeSignal,
  now: Date
): LifecycleDecision {
  const snoozed = isSnoozed(s, now);

  if (s.state === 'ok') {
    if (signal !== 'anomaly') return NONE; // R1
    return { type: 'fire', notification: snoozed ? null : 'triggered' }; // R2, R3
  }

  // firing
  switch (signal) {
    case 'skipped':
    case 'pending':
      return NONE; // R4
    case 'anomaly':
      if (snoozed) return NONE; // R6
      // R5: cooldown already gates how often an anomaly is computed
      return { type: 'notify', notification: episodeNotified(s) ? 'renotify' : 'triggered' };
    case 'recovered':
      // R7, R8: snooze never suppresses a resolve
      return { type: 'resolve', notification: episodeNotified(s) ? 'resolved' : null };
  }
}
