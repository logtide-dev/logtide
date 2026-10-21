import type { Selectable } from 'kysely';
import { db } from '../../../database/index.js';
import type { IncidentsTable, IncidentStatus, Severity } from '../../../database/types.js';

/**
 * Test helpers for the incidents module. Raw inserts only: nothing here goes
 * through a service, so no notification job is ever enqueued.
 */

let monitorSeq = 0;

export async function createTestMonitor(input: {
  organizationId: string;
  projectId: string;
  name?: string;
}): Promise<{ id: string; name: string }> {
  monitorSeq += 1;
  const row = await db
    .insertInto('monitors')
    .values({
      organization_id: input.organizationId,
      project_id: input.projectId,
      name: input.name ?? `Test monitor ${monitorSeq}`,
      type: 'http',
      target: 'https://example.com/health',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow();
  return { id: row.id, name: row.name };
}

export async function insertIncident(input: {
  organizationId: string;
  projectId?: string | null;
  source?: 'sigma' | 'alert' | 'monitor' | 'manual';
  status?: IncidentStatus;
  severity?: Severity;
  title?: string;
  alertRuleId?: string | null;
  monitorId?: string | null;
  assigneeId?: string | null;
  lastEventAt?: Date;
  createdAt?: Date;
  /** Explicit updated_at (the insert does not fire the update trigger). */
  updatedAt?: Date;
}): Promise<Selectable<IncidentsTable>> {
  return db
    .insertInto('incidents')
    .values({
      organization_id: input.organizationId,
      project_id: input.projectId ?? null,
      title: input.title ?? 'Test incident',
      description: null,
      severity: input.severity ?? 'medium',
      status: input.status ?? 'open',
      assignee_id: input.assigneeId ?? null,
      source: input.source ?? 'sigma',
      alert_rule_id: input.alertRuleId ?? null,
      monitor_id: input.monitorId ?? null,
      ...(input.lastEventAt !== undefined && { last_event_at: input.lastEventAt }),
      ...(input.createdAt !== undefined && { created_at: input.createdAt }),
      ...(input.updatedAt !== undefined && { updated_at: input.updatedAt }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function addOrgMember(
  organizationId: string,
  userId: string,
  role: 'admin' | 'member' = 'member'
): Promise<void> {
  await db
    .insertInto('organization_members')
    .values({ organization_id: organizationId, user_id: userId, role })
    .execute();
}
