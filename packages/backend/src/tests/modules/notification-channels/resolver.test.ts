import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import type { NotificationChannel, NotificationEventType } from '@logtide/shared';
import { createTestContext, createTestOrganization, createTestUser } from '../../helpers/factories.js';

const smtp = vi.hoisted(() => ({ configured: true }));

vi.mock('../../../config/index.js', async (orig) => ({
  ...((await orig()) as object),
  isSmtpConfigured: vi.fn(() => smtp.configured),
}));

import {
  resolveChannelsForEvent,
  resolveFallbackEmails,
  toDeliveryTargets,
  toPreview,
} from '../../../modules/notification-channels/resolver.js';
import { notificationChannelsService } from '../../../modules/notification-channels/service.js';

const ALL_TYPES: NotificationEventType[] = ['alert', 'sigma', 'incident', 'monitoring', 'error'];

const SLACK_URL = 'https://hooks.slack.com/services/T0001/B0002/abcDEF';
const TEAMS_URL = 'https://contoso.webhook.office.com/webhookb2/guid@guid/IncomingWebhook/abc/guid';

async function addChannel(
  organizationId: string,
  name: string,
  opts: { type?: 'email' | 'webhook' | 'pagerduty'; enabled?: boolean; config?: unknown } = {}
) {
  const type = opts.type ?? 'email';
  const config =
    opts.config ??
    (type === 'email'
      ? { recipients: [`${name.toLowerCase()}@example.com`] }
      : type === 'webhook'
        ? { url: `https://example.com/${name}` }
        : { routingKey: 'a'.repeat(32) });
  return db
    .insertInto('notification_channels')
    .values({
      organization_id: organizationId,
      name,
      type,
      enabled: opts.enabled ?? true,
      config: JSON.stringify(config) as any,
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

function asChannel(row: Awaited<ReturnType<typeof addChannel>>): NotificationChannel {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    type: row.type as NotificationChannel['type'],
    enabled: row.enabled,
    config: row.config as any,
    description: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('resolveChannelsForEvent', () => {
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

  it('explicit beats the organization default', async () => {
    const a = await addChannel(orgId, 'A');
    const b = await addChannel(orgId, 'B');
    await setDefault(orgId, a.id, 'incident');

    const res = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'incident',
      explicitChannelIds: [b.id],
    });
    expect(res.source).toBe('explicit');
    expect(res.channels.map((c) => c.id)).toEqual([b.id]);
    expect(res.fallback).toBeNull();
  });

  it('an empty explicit list falls to the default', async () => {
    const a = await addChannel(orgId, 'A');
    await setDefault(orgId, a.id, 'monitoring');
    const byIds = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'monitoring',
      explicitChannelIds: [],
    });
    const byChannels = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'monitoring',
      explicitChannels: [],
    });
    expect(byIds.source).toBe('org_default');
    expect(byChannels.source).toBe('org_default');
    expect(byIds.channels.map((c) => c.id)).toEqual([a.id]);
  });

  it('all explicit channels disabled falls to the default', async () => {
    const off = await addChannel(orgId, 'Off', { enabled: false });
    const def = await addChannel(orgId, 'Def');
    await setDefault(orgId, def.id, 'error');

    const res = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'error',
      explicitChannelIds: [off.id],
    });
    expect(res.source).toBe('org_default');
    expect(res.channels.map((c) => c.id)).toEqual([def.id]);

    const viaObjects = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'error',
      explicitChannels: [asChannel(off)],
    });
    expect(viaObjects.source).toBe('org_default');
  });

  it('uses the default and reports org_default', async () => {
    const a = await addChannel(orgId, 'A');
    await setDefault(orgId, a.id, 'alert');
    const res = await resolveChannelsForEvent({ organizationId: orgId, eventType: 'alert' });
    expect(res).toMatchObject({ source: 'org_default', fallback: null });
    expect(res.channels.map((c) => c.id)).toEqual([a.id]);
  });

  it.each(ALL_TYPES)('nothing configured with SMTP on gives the email fallback (%s)', async (eventType) => {
    const res = await resolveChannelsForEvent({ organizationId: orgId, eventType });
    expect(res).toEqual({ channels: [], source: 'none', fallback: 'owners_admins_email' });
  });

  it('nothing configured with SMTP off gives a null fallback', async () => {
    smtp.configured = false;
    const res = await resolveChannelsForEvent({ organizationId: orgId, eventType: 'alert' });
    expect(res).toEqual({ channels: [], source: 'none', fallback: null });
  });

  it('a Slack-only default gives no email fallback', async () => {
    const slack = await addChannel(orgId, 'Slack', { type: 'webhook', config: { url: SLACK_URL } });
    await setDefault(orgId, slack.id, 'sigma');
    const res = await resolveChannelsForEvent({ organizationId: orgId, eventType: 'sigma' });
    expect(res.fallback).toBeNull();
    expect(res.channels).toHaveLength(1);
  });

  it('a webhook-only explicit channel gives no email fallback', async () => {
    const hook = await addChannel(orgId, 'Hook', { type: 'webhook' });
    const res = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'alert',
      explicitChannelIds: [hook.id],
    });
    expect(res.fallback).toBeNull();
    expect(res.source).toBe('explicit');
  });

  it('drops an explicit channel id of another organization', async () => {
    const otherOwner = await createTestUser({ email: 'owner-b@test.com' });
    const orgB = await createTestOrganization({ ownerId: otherOwner.id });
    const foreign = await addChannel(orgB.id, 'Foreign');

    const res = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'incident',
      explicitChannelIds: [foreign.id],
    });
    expect(res.channels).toEqual([]);
    expect(res.source).toBe('none');
  });

  it('drops explicit channel objects carrying a foreign organizationId', async () => {
    const otherOwner = await createTestUser({ email: 'owner-c@test.com' });
    const orgB = await createTestOrganization({ ownerId: otherOwner.id });
    const foreign = await addChannel(orgB.id, 'Foreign');

    const res = await resolveChannelsForEvent({
      organizationId: orgId,
      eventType: 'incident',
      explicitChannels: [asChannel(foreign)],
    });
    expect(res.channels).toEqual([]);
    expect(res.source).toBe('none');
  });

  it('a deleted default resolves to none', async () => {
    const a = await addChannel(orgId, 'A');
    await setDefault(orgId, a.id, 'incident');
    await db.deleteFrom('notification_channels').where('id', '=', a.id).execute();
    const res = await resolveChannelsForEvent({ organizationId: orgId, eventType: 'incident' });
    expect(res.source).toBe('none');
  });
});

