import type { Kysely } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, StatusIncidentStatus, StatusIncidentSeverity } from '../../database/types.js';
import { assertMonitorsInProject, assertMonitorSourceIncident } from '../monitoring/component-links.js';

export interface StatusIncident {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  status: StatusIncidentStatus;
  severity: StatusIncidentSeverity;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  /** Monitors (public components) this status update affects. */
  monitorIds: string[];
  /** Shared incident this update was published from, when any. */
  sourceIncidentId: string | null;
}

export interface StatusIncidentUpdate {
  id: string;
  incidentId: string;
  status: StatusIncidentStatus;
  message: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface CreateStatusIncidentInput {
  organizationId: string;
  projectId: string;
  title: string;
  status?: StatusIncidentStatus;
  severity?: StatusIncidentSeverity;
  message?: string;
  monitorIds?: string[];
  sourceIncidentId?: string;
  createdBy: string;
}

export interface UpdateStatusIncidentInput {
  title?: string;
  status?: StatusIncidentStatus;
  severity?: StatusIncidentSeverity;
  /** Replaces the linked monitors; an empty array clears them, undefined keeps them. */
  monitorIds?: string[];
}

export class StatusIncidentService {
  async list(
    projectId: string,
    organizationId: string,
    filter: { sourceIncidentId?: string } = {},
  ): Promise<StatusIncident[]> {
    let query = db
      .selectFrom('status_incidents')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('organization_id', '=', organizationId);
    if (filter.sourceIncidentId) {
      query = query.where('source_incident_id', '=', filter.sourceIncidentId);
    }
    const rows = await query.orderBy('created_at', 'desc').execute();

    const links = await this.loadMonitorIds(db, rows.map((r) => r.id));
    return rows.map((r) => this.mapIncident(r, links.get(r.id) ?? []));
  }

  async getById(id: string, organizationId: string): Promise<StatusIncident | null> {
    const row = await db
      .selectFrom('status_incidents')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!row) return null;
    const links = await this.loadMonitorIds(db, [row.id]);
    return this.mapIncident(row, links.get(row.id) ?? []);
  }

  async create(input: CreateStatusIncidentInput): Promise<StatusIncident> {
    return db.transaction().execute(async (trx) => {
      const monitorIds = await assertMonitorsInProject(
        trx,
        input.monitorIds ?? [],
        input.projectId,
        input.organizationId,
      );
      if (input.sourceIncidentId) {
        await assertMonitorSourceIncident(trx, input.sourceIncidentId, input.organizationId);
      }

      const row = await trx
        .insertInto('status_incidents')
        .values({
          organization_id: input.organizationId,
          project_id: input.projectId,
          title: input.title,
          status: input.status ?? 'investigating',
          severity: input.severity ?? 'minor',
          created_by: input.createdBy,
          source_incident_id: input.sourceIncidentId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create initial update if message provided
      if (input.message) {
        await trx
          .insertInto('status_incident_updates')
          .values({
            incident_id: row.id,
            status: row.status,
            message: input.message,
            created_by: input.createdBy,
          })
          .execute();
      }

      if (monitorIds.length > 0) {
        await trx
          .insertInto('status_incident_monitors')
          .values(monitorIds.map((monitor_id) => ({ incident_id: row.id, monitor_id })))
          .execute();
      }

      return this.mapIncident(row, monitorIds);
    });
  }

  async update(
    id: string,
    organizationId: string,
    input: UpdateStatusIncidentInput,
  ): Promise<StatusIncident | null> {
    const now = new Date();

    // Build resolved_at: set when resolving, clear when re-opening
    const resolvedAtUpdate = input.status === 'resolved'
      ? { resolved_at: now }
      : input.status !== undefined
        ? { resolved_at: null }
        : {};

    return db.transaction().execute(async (trx) => {
      let monitorIds: string[] | undefined;
      if (input.monitorIds !== undefined) {
        const existing = await trx
          .selectFrom('status_incidents')
          .select('project_id')
          .where('id', '=', id)
          .where('organization_id', '=', organizationId)
          .executeTakeFirst();
        if (!existing) return null;
        monitorIds = await assertMonitorsInProject(trx, input.monitorIds, existing.project_id, organizationId);
      }

      const row = await trx
        .updateTable('status_incidents')
        .set({
          ...(input.title !== undefined && { title: input.title }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.severity !== undefined && { severity: input.severity }),
          ...resolvedAtUpdate,
          updated_at: now,
        })
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .returningAll()
        .executeTakeFirst();
      if (!row) return null;

      if (monitorIds !== undefined) {
        await trx.deleteFrom('status_incident_monitors').where('incident_id', '=', row.id).execute();
        if (monitorIds.length > 0) {
          await trx
            .insertInto('status_incident_monitors')
            .values(monitorIds.map((monitor_id) => ({ incident_id: row.id, monitor_id })))
            .execute();
        }
      } else {
        monitorIds = (await this.loadMonitorIds(trx, [row.id])).get(row.id) ?? [];
      }

      return this.mapIncident(row, monitorIds);
    });
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('status_incidents')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0) > 0;
  }

  // Updates (timeline entries)
  async getUpdates(incidentId: string): Promise<StatusIncidentUpdate[]> {
    const rows = await db
      .selectFrom('status_incident_updates')
      .selectAll()
      .where('incident_id', '=', incidentId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(this.mapUpdate);
  }

  async addUpdate(
    incidentId: string,
    organizationId: string,
    input: { status: StatusIncidentStatus; message: string; createdBy: string },
  ): Promise<StatusIncidentUpdate> {
    return db.transaction().execute(async (trx) => {
      // Verify incident belongs to org inside the transaction
      const incident = await trx
        .selectFrom('status_incidents')
        .select('id')
        .where('id', '=', incidentId)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst();
      if (!incident) throw new Error('Incident not found');

      const row = await trx
        .insertInto('status_incident_updates')
        .values({
          incident_id: incidentId,
          status: input.status,
          message: input.message,
          created_by: input.createdBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Update parent incident status + resolved_at
      const now = new Date();
      await trx
        .updateTable('status_incidents')
        .set({
          status: input.status,
          updated_at: now,
          ...(input.status === 'resolved' ? { resolved_at: now } : { resolved_at: null }),
        })
        .where('id', '=', incidentId)
        .execute();

      return this.mapUpdate(row);
    });
  }

  private async loadMonitorIds(
    executor: Kysely<Database>,
    incidentIds: string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (incidentIds.length === 0) return map;
    const rows = await executor
      .selectFrom('status_incident_monitors')
      .select(['incident_id', 'monitor_id'])
      .where('incident_id', 'in', incidentIds)
      .execute();
    for (const r of rows) {
      const list = map.get(r.incident_id);
      if (list) list.push(r.monitor_id);
      else map.set(r.incident_id, [r.monitor_id]);
    }
    return map;
  }

  private mapIncident(row: any, monitorIds: string[] = []): StatusIncident {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      severity: row.severity,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      monitorIds,
      sourceIncidentId: row.source_incident_id ?? null,
    };
  }

  private mapUpdate(row: any): StatusIncidentUpdate {
    return {
      id: row.id,
      incidentId: row.incident_id,
      status: row.status,
      message: row.message,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
    };
  }
}

export const statusIncidentService = new StatusIncidentService();
