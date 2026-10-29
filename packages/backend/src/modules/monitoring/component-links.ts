import type { Kysely } from 'kysely';
import type { Database } from '../../database/types.js';

/**
 * Helpers shared by status updates and maintenances to link themselves to
 * monitors ("affected components"). The link tables carry no tenant column,
 * so every write validates the monitor ids against the owning project and
 * organization first.
 */

export const MAX_LINKED_MONITORS = 50;

/** Raised when a monitorId is not a monitor of the project. */
export class InvalidMonitorIdsError extends Error {
  constructor() {
    super('monitorIds must belong to the project');
  }
}

/** Raised when sourceIncidentId is not a monitor incident of the organization. */
export class InvalidSourceIncidentError extends Error {
  constructor() {
    super('sourceIncidentId must be a monitor incident of the organization');
  }
}

/** Deduplicates and checks that every monitor belongs to the project and organization. */
export async function assertMonitorsInProject(
  db: Kysely<Database>,
  monitorIds: string[],
  projectId: string,
  organizationId: string
): Promise<string[]> {
  const unique = [...new Set(monitorIds)];
  if (unique.length === 0) return unique;
  const rows = await db
    .selectFrom('monitors')
    .select('id')
    .where('id', 'in', unique)
    .where('project_id', '=', projectId)
    .where('organization_id', '=', organizationId)
    .execute();
  if (rows.length !== unique.length) throw new InvalidMonitorIdsError();
  return unique;
}

export async function assertMonitorSourceIncident(
  db: Kysely<Database>,
  sourceIncidentId: string,
  organizationId: string
): Promise<void> {
  const row = await db
    .selectFrom('incidents')
    .select('id')
    .where('id', '=', sourceIncidentId)
    .where('organization_id', '=', organizationId)
    .where('source', '=', 'monitor')
    .executeTakeFirst();
  if (!row) throw new InvalidSourceIncidentError();
}