describe('toDeliveryTargets', () => {
  it('dedupes emails case-insensitively and webhooks by url, and splits by kind', () => {
    const mk = (id: string, type: NotificationChannel['type'], config: unknown, name = id): NotificationChannel => ({
      id,
      organizationId: 'o',
      name,
      type,
      enabled: true,
      config: config as any,
      description: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const targets = toDeliveryTargets([
      mk('e1', 'email', { recipients: ['A@x.com', 'b@x.com'] }),
      mk('e2', 'email', { recipients: ['a@x.com'] }),
      mk('w1', 'webhook', { url: SLACK_URL }),
      mk('w2', 'webhook', { url: SLACK_URL }),
      mk('w3', 'webhook', { url: 'https://example.com/generic' }),
      mk('p1', 'pagerduty', { routingKey: 'k'.repeat(32) }),
    ]);
    expect(targets.emailRecipients).toEqual(['A@x.com', 'b@x.com']);
    expect(targets.webhooks.map((w) => [w.channelId, w.displayType])).toEqual([
      ['w1', 'slack'],
      ['w3', 'webhook'],
    ]);
    expect(targets.pagerDuty).toEqual([
      { channelId: 'p1', name: 'p1', routingKey: 'k'.repeat(32) },
    ]);
  });
});

describe('resolveFallbackEmails', () => {
  beforeEach(async () => {
    await db.deleteFrom('organization_default_channels').execute();
    await db.deleteFrom('notification_channels').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();
  });

  it('returns owners and admins only, from this organization only', async () => {
    const owner = await createTestUser({ email: 'owner@x.com' });
    const org = await createTestOrganization({ ownerId: owner.id });
    const admin = await createTestUser({ email: 'admin@x.com' });
    const member = await createTestUser({ email: 'member@x.com' });
    await db
      .insertInto('organization_members')
      .values([
        { user_id: admin.id, organization_id: org.id, role: 'admin' },
        { user_id: member.id, organization_id: org.id, role: 'member' },
      ])
      .execute();

    const otherOwner = await createTestUser({ email: 'other-owner@x.com' });
    await createTestOrganization({ ownerId: otherOwner.id });

    const emails = await resolveFallbackEmails(org.id);
    expect(emails.sort()).toEqual(['admin@x.com', 'owner@x.com']);
  });
});

describe('toPreview', () => {
  it('reports the display type for a Teams webhook', () => {
    const preview = toPreview({
      channels: [
        {
          id: 't1',
          organizationId: 'o',
          name: 'Teams',
          type: 'webhook',
          enabled: true,
          config: { url: TEAMS_URL },
          description: null,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      source: 'org_default',
      fallback: null,
    });
    expect(preview).toEqual({
      destinations: [{ id: 't1', name: 'Teams', type: 'teams' }],
      fallback: null,
    });
  });

  it('is what the service getOrganizationDefaults feeds (smoke)', () => {
    expect(typeof notificationChannelsService.getOrganizationDefaults).toBe('function');
  });
});
