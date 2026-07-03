import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { receiversService } from '../../../modules/receivers/service.js';
import { createTestContext } from '../../helpers/factories.js';

describe('ReceiversService', () => {
  let projectId: string;
  let orgId: string;

  beforeEach(async () => {
    await db.deleteFrom('receiver_events').execute();
    await db.deleteFrom('receivers').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();
    const ctx = await createTestContext();
    projectId = ctx.project.id;
    orgId = ctx.organization.id;
  });

  it('creates a receiver and returns the plaintext token once', async () => {
    const { id, token } = await receiversService.createReceiver({
      projectId,
      name: 'ci events',
      adapterType: 'github',
    });
    expect(token).toMatch(/^lr_[0-9a-f]{64}$/);

    const list = await receiversService.listReceivers(projectId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].adapterType).toBe('github');
    expect(list[0].enabled).toBe(true);
    // plaintext token never stored
    expect(JSON.stringify(list[0])).not.toContain(token);
  });

  it('verifies tokens with tokenMatches and rejects wrong tokens', async () => {
    const { id, token } = await receiversService.createReceiver({
      projectId,
      name: 'x',
      adapterType: 'generic',
    });
    const row = await receiversService.getReceiverForIngest(id);
    expect(row).not.toBeNull();
    expect(row!.organizationId).toBe(orgId);
    expect(receiversService.tokenMatches(token, row!.tokenHash)).toBe(true);
    expect(receiversService.tokenMatches('lr_wrong', row!.tokenHash)).toBe(false);
  });

  it('updates and deletes only within the owning project', async () => {
    const { id } = await receiversService.createReceiver({
      projectId,
      name: 'x',
      adapterType: 'generic',
    });
    const other = await createTestContext();

    expect(await receiversService.updateReceiver(id, other.project.id, { enabled: false })).toBe(false);
    expect(await receiversService.updateReceiver(id, projectId, { enabled: false, name: 'y' })).toBe(true);
    const list = await receiversService.listReceivers(projectId);
    expect(list[0].enabled).toBe(false);
    expect(list[0].name).toBe('y');

    expect(await receiversService.deleteReceiver(id, other.project.id)).toBe(false);
    expect(await receiversService.deleteReceiver(id, projectId)).toBe(true);
    expect(await receiversService.listReceivers(projectId)).toHaveLength(0);
  });

  it('counts receivers across the org', async () => {
    await receiversService.createReceiver({ projectId, name: 'a', adapterType: 'generic' });
    await receiversService.createReceiver({ projectId, name: 'b', adapterType: 'github' });
    expect(await receiversService.countReceiversForOrg(orgId)).toBe(2);
  });

  it('records, completes, lists and prunes events', async () => {
    const { id } = await receiversService.createReceiver({
      projectId,
      name: 'x',
      adapterType: 'generic',
    });

    const eventId = await receiversService.recordEvent(id, { hello: 'world' });
    let joined = await receiversService.getEventWithReceiver(eventId);
    expect(joined).not.toBeNull();
    expect(joined!.status).toBe('pending');
    expect(joined!.projectId).toBe(projectId);

    await receiversService.completeEvent(eventId, {
      status: 'processed',
      normalized: [{ time: new Date().toISOString(), service: 's', level: 'info', message: 'm' }],
    });
    joined = await receiversService.getEventWithReceiver(eventId);
    expect(joined!.status).toBe('processed');

    const events = await receiversService.listEvents(id);
    expect(events).toHaveLength(1);
    expect((events[0].rawPayload as any).hello).toBe('world');

    // prune: insert 5 more, keep 3
    for (let i = 0; i < 5; i++) {
      await receiversService.recordEvent(id, { n: i });
    }
    await receiversService.pruneEvents(id, 3);
    expect(await receiversService.listEvents(id)).toHaveLength(3);
  });

  it('touches last_received_at', async () => {
    const { id } = await receiversService.createReceiver({
      projectId,
      name: 'x',
      adapterType: 'generic',
    });
    await receiversService.touchLastReceived(id);
    const list = await receiversService.listReceivers(projectId);
    expect(list[0].lastReceivedAt).not.toBeNull();
  });
});
