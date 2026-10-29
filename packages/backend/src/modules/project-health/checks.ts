/**
 * Project health checks: pure evaluation, no I/O.
 *
 * The evaluator gathers the inputs in batch for every project and asks this
 * module which checks are currently open; persistence and notifications live
 * elsewhere so the conditions can be tested at their boundaries.
 */

import type { ProjectHealthCheckKey } from '@logtide/shared';

export type SkewSignal = 'logs' | 'spans' | 'metrics';

export interface ProjectHealthInputs {
  /** Latest event of any signal (max of has_logs_at/has_traces_at/has_metrics_at). */
  lastEventAt: Date | null;
  silentMinutes: number;
  piiRejected60m: number;
  revokedKey60m: number;
  skew24h: {
    logs: number;
    spans: number;
    metrics: number;
    maxPastMs: Record<SkewSignal, number | null>;
    /** Optional: worst future delta per signal, shown in details when present. */
    maxFutureMs?: Record<SkewSignal, number | null>;
  };
  now: Date;
  /**
   * False while the health cron has never seen the project receiving data
   * (idle before health checks existed): the silent check stays off.
   * Defaults to true.
   */
  silentArmed?: boolean;
}

const SKEW_CHECKS: Record<SkewSignal, ProjectHealthCheckKey> = {
  logs: 'timestamp_skew_logs',
  spans: 'timestamp_skew_spans',
  metrics: 'timestamp_skew_metrics',
};

function toHours(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/** Open checks for one project: check key -> details stored on the issue. */
export function computeOpenChecks(
  i: ProjectHealthInputs
): Map<ProjectHealthCheckKey, Record<string, unknown>> {
  const open = new Map<ProjectHealthCheckKey, Record<string, unknown>>();

  // silent: only for projects that ever received an event. The minimum
  // threshold (10 min) is above the 5 min has_*_at debounce, so a project that
  // keeps sending never flaps.
  if (
    i.silentArmed !== false &&
    i.lastEventAt !== null &&
    i.now.getTime() - i.lastEventAt.getTime() > i.silentMinutes * 60_000
  ) {
    open.set('silent', { lastEventAt: i.lastEventAt.toISOString(), silentMinutes: i.silentMinutes });
  }

  if (i.piiRejected60m > 0) {
    open.set('pii_rejected', { count60m: i.piiRejected60m });
  }

  if (i.revokedKey60m > 0) {
    open.set('revoked_key', { count60m: i.revokedKey60m });
  }

  // Same condition as projectsService.getIngestionHealth: any skewed record in 24h.
  for (const signal of ['logs', 'spans', 'metrics'] as const) {
    const count = i.skew24h[signal];
    if (count > 0) {
      const details: Record<string, unknown> = {
        count24h: count,
        maxPastHours: toHours(i.skew24h.maxPastMs[signal]),
      };
      const future = toHours(i.skew24h.maxFutureMs?.[signal]);
      if (future !== null) details.maxFutureHours = future;
      open.set(SKEW_CHECKS[signal], details);
    }
  }

  return open;
}
