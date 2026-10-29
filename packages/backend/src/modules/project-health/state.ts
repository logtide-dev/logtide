/**
 * Rollout state per project (project_health_state, migration 074).
 *
 * first_evaluated_at: the cron pass that first saw the project. Issues opened
 * on that pass are baseline (pre-existing problems, never notified).
 * last_receiving_at: the last pass that saw the project receiving data. The
 * silent check only arms once this is set, so a project already idle when
 * health checks were introduced never raises "stopped sending data".
 */

import { sql } from 'kysely';
import { db } from '../../database/connection.js';

export interface ProjectHealthState {
  firstEvaluatedAt: Date;
  lastReceivingAt: Date | null;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

export async function getStateForProjects(
  projectIds: string[]
): Promise<Map<string, ProjectHealthState>> {
  const map = new Map<string, ProjectHealthState>();
  if (projectIds.length === 0) return map;
  const rows = await db
    .selectFrom('project_health_state')
    .select(['project_id', 'first_evaluated_at', 'last_receiving_at'])
    // tenant-scope-ok: system cron over pre-resolved non-deleted project ids
    .where('project_id', 'in', projectIds)
    .execute();
  for (const r of rows) {
    map.set(r.project_id, {
      firstEvaluatedAt: toDate(r.first_evaluated_at as Date | string),
      lastReceivingAt: r.last_receiving_at ? toDate(r.last_receiving_at as Date | string) : null,
    });
  }
  return map;
}

/** Record a pass: keeps first_evaluated_at, advances last_receiving_at when receiving. */
export async function recordEvaluation(
  organizationId: string,
  projectId: string,
  receiving: boolean,
  now: Date
): Promise<void> {
  const receivingAt = receiving ? now : null;
  await db
    .insertInto('project_health_state')
    .values({
      project_id: projectId,
      organization_id: organizationId,
      first_evaluated_at: now,
      last_receiving_at: receivingAt,
    })
    .onConflict((oc) =>
      oc.column('project_id').doUpdateSet({
        last_receiving_at: sql`COALESCE(EXCLUDED.last_receiving_at, project_health_state.last_receiving_at)`,
      })
    )
    .execute();
}
