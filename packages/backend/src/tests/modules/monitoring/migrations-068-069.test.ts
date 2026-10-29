import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/factories.js';
import { CAPABILITIES } from '../../../capabilities/registry.js';

async function insertMonitor(
  organizationId: string,
  projectId: string,
  type: string,
  extra: Record<string, unknown> = {}
) {
  return db
    .insertInto('monitors')
    .values({
      organization_id: organizationId,
      project_id: projectId,
      name: `m-${Math.random().toString(36).slice(2, 8)}`,
      type: type as any,
      target: 'example.com',
      ...extra,
    } as any)
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('migrations 068 and 069', () => {
  let organizationId: string;
  let projectId: string;

  beforeEach(async () => {
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  it('monitors accepts ssl and dns and rejects ping', async () => {
    await expect(insertMonitor(organizationId, projectId, 'ssl')).resolves.toBeDefined();
    await expect(insertMonitor(organizationId, projectId, 'dns')).resolves.toBeDefined();
    await expect(insertMonitor(organizationId, projectId, 'ping')).rejects.toThrow(/monitors_type_check/);
  });

  it('monitors new columns default (display_order 0, display_name null, check_config null)', async () => {
    const m = await insertMonitor(organizationId, projectId, 'http');
    expect(m.display_order).toBe(0);
    expect(m.display_name).toBeNull();
    expect(m.group_name).toBeNull();
    expect(m.check_config).toBeNull();
  });

  it('status_page_config rejects accent #12345 and accepts #1a2B3c', async () => {
    await expect(
      db
        .insertInto('status_page_config')
        .values({ project_id: projectId, organization_id: organizationId, accent_color: '#12345' })
        .execute()
    ).rejects.toThrow(/accent_color/);

    await db
      .insertInto('status_page_config')
      .values({ project_id: projectId, organization_id: organizationId, accent_color: '#1a2B3c' })
      .execute();
    const row = await db
      .selectFrom('status_page_config')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirstOrThrow();
    expect(row.accent_color).toBe('#1a2B3c');
    expect(row.show_monitor_types).toBe(false);
  });

  it('subscriber unique per project and normalized email', async () => {
    const values = {
      organization_id: organizationId,
      project_id: projectId,
      email: 'Jane@Example.com',
      email_normalized: 'jane@example.com',
    };
    await db.insertInto('status_page_subscribers').values(values).execute();
    await expect(
      db
        .insertInto('status_page_subscribers')
        .values({ ...values, email: 'jane@example.com' })
        .execute()
    ).rejects.toThrow(/status_page_subscribers_project_email_unique/);

    const other = await createTestContext();
    await expect(
      db
        .insertInto('status_page_subscribers')
        .values({
          organization_id: other.organization.id,
          project_id: other.project.id,
          email: 'jane@example.com',
          email_normalized: 'jane@example.com',
        })
        .execute()
    ).resolves.toBeDefined();
  });

  it('deleting a project cascades config, subscribers and component links', async () => {
    const monitor = await insertMonitor(organizationId, projectId, 'http');
    await db
      .insertInto('status_page_config')
      .values({ project_id: projectId, organization_id: organizationId, title: 'Status' })
      .execute();
    await db
      .insertInto('status_page_subscribers')
      .values({
        organization_id: organizationId,
        project_id: projectId,
        email: 'a@example.com',
        email_normalized: 'a@example.com',
      })
      .execute();
    const si = await db
      .insertInto('status_incidents')
      .values({ organization_id: organizationId, project_id: projectId, title: 'Outage' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('status_incident_monitors')
      .values({ incident_id: si.id, monitor_id: monitor.id })
      .execute();
    const mt = await db
      .insertInto('scheduled_maintenances')
      .values({
        organization_id: organizationId,
        project_id: projectId,
        title: 'Window',
        scheduled_start: new Date(Date.now() + 3600_000),
        scheduled_end: new Date(Date.now() + 7200_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('maintenance_monitors')
      .values({ maintenance_id: mt.id, monitor_id: monitor.id })
      .execute();

    await db.deleteFrom('projects').where('id', '=', projectId).where('organization_id', '=', organizationId).execute();

    const count = async (table: any, col: string, id: string) => {
      const rows = await db.selectFrom(table).selectAll().where(col, '=', id).execute();
      return rows.length;
    };
    expect(await count('status_page_config', 'project_id', projectId)).toBe(0);
    expect(await count('status_page_subscribers', 'project_id', projectId)).toBe(0);
    expect(await count('status_incident_monitors', 'monitor_id', monitor.id)).toBe(0);
    expect(await count('maintenance_monitors', 'monitor_id', monitor.id)).toBe(0);
  });

  it('status_incident_monitors primary key is (incident_id, monitor_id)', async () => {
    const monitor = await insertMonitor(organizationId, projectId, 'http');
    const si = await db
      .insertInto('status_incidents')
      .values({ organization_id: organizationId, project_id: projectId, title: 'Outage' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const link = { incident_id: si.id, monitor_id: monitor.id };
    await db.insertInto('status_incident_monitors').values(link).execute();
    await expect(db.insertInto('status_incident_monitors').values(link).execute()).rejects.toThrow(
      /status_incident_monitors_pkey/
    );
  });

  it('registry exposes status_page.subscribers.max as an unlimited limit', () => {
    const def = CAPABILITIES['status_page.subscribers.max'];
    expect(def.kind).toBe('limit');
    expect((def as { defaultLimit: number | null }).defaultLimit).toBeNull();
  });
});
