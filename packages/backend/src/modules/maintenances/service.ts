import type { Kysely } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, MaintenanceStatus } from '../../database/types.js';
import { assertMonitorsInProject } from '../monitoring/component-links.js';

export interface Maintenance {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: MaintenanceStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  autoUpdateStatus: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Monitors (public components) affected by the maintenance. */
  monitorIds: string[];
}

export interface CreateMaintenanceInput {
  organizationId: string;
  projectId: string;
  title: string;
  description?: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  autoUpdateStatus?: boolean;
  monitorIds?: string[];
  createdBy: string;
}

export interface UpdateMaintenanceInput {
  title?: string;
  description?: string;
  status?: MaintenanceStatus;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  autoUpdateStatus?: boolean;
  /** Replaces the linked monitors; an empty array clears them, undefined keeps them. */
  monitorIds?: string[];
}

export class MaintenanceService {
  async list(projectId: string, organizationId: string): Promise<Maintenance[]> {
    const rows = await db
      .selectFrom('scheduled_maintenances')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('organization_id', '=', organizationId)
      .orderBy('scheduled_start', 'desc')
      .execute();

    const links = await this.loadMonitorIds(db, rows.map((r) => r.id));
    return rows.map((r) => this.mapMaintenance(r, links.get(r.id) ?? []));
  }

  async getById(id: string, organizationId: string): Promise<Maintenance | null> {
    const row = await db
      .selectFrom('scheduled_maintenances')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!row) return null;
    const links = await this.loadMonitorIds(db, [row.id]);
    return this.mapMaintenance(row, links.get(row.id) ?? []);
  }

  async create(input: CreateMaintenanceInput): Promise<Maintenance> {
    return db.transaction().execute(async (trx) => {
      const monitorIds = await assertMonitorsInProject(
        trx,
        input.monitorIds ?? [],
        input.projectId,
        input.organizationId,
      );

      const row = await trx
        .insertInto('scheduled_maintenances')
        .values({
          organization_id: input.organizationId,
          project_id: input.projectId,
          title: input.title,
          description: input.description || null,
          scheduled_start: input.scheduledStart,
          scheduled_end: input.scheduledEnd,
          auto_update_status: input.autoUpdateStatus ?? true,
          created_by: input.createdBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (monitorIds.length > 0) {
        await trx
          .insertInto('maintenance_monitors')
          .values(monitorIds.map((monitor_id) => ({ maintenance_id: row.id, monitor_id })))
          .execute();
      }

      return this.mapMaintenance(row, monitorIds);
    });
  }

  async update(
    id: string,
    organizationId: string,
    input: UpdateMaintenanceInput,
  ): Promise<Maintenance | null> {
    const now = new Date();
    return db.transaction().execute(async (trx) => {
      let monitorIds: string[] | undefined;
      if (input.monitorIds !== undefined) {
        const existing = await trx
          .selectFrom('scheduled_maintenances')
          .select('project_id')
          .where('id', '=', id)
          .where('organization_id', '=', organizationId)
          .executeTakeFirst();
        if (!existing) return null;
        monitorIds = await assertMonitorsInProject(trx, input.monitorIds, existing.project_id, organizationId);
      }

      const row = await trx
        .updateTable('scheduled_maintenances')
        .set({
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description || null }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.scheduledStart !== undefined && { scheduled_start: input.scheduledStart }),
          ...(input.scheduledEnd !== undefined && { scheduled_end: input.scheduledEnd }),
          ...(input.autoUpdateStatus !== undefined && { auto_update_status: input.autoUpdateStatus }),
          // Track actual start/end times
          ...(input.status === 'in_progress' && { actual_start: now }),
          ...(input.status === 'completed' && { actual_end: now }),
          updated_at: now,
        })
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .returningAll()
        .executeTakeFirst();
      if (!row) return null;

      if (monitorIds !== undefined) {
        await trx.deleteFrom('maintenance_monitors').where('maintenance_id', '=', row.id).execute();
        if (monitorIds.length > 0) {
          await trx
            .insertInto('maintenance_monitors')
            .values(monitorIds.map((monitor_id) => ({ maintenance_id: row.id, monitor_id })))
            .execute();
        }
      } else {
        monitorIds = (await this.loadMonitorIds(trx, [row.id])).get(row.id) ?? [];
      }

      return this.mapMaintenance(row, monitorIds);
    });
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('scheduled_maintenances')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0) > 0;
  }

  /**
   * Worker: transition scheduled → in_progress and in_progress → completed
   */
  async processMaintenanceTransitions(): Promise<void> {
    const now = new Date();

    // Only auto-transition maintenances with auto_update_status enabled
    // scheduled → in_progress: when scheduled_start has passed
    await db
      .updateTable('scheduled_maintenances')
      .set({ status: 'in_progress', actual_start: now, updated_at: now })
      .where('status', '=', 'scheduled')
      .where('auto_update_status', '=', true)
      .where('scheduled_start', '<=', now)
      .execute();

    // in_progress → completed: when scheduled_end has passed
    await db
      .updateTable('scheduled_maintenances')
      .set({ status: 'completed', actual_end: now, updated_at: now })
      .where('status', '=', 'in_progress')
      .where('auto_update_status', '=', true)
      .where('scheduled_end', '<=', now)
      .execute();
  }

  /**
   * Get project IDs that currently have active maintenance with auto_update_status
   * Used by monitor service to skip checks during maintenance
   */
  async getProjectsUnderMaintenance(): Promise<Set<string>> {
    const rows = await db
      .selectFrom('scheduled_maintenances')
      .select('project_id')
      .where('status', '=', 'in_progress')
      .where('auto_update_status', '=', true)
      .execute();

    return new Set(rows.map((r) => r.project_id));
  }

  private async loadMonitorIds(
    executor: Kysely<Database>,
    maintenanceIds: string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (maintenanceIds.length === 0) return map;
    const rows = await executor
      .selectFrom('maintenance_monitors')
      .select(['maintenance_id', 'monitor_id'])
      .where('maintenance_id', 'in', maintenanceIds)
      .execute();
    for (const r of rows) {
      const list = map.get(r.maintenance_id);
      if (list) list.push(r.monitor_id);
      else map.set(r.maintenance_id, [r.monitor_id]);
    }
    return map;
  }

  private mapMaintenance(row: any, monitorIds: string[] = []): Maintenance {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      scheduledStart: new Date(row.scheduled_start),
      scheduledEnd: new Date(row.scheduled_end),
      actualStart: row.actual_start ? new Date(row.actual_start) : null,
      actualEnd: row.actual_end ? new Date(row.actual_end) : null,
      autoUpdateStatus: row.auto_update_status,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      monitorIds,
    };
  }
}

export const maintenanceService = new MaintenanceService();
