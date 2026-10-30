import type { IncidentSource, IncidentStatus, Severity } from '@logtide/shared';

/** Columns to write for a status change; the history trigger clears stale lifecycle fields itself. */
export type StatusPlan =
  | {
      ok: true;
      set: {
        status?: IncidentStatus;
        acknowledged_at?: Date;
        acknowledged_by?: string | null;
        resolved_at?: Date;
        resolved_by?: string | null;
      };
    }
  | { ok: false; code: 'false_positive_not_allowed' };

/**
 * Pure status rules shared by single and bulk updates.
 * - Same status: no-op.
 * - false_positive: security (sigma) incidents only; stamps the resolver.
 * - investigating (shown as Acknowledged): stamps who acknowledged and when.
 * - resolved: stamps who resolved and when.
 * - open: only the status; the trigger clears resolution and acknowledgement.
 */
export function planStatusChange(
  current: { status: IncidentStatus; source: IncidentSource },
  next: IncidentStatus,
  actorId: string | null,
  now: Date
): StatusPlan {
  if (current.status === next) return { ok: true, set: {} };

  switch (next) {
    case 'false_positive':
      if (current.source !== 'sigma') return { ok: false, code: 'false_positive_not_allowed' };
      return { ok: true, set: { status: 'false_positive', resolved_by: actorId } };
    case 'investigating':
      return { ok: true, set: { status: 'investigating', acknowledged_at: now, acknowledged_by: actorId } };
    case 'resolved':
      return { ok: true, set: { status: 'resolved', resolved_at: now, resolved_by: actorId } };
    case 'open':
    default:
      return { ok: true, set: { status: next } };
  }
}

const SEVERITY_ORDER: readonly Severity[] = ['informational', 'low', 'medium', 'high', 'critical'];

/** The more severe of two severities (an incident's severity only escalates). */
export function higherSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(b) > SEVERITY_ORDER.indexOf(a) ? b : a;
}
