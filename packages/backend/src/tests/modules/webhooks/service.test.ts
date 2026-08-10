import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestOrganization } from '../../helpers/factories.js';
import { webhookDeliveryService, redactDeliveryForApi } from '../../../modules/webhooks/service.js';

describe('redactDeliveryForApi', () => {
  it('strips signingSecret and headers from metadata, keeps the rest', () => {
    const row = {
      id: 'd', metadata: { payload: { a: 1 }, signingSecret: 'whsec_x', headers: { Authorization: 'Bearer z' }, ruleName: 'r' },
    } as any;
    const redacted = redactDeliveryForApi(row);
    expect(redacted.metadata).toEqual({ payload: { a: 1 }, ruleName: 'r' });
    expect(redacted.metadata).not.toHaveProperty('signingSecret');
    expect(redacted.metadata).not.toHaveProperty('headers');
  });

  it('passes through undefined and null metadata safely', () => {
    expect(redactDeliveryForApi(undefined)).toBeUndefined();
    expect(redactDeliveryForApi({ id: 'd', metadata: null } as any).metadata).toBeNull();
  });
});

describe('webhookDeliveryService', () => {
  let orgId: string;
  beforeEach(async () => {
    const org = await createTestOrganization({});
    orgId = org.id;
  });

  it('creates a pending delivery', async () => {
    const d = await webhookDeliveryService.createDelivery({
      organizationId: orgId,
      eventType: 'alert',
      eventId: 'evt-1',
      url: 'https://e.com/hook',
      maxAttempts: 5,
      metadata: { foo: 'bar' },
    });
    expect(d.status).toBe('pending');
    expect(d.attempt_count).toBe(0);
  });

  it('records attempts and prunes beyond the log limit', async () => {
    const d = await webhookDeliveryService.createDelivery({
      organizationId: orgId, eventType: 'alert', eventId: 'evt-2', url: 'https://e.com/hook', maxAttempts: 5,
    });
    for (let i = 1; i <= 5; i++) {
      await webhookDeliveryService.recordAttempt(d.id, {
        attemptNumber: i, statusCode: 500, durationMs: 10, error: 'boom', responseExcerpt: 'x',
      }, 3); // keep last 3
    }
    const attempts = await db.selectFrom('webhook_delivery_attempts')
      .selectAll().where('delivery_id', '=', d.id).execute();
    expect(attempts.length).toBe(3);
  });

  it('transitions status and lists by status', async () => {
    const d = await webhookDeliveryService.createDelivery({
      organizationId: orgId, eventType: 'alert', eventId: 'evt-3', url: 'https://e.com', maxAttempts: 5,
    });
    await webhookDeliveryService.markDead(d.id, 3, 'gave up');
    const dead = await webhookDeliveryService.listDeliveries(orgId, { status: 'dead', limit: 50, offset: 0 });
    expect(dead.map((x) => x.id)).toContain(d.id);
  });

  it('replays a dead delivery back to pending', async () => {
    const d = await webhookDeliveryService.createDelivery({
      organizationId: orgId, eventType: 'alert', eventId: 'evt-4', url: 'https://e.com', maxAttempts: 5,
    });
    await webhookDeliveryService.markDead(d.id, 3, 'gave up');
    const reset = await webhookDeliveryService.resetForReplay(d.id);
    expect(reset?.status).toBe('pending');
    expect(reset?.attempt_count).toBe(0);
  });

  describe('findInFlightDelivery', () => {
    const lookup = (orgIdArg: string, eventId: string, windowMs = 60000) =>
      webhookDeliveryService.findInFlightDelivery({
        organizationId: orgIdArg,
        eventType: 'monitor.status_changed',
        eventId,
        since: new Date(Date.now() - windowMs),
      });

    const create = (orgIdArg: string, eventId: string) =>
      webhookDeliveryService.createDelivery({
        organizationId: orgIdArg,
        eventType: 'monitor.status_changed',
        eventId,
        url: 'https://e.com/hook',
        maxAttempts: 5,
      });

    it('matches a pending delivery inside the window', async () => {
      const d = await create(orgId, 'mon-1:down');
      expect((await lookup(orgId, 'mon-1:down'))?.id).toBe(d.id);
    });

    it('matches a delivery that is retrying', async () => {
      const d = await create(orgId, 'mon-2:down');
      await webhookDeliveryService.markRetrying(d.id, 1, new Date(Date.now() + 5000), 'HTTP 500');
      expect((await lookup(orgId, 'mon-2:down'))?.id).toBe(d.id);
    });

    it('ignores terminal deliveries so a repeated event is not suppressed', async () => {
      const dead = await create(orgId, 'mon-3:down');
      await webhookDeliveryService.markDead(dead.id, 5, 'gave up');
      expect(await lookup(orgId, 'mon-3:down')).toBeUndefined();

      const delivered = await create(orgId, 'mon-4:down');
      await webhookDeliveryService.markDelivered(delivered.id);
      expect(await lookup(orgId, 'mon-4:down')).toBeUndefined();
    });

    it('ignores deliveries older than the window, so stuck rows cannot suppress new events', async () => {
      const d = await create(orgId, 'mon-5:down');
      // Age the row explicitly rather than shrinking the window: created_at comes
      // from the database clock and the window from the node clock, so a
      // zero-length window is a race under load.
      await db
        .updateTable('webhook_deliveries')
        .set({ created_at: new Date(Date.now() - 10 * 60 * 1000) })
        .where('id', '=', d.id)
        .execute();
      expect(await lookup(orgId, 'mon-5:down')).toBeUndefined();
    });

    it('is scoped to the organization', async () => {
      const other = await createTestOrganization({});
      await create(orgId, 'mon-6:down');
      expect(await lookup(other.id, 'mon-6:down')).toBeUndefined();
    });

    it('does not match a different event id', async () => {
      await create(orgId, 'mon-7:down');
      expect(await lookup(orgId, 'mon-7:up')).toBeUndefined();
    });
  });
});
