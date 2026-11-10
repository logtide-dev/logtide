import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/factories.js';

describe('migration 079 hardware health', () => {
  let organizationId: string;
  let projectId: string;

  beforeEach(async () => {
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  async function insertHost(hostName: string, extra: Record<string, unknown> = {}) {
    return db
      .insertInto('hardware_hosts')
      .values({ organization_id: organizationId, project_id: projectId, host_name: hostName, ...extra } as any)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  it('hardware_hosts has sane defaults', async () => {
    const h = await insertHost('srv-1');
    expect(h.status).toBe('unknown');
    expect(h.muted).toBe(false);
    expect(h.is_virtual).toBeNull();
    expect(h.components).toEqual({});
    expect(h.findings).toEqual([]);
    expect(h.collectors).toEqual([]);
    expect(h.last_seen_at).toBeNull();
    expect(h.first_seen_at).toBeInstanceOf(Date);
  });

  it('hardware_hosts is unique per project and host name and checks status', async () => {
    await insertHost('srv-1');
    await expect(insertHost('srv-1')).rejects.toThrow(/uq_hardware_hosts_project_host/);
    await expect(insertHost('srv-2', { status: 'broken' })).rejects.toThrow(/hardware_hosts_status_check/);
    await expect(insertHost('')).rejects.toThrow(/hardware_hosts_host_name_check/);
  });

  it('incidents accept source hardware with a host link, one active incident per host', async () => {
    const host = await insertHost('srv-1');
    const base = {
      organization_id: organizationId,
      project_id: projectId,
      title: 'Hardware critical: srv-1',
      severity: 'critical' as const,
      source: 'hardware',
      hardware_host_id: host.id,
    };
    const first = await db.insertInto('incidents').values(base).returning('id').executeTakeFirstOrThrow();
    await expect(db.insertInto('incidents').values(base).execute()).rejects.toThrow(/uq_incidents_active_hardware_host/);

    // A resolved one does not block a new active one.
    await db.updateTable('incidents').set({ status: 'resolved' }).where('id', '=', first.id).where('organization_id', '=', organizationId).execute();
    await expect(db.insertInto('incidents').values(base).execute()).resolves.toBeDefined();
  });

  it('deleting a host keeps its incidents and clears the link', async () => {
    const host = await insertHost('srv-1');
    const inc = await db
      .insertInto('incidents')
      .values({
        organization_id: organizationId,
        project_id: projectId,
        title: 't',
        severity: 'medium',
        source: 'hardware',
        hardware_host_id: host.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.deleteFrom('hardware_hosts').where('id', '=', host.id).where('organization_id', '=', organizationId).execute();
    const row = await db
      .selectFrom('incidents')
      .select(['hardware_host_id'])
      .where('id', '=', inc.id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirstOrThrow();
    expect(row.hardware_host_id).toBeNull();
  });

  it('organization_default_channels accepts the hardware event type', async () => {
    const channel = await db
      .insertInto('notification_channels')
      .values({ organization_id: organizationId, name: 'c', type: 'email', config: { recipients: ['a@example.com'] } } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('organization_default_channels')
        .values({ organization_id: organizationId, event_type: 'hardware', channel_id: channel.id } as any)
        .execute()
    ).resolves.toBeDefined();
    await expect(
      db
        .insertInto('organization_default_channels')
        .values({ organization_id: organizationId, event_type: 'nope', channel_id: channel.id } as any)
        .execute()
    ).rejects.toThrow(/organization_default_channels_event_type_check/);
  });
});
