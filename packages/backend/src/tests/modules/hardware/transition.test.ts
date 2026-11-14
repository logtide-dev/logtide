import { describe, it, expect } from 'vitest';
import type { HardwareStatus } from '@logtide/shared';
import { debounceStatus, type DebounceState } from '../../../modules/hardware/transition.js';

// Pure unit tests, no database.

const MIN = 60_000;
const T0 = new Date('2026-11-10T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

/** Runs passes (minute, raw status) from `start` and returns the effective status after each. */
function passes(start: Partial<DebounceState>, steps: Array<[number, HardwareStatus]>): HardwareStatus[] {
  let state: DebounceState = { status: 'ok', pendingStatus: null, pendingSince: null, episodeOpen: false, ...start };
  const out: HardwareStatus[] = [];
  for (const [minute, raw] of steps) {
    const r = debounceStatus(state, raw, at(minute));
    const problem = r.status === 'warning' || r.status === 'critical';
    state = {
      ...r,
      episodeOpen: problem ? true : r.status === 'ok' ? false : state.episodeOpen,
    };
    out.push(r.status);
  }
  return out;
}

describe('debounceStatus', () => {
  it('a worse status needs two passes and 3 minutes', () => {
    expect(passes({}, [[0, 'warning'], [2, 'warning'], [4, 'warning']])).toEqual(['ok', 'ok', 'warning']);
    expect(passes({}, [[0, 'critical'], [3, 'critical']])).toEqual(['ok', 'critical']);
  });

  it('a single bad reading never opens anything', () => {
    expect(passes({}, [[0, 'critical'], [2, 'ok'], [4, 'critical'], [6, 'ok']])).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('warning then critical: warning (held the whole time) is promoted first, critical waits its own 3 minutes', () => {
    expect(passes({}, [[0, 'warning'], [2, 'critical'], [4, 'critical'], [6, 'critical'], [8, 'critical']])).toEqual([
      'ok',
      'ok',
      'warning',
      'warning',
      'critical',
    ]);
  });

  it('warning -> critical is debounced too', () => {
    expect(passes({ status: 'warning', episodeOpen: true }, [[0, 'critical'], [2, 'critical'], [4, 'critical']])).toEqual([
      'warning',
      'warning',
      'critical',
    ]);
  });

  it('recovery to ok needs 10 minutes of ok', () => {
    expect(passes({ status: 'critical', episodeOpen: true }, [[0, 'ok'], [4, 'ok'], [8, 'ok'], [10, 'ok']])).toEqual([
      'critical',
      'critical',
      'critical',
      'ok',
    ]);
  });

  it('a relapse during recovery resets the wait', () => {
    expect(passes({ status: 'warning', episodeOpen: true }, [[0, 'ok'], [6, 'warning'], [8, 'ok'], [16, 'ok'], [18, 'ok']])).toEqual([
      'warning',
      'warning',
      'warning',
      'warning',
      'ok',
    ]);
  });

  it('critical -> warning after 10 minutes below critical', () => {
    expect(passes({ status: 'critical', episodeOpen: true }, [[0, 'warning'], [6, 'warning'], [10, 'warning']])).toEqual([
      'critical',
      'critical',
      'warning',
    ]);
  });

  it('critical, then ok and warning mixed: warning after 10 minutes, ok needs its own 10 minutes', () => {
    expect(passes({ status: 'critical', episodeOpen: true }, [[0, 'ok'], [4, 'warning'], [10, 'ok'], [16, 'ok'], [20, 'ok']])).toEqual([
      'critical',
      'critical',
      'warning',
      'warning',
      'ok',
    ]);
  });

  it('stale and unknown apply at once and drop the pending change', () => {
    expect(passes({}, [[0, 'critical'], [2, 'stale'], [4, 'critical'], [6, 'critical']])).toEqual(['ok', 'stale', 'stale', 'stale']);
    expect(passes({ status: 'critical', episodeOpen: true }, [[0, 'stale']])).toEqual(['stale']);
  });

  it('ok from unknown or stale is immediate when nothing is open', () => {
    expect(passes({ status: 'unknown' }, [[0, 'ok']])).toEqual(['ok']);
    expect(passes({ status: 'stale' }, [[0, 'ok']])).toEqual(['ok']);
  });

  it('a host that went stale while degraded must hold ok for 10 minutes', () => {
    expect(passes({ status: 'stale', episodeOpen: true }, [[0, 'ok'], [5, 'ok'], [10, 'ok']])).toEqual(['stale', 'stale', 'ok']);
  });

  it('a host that went stale while degraded and comes back degraded is debounced as a worsening', () => {
    expect(passes({ status: 'stale', episodeOpen: true }, [[0, 'critical'], [3, 'critical']])).toEqual(['stale', 'critical']);
  });

  it('a steady status keeps no pending change', () => {
    const r = debounceStatus({ status: 'warning', pendingStatus: 'ok', pendingSince: at(0), episodeOpen: true }, 'warning', at(2));
    expect(r).toEqual({ status: 'warning', pendingStatus: null, pendingSince: null });
  });
});
