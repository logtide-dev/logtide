import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization, createTestProject } from '../../helpers/factories.js';

const hoisted = vi.hoisted(() => ({
  enqueue: vi.fn(),
  sendMail: vi.fn(),
  smtp: { configured: true },
}));

vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({ id: 'job-id' }), close: vi.fn() })),
  createWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  getConnection: () => null,
}));

vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
  return { ...actual, webhookDispatcher: { enqueue: hoisted.enqueue } };
});

vi.mock('../../../config/index.js', async (orig) => ({
  ...((await orig()) as object),
  isSmtpConfigured: vi.fn(() => hoisted.smtp.configured),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: hoisted.sendMail })) },
}));

vi.mock('../../../modules/notifications/service.js', () => ({
  notificationsService: { createNotification: vi.fn().mockResolvedValue({ id: 'n' }) },
}));

import { processErrorNotification, type ErrorNotificationJobData } from '../../../queue/jobs/error-notification.js';
import type { IJob } from '../../../queue/abstractions/types.js';

async function setup() {
  const owner = await createTestUser({ email: `owner-${Math.random()}@example.com`, name: 'Owner' });
  const org = await createTestOrganization({ ownerId: owner.id, name: 'Routing Org' });
  const project = await createTestProject({ organizationId: org.id, userId: owner.id });
  const group = await db
    .insertInto('error_groups')
    .values({
      organization_id: org.id,
      project_id: project.id,
      fingerprint: `fp-${Math.random()}`,
      exception_type: 'TypeError',
      exception_message: 'boom',
      language: 'nodejs',
      occurrence_count: 1,
      first_seen: new Date(),
      last_seen: new Date(),
      affected_services: ['api'],
    } as never)
    .returning(['id', 'fingerprint'])
    .executeTakeFirstOrThrow();
  return { owner, org, project, group };
}

type Env = Awaited<ReturnType<typeof setup>>;

function buildJob(env: Env, over: Partial<ErrorNotificationJobData> = {}): IJob<ErrorNotificationJobData> {
  return {
    data: {
      exceptionId: `exc-${Math.random()}`,
      organizationId: env.org.id,
      projectId: env.project.id,
      fingerprint: env.group.fingerprint,
      exceptionType: 'TypeError',
      exceptionMessage: 'boom',
      language: 'nodejs',
      service: 'api',
      isNewErrorGroup: false,
      ...over,
    } as ErrorNotificationJobData,
  } as IJob<ErrorNotificationJobData>;
}

async function addDefaultChannel(
  orgId: string,
  type: 'email' | 'webhook' | 'pagerduty',
  config: unknown
) {
  const channel = await db
    .insertInto('notification_channels')
    .values({
      organization_id: orgId,
      name: `${type}-${Math.random()}`,
      type,
      enabled: true,
      config: JSON.stringify(config) as any,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto('organization_default_channels')
    .values({ organization_id: orgId, channel_id: channel.id, event_type: 'error' })
    .execute();
  return channel;
}

describe('error notification: shared channel routing', () => {
  beforeEach(() => {
    hoisted.enqueue.mockReset().mockResolvedValue({ deliveryId: 'd' });
    hoisted.sendMail.mockReset().mockResolvedValue({ messageId: 'm' });
    hoisted.smtp.configured = true;
  });

  it('uses the organization default channels for errors', async () => {
    const env = await setup();
    await addDefaultChannel(env.org.id, 'webhook', { url: 'https://hooks.example.com/default' });
    await addDefaultChannel(env.org.id, 'email', { recipients: ['oncall@example.com'] });

    await processErrorNotification(buildJob(env));

    expect(hoisted.enqueue).toHaveBeenCalledTimes(1);
    expect(hoisted.enqueue.mock.calls[0][0].url).toBe('https://hooks.example.com/default');
    // the default email channel replaces the owners and admins fallback
    expect(hoisted.sendMail.mock.calls.map((c) => c[0].to)).toEqual(['oncall@example.com']);
  });

  it('sends PagerDuty targets through the dispatcher', async () => {
    const env = await setup();
    await addDefaultChannel(env.org.id, 'pagerduty', { routingKey: 'a'.repeat(32) });

    await processErrorNotification(buildJob(env, { isRegression: true }));

    const pd = hoisted.enqueue.mock.calls.map((c) => c[0]).filter((c) => c.url.includes('pagerduty'));
    expect(pd).toHaveLength(1);
    expect(pd[0].eventType).toBe('error.detected');
    expect(pd[0].payload.dedup_key).toBe(`error:${env.group.id}`);
    // no email destination resolved, so nothing falls back to owners
    expect(hoisted.sendMail).not.toHaveBeenCalled();
  });

  it('falls back to owners and admins only when no channel resolves', async () => {
    const env = await setup();
    const admin = await createTestUser({ email: `admin-${Math.random()}@example.com`, name: 'Admin' });
    const member = await createTestUser({ email: `member-${Math.random()}@example.com`, name: 'Member' });
    await db
      .insertInto('organization_members')
      .values([
        { user_id: admin.id, organization_id: env.org.id, role: 'admin' },
        { user_id: member.id, organization_id: env.org.id, role: 'member' },
      ] as never)
      .execute();

    await processErrorNotification(buildJob(env));

    const recipients = hoisted.sendMail.mock.calls.map((c) => c[0].to).sort();
    expect(recipients).toEqual([admin.email, env.owner.email].sort());
    expect(recipients).not.toContain(member.email);
    expect(hoisted.enqueue).not.toHaveBeenCalled();
  });

  it('sends nothing by email when SMTP is not configured and nothing resolves', async () => {
    hoisted.smtp.configured = false;
    const env = await setup();

    await processErrorNotification(buildJob(env));

    expect(hoisted.sendMail).not.toHaveBeenCalled();
  });
});
