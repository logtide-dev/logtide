/**
 * Status debounce of a hardware host. PURE: no database, no clock.
 *
 * The stored `status` of a host is its effective status: incidents and
 * notifications follow it, and the UI shows it. A raw evaluation that differs
 * from it is kept as pending (`pendingStatus` since `pendingSince`) until it
 * lasted long enough (HARDWARE_DEBOUNCE):
 *  - worse (ok/unknown/stale -> warning/critical, warning -> critical): held
 *    for two consecutive passes and at least `escalateAfterMs`. While worse
 *    readings change level (warning then critical), the level that held the
 *    whole time (the lower one) is what gets promoted; the higher one starts
 *    its own wait from there;
 *  - back to ok: ok held for `recoverAfterMs`;
 *  - critical -> warning: warning or better held for `deescalateAfterMs`.
 * `stale` and `unknown` are no reading at all: they apply at once and drop
 * the pending change. Leaving them for ok is immediate too, unless a
 * degradation episode is still open (the host went stale while degraded):
 * then ok must hold like any recovery.
 */
import { HARDWARE_DEBOUNCE, type HardwareStatus } from '@logtide/shared';

export type HardwareLevel = 'ok' | 'warning' | 'critical';

export interface DebounceState {
  /** Effective (stored) status. */
  status: HardwareStatus;
  pendingStatus: HardwareLevel | null;
  pendingSince: Date | null;
  /** The host degraded and has not recovered to ok since. */
  episodeOpen: boolean;
}

export interface DebounceResult {
  status: HardwareStatus;
  pendingStatus: HardwareLevel | null;
  pendingSince: Date | null;
}

const RANK: Record<HardwareLevel, number> = { ok: 0, warning: 1, critical: 2 };

export function isProblemStatus(status: HardwareStatus | null): status is 'warning' | 'critical' {
  return status === 'warning' || status === 'critical';
}

const lower = (a: HardwareLevel, b: HardwareLevel): HardwareLevel => (RANK[a] <= RANK[b] ? a : b);
const higher = (a: HardwareLevel, b: HardwareLevel): HardwareLevel => (RANK[a] >= RANK[b] ? a : b);

function settled(status: HardwareStatus): DebounceResult {
  return { status, pendingStatus: null, pendingSince: null };
}

/** The effective status after a pass that evaluated `raw` at `now`. */
export function debounceStatus(state: DebounceState, raw: HardwareStatus, now: Date): DebounceResult {
  if (raw === 'stale' || raw === 'unknown') return settled(raw);

  const effective = state.status;
  const { pendingStatus: pending, pendingSince: since } = state;
  const nowMs = now.getTime();

  // Promote `level` once it held since `start`; a raw reading beyond it
  // starts its own wait.
  const decide = (level: HardwareLevel, start: Date, holdMs: number): DebounceResult => {
    if (nowMs - start.getTime() < holdMs) return { status: effective, pendingStatus: level, pendingSince: start };
    return raw === level ? settled(level) : { status: level, pendingStatus: raw, pendingSince: now };
  };

  const effectiveRank = isProblemStatus(effective) ? RANK[effective] : 0;
  if (RANK[raw] > effectiveRank) {
    const continuing = pending !== null && since !== null && RANK[pending] > effectiveRank;
    return continuing
      ? decide(lower(pending, raw), since, HARDWARE_DEBOUNCE.escalateAfterMs)
      : decide(raw, now, HARDWARE_DEBOUNCE.escalateAfterMs);
  }

  const recovering = isProblemStatus(effective) || (effective !== 'ok' && state.episodeOpen);
  const ceiling = isProblemStatus(effective) ? RANK[effective] : RANK.warning;
  if (recovering && RANK[raw] < ceiling) {
    const continuing = pending !== null && since !== null && RANK[pending] < ceiling;
    const level = continuing ? higher(pending, raw) : raw;
    const start = continuing ? since : now;
    const hold = level === 'ok' ? HARDWARE_DEBOUNCE.recoverAfterMs : HARDWARE_DEBOUNCE.deescalateAfterMs;
    return decide(level, start, hold);
  }

  // Same level, or ok from unknown/stale with nothing open.
  return settled(raw);
}
