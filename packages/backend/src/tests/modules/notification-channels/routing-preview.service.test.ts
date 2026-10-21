import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import type { NotificationEventType } from '@logtide/shared';
import { createTestContext, createTestOrganization } from '../../helpers/factories.js';

const smtp = vi.hoisted(() => ({ configured: true }));

vi.mock('../../../config/index.js', async (orig) => ({
  ...((await orig()) as object),
  isSmtpConfigured: vi.fn(() => smtp.configured),
}));

import {
  resolveRoutingPreview,
  ROUTING_DISPATCH_GAPS,
} from '../../../modules/notification-channels/routing-preview.service.js';

const ALL_TYPES: NotificationEventType[] = ['alert', 'sigma', 'incident', 'error', 'monitoring'];

async function addChannel(
  organizationId: string,
  name: string,
  opts: { type?: 'email' | 'webhook'; enabled?: boolean } = {}
) {
  const type = opts.type ?? 'email';
  return db
    .insertInto('notification_channels')
    .values({
      organization_id: organizationId,
      name,
      type,
      enabled: opts.enabled ?? true,
      config:
        type === 'email'
          ? { recipients: ['secret@example.com'] }
          : { url: 'https://example.com/secret-hook' },
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function setDefault(organizationId: string, channelId: string, eventType: NotificationEventType) {
  await db
    .insertInto('organization_default_channels')
    .values({ organization_id: organizationId, channel_id: channelId, event_type: eventType })
    .execute();
}

describe('resolveRoutingPreview', () => {
  let orgId: string;

  beforeEach(async () => {
    smtp.configured = true;
    await db.deleteFrom('organization_default_channels').execute();
    await db.deleteFrom('alert_rule_channels').execute();
    await db.deleteFrom('sigma_rule_channels').execute();
    await db.deleteFrom('incident_channels').execute();
    await db.deleteFrom('error_group_channels').execute();
    await db.deleteFrom('notification_channels').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
  });

  it('explicit channelIds win over organization defaults', async () => {
    const a = await addChannel(orgId, 'A');
    const b = await addChannel(orgId, 'B');
    await setDefault(orgId, a.id, 'incident');

    const res = await resolveRoutingPreview({
      organizationId: orgId,
      eventType: 'incident',
      channelIds: [b.id],
    });

    expect(res.destinations.map((d) => d.id)).toEqual([b.id]);
    expect(res.fallback).toBeNull();
  });

  it.each(['incident', 'error', 'monitoring'] as NotificationEventType[])(
    'falls back to organization defaults when channelIds is absent or empty (%s)',
    async (eventType) => {
      const a = await addChannel(orgId, 'A');
      await setDefault(orgId, a.id, eventType);

      const absent = await resolveRoutingPreview({ organizationId: orgId, eventType });
      const empty = await resolveRoutingPreview({ organizationId: orgId, eventType, channelIds: [] });

      expect(absent.destinations.map((d) => d.id)).toEqual([a.id]);
      expect(empty.destinations.map((d) => d.id)).toEqual([a.id]);
    }
  );

  it.each(['alert', 'sigma'] as NotificationEventType[])(
    'alert and sigma also use organization defaults when no explicit channels (%s)',
    async (eventType) => {
      const a = await addChannel(orgId, 'A');
      await setDefault(orgId, a.id, eventType);

      const res = await resolveRoutingPreview({ organizationId: orgId, eventType });
      expect(res.destinations.map((d) => d.id)).toEqual([a.id]);
      expect(res.fallback).toBeNull();
    }
  );

  it('disabled channels are excluded from explicit and default sets', async () => {
    const off = await addChannel(orgId, 'Off', { enabled: false });
    const on = await addChannel(orgId, 'On');
    await setDefault(orgId, off.id, 'incident');

    const explicit = await resolveRoutingPreview({
      organizationId: orgId,
      eventType: 'incident',
      channelIds: [off.id, on.id],
    });
    expect(explicit.destinations.map((d) => d.id)).toEqual([on.id]);

    const defaults = await resolveRoutingPreview({ organizationId: orgId, eventType: 'incident' });
    expect(defaults.destinations).toEqual([]);
  });

  it('channel ids of another organization are dropped silently', async () => {
    const other = await createTestOrganization({ name: 'Other', slug: `other-${Date.now()}` });
    const foreign = await addChannel(other.id, 'Foreign');
    const foreignDefault = await addChannel(other.id, 'ForeignDefault');
    await setDefault(other.id, foreignDefault.id, 'incident');

    const res = await resolveRoutingPreview({
      organizationId: orgId,
      eventType: 'incident',
      channelIds: [foreign.id],
    });

    expect(res.destinations).toEqual([]);
    expect(JSON.stringify(res)).not.toContain('Foreign');
  });

  it('unknown uuids and duplicate ids are ignored and de-duplicated', async () => {
    const a = await addChannel(orgId, 'A');

    const res = await resolveRoutingPreview({
      organizationId: orgId,
      eventType: 'error',
      channelIds: [a.id, a.id, '00000000-0000-4000-8000-000000000000'],
    });

    expect(res.destinations.map((d) => d.id)).toEqual([a.id]);
  });

  it('orders destinations by name', async () => {
    const b = await addChannel(orgId, 'b');
    const a = await addChannel(orgId, 'a');

    const res = await resolveRoutingPreview({
      organizationId: orgId,
      eventType: 'alert',
      channelIds: [b.id, a.id],
    });

    expect(res.destinations.map((d) => d.name)).toEqual(['a', 'b']);
  });

  it.each(ALL_TYPES)('webhook-only routing has no fallback (%s)', async (eventType) => {
    const hook = await addChannel(orgId, 'Hooks', { type: 'webhook' });

    const res = await resolveRoutingPreview({
      organizationId: orgId,
      eventType,
      channelIds: [hook.id],
    });

    expect(res.destinations).toEqual([{ id: hook.id, name: 'Hooks', type: 'webhook' }]);
    expect(res.fallback).toBeNull();
  });

  it.each(ALL_TYPES)(
    'no destinations returns owners_admins_email for every event type (%s)',
    async (eventType) => {
      const res = await resolveRoutingPreview({ organizationId: orgId, eventType });
      expect(res).toEqual({ destinations: [], fallback: 'owners_admins_email' });
    }
  );

  it('no fallback when SMTP is not configured', async () => {
    smtp.configured = false;
    const res = await resolveRoutingPreview({ organizationId: orgId, eventType: 'incident' });
    expect(res).toEqual({ destinations: [], fallback: null });
  });

  it('exposes only id, name and type', async () => {
    const a = await addChannel(orgId, 'A');
    const res = await resolveRoutingPreview({
      organizationId: orgId,
      eventType: 'alert',
      channelIds: [a.id],
    });
    expect(Object.keys(res.destinations[0])).toEqual(['id', 'name', 'type']);
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  it('ROUTING_DISPATCH_GAPS lists the three known gaps', () => {
    expect(ROUTING_DISPATCH_GAPS).toHaveLength(3);
  });
});
