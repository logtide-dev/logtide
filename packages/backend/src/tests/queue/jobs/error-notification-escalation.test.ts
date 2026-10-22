import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization, createTestProject } from '../../helpers/factories.js';

vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-id' }),
    close: vi.fn(),
  })),
  createWorker: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  getConnection: () => null,
}));

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));
vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
  return {
    ...actual,
    webhookDispatcher: { enqueue: enqueueMock },
  };
});

vi.mock('../../../config/index.js', () => ({
  config: {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_USER: 'test@example.com',
    SMTP_PASS: 'password',
    SMTP_FROM: 'noreply@test.com',
    REDIS_URL: 'redis://localhost:6379',
    FRONTEND_URL: 'https://app.logtide.dev',
    NODE_ENV: 'test',
    ERROR_NOTIFICATION_COOLDOWN_MINUTES: 15,
  },
  isSmtpConfigured: vi.fn(() => true),
}));

const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }) }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

vi.mock('../../../modules/notifications/service.js', () => ({
  notificationsService: {
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-id' }),
  },
}));

const mockGetErrorGroupChannels = vi.fn().mockResolvedValue([]);
const mockGetOrganizationDefaults = vi.fn().mockResolvedValue([]);
vi.mock('../../../modules/notification-channels/index.js', () => ({
  notificationChannelsService: {
    getErrorGroupChannels: (...args: unknown[]) => mockGetErrorGroupChannels(...args),
    getOrganizationDefaults: (...args: unknown[]) => mockGetOrganizationDefaults(...args),
  },
}));

import {
  processErrorNotification,
  resolveErrorChannels,
  type ErrorNotificationJobData,
} from '../../../queue/jobs/error-notification.js';
import { notificationsService } from '../../../modules/notifications/service.js';
import type { Job } from 'bullmq';

type Env = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const owner = await createTestUser({ name: 'Owner User' });
  const org = await createTestOrganization({ ownerId: owner.id, name: 'Escalation Org' });
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

function buildJob(env: Env, over: Partial<ErrorNotificationJobData> = {}): Job<ErrorNotificationJobData> {
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
  } as Job<ErrorNotificationJobData>;
}

function webhookChannelFor(organizationId: string) {
  return {
    id: '00000000-0000-0000-0000-000000000099',
    organizationId,
    type: 'webhook',
    enabled: true,
    config: { url: 'https://hooks.example.com/errors' },
  };
}

async function stampNotified(env: Env) {
  await db
    .updateTable('error_groups')
    .set({ last_notified_at: new Date() })
    .where('id', '=', env.group.id)
    .execute();
}

describe('error notification: escalation and cooldown bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    mockSendMail.mockReset().mockResolvedValue({ messageId: 'test-id' });
    mockGetErrorGroupChannels.mockReset().mockResolvedValue([]);
    mockGetOrganizationDefaults.mockReset().mockResolvedValue([]);
  });

  it('escalating title, subject and webhook flag', async () => {
    const env = await setup();
    mockGetErrorGroupChannels.mockResolvedValue([webhookChannelFor(env.org.id)]);

    await processErrorNotification(buildJob(env, { isEscalating: true }));

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const envelope = enqueueMock.mock.calls[0][0].payload;
    expect(envelope.data.is_escalating).toBe(true);
    expect(envelope.data.is_regression).toBe(false);
    expect(envelope.data.title.startsWith('Escalating:')).toBe(true);
    expect(envelope.data.severity).toBe('high');

    const inApp = vi.mocked(notificationsService.createNotification).mock.calls[0][0];
    expect(inApp.title).toBe('Escalating: TypeError');
    expect((inApp.metadata as Record<string, unknown>).isEscalating).toBe(true);
  });

  it('a plain error keeps is_escalating false', async () => {
    const env = await setup();
    mockGetErrorGroupChannels.mockResolvedValue([webhookChannelFor(env.org.id)]);

    await processErrorNotification(buildJob(env));

    const envelope = enqueueMock.mock.calls[0][0].payload;
    expect(envelope.data.is_escalating).toBe(false);
    expect(envelope.data.title).toBe('Error: TypeError');
  });

  it('emails owners and admins with the escalating subject when nothing resolves', async () => {
    const env = await setup();

    await processErrorNotification(buildJob(env, { isEscalating: true }));

    expect(mockSendMail.mock.calls[0][0].subject).toBe('[Escalating] TypeError in api');
    expect(mockSendMail.mock.calls[0][0].html).toContain('escalating');
  });

  it('regression inside the cooldown window still notifies', async () => {
    const env = await setup();
    await stampNotified(env);

    await processErrorNotification(buildJob(env, { isRegression: true }));

    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].subject).toBe('[Regression] TypeError in api');
  });

  it('escalation inside the cooldown window still notifies', async () => {
    const env = await setup();
    await stampNotified(env);

    await processErrorNotification(buildJob(env, { isEscalating: true }));

    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
  });

  it('a regression restamps last_notified_at', async () => {
    const env = await setup();
    const old = new Date(Date.now() - 60_000);
    await db.updateTable('error_groups').set({ last_notified_at: old }).where('id', '=', env.group.id).execute();

    await processErrorNotification(buildJob(env, { isRegression: true }));

    const row = await db
      .selectFrom('error_groups')
      .select('last_notified_at')
      .where('id', '=', env.group.id)
      .executeTakeFirstOrThrow();
    expect(new Date(row.last_notified_at as never).getTime()).toBeGreaterThan(old.getTime());
  });

  it('a plain repeat inside the cooldown is still throttled', async () => {
    const env = await setup();
    await stampNotified(env);

    await processErrorNotification(buildJob(env));

    expect(notificationsService.createNotification).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('an ignored group still skips notification', async () => {
    const env = await setup();
    await db.updateTable('error_groups').set({ status: 'ignored' }).where('id', '=', env.group.id).execute();

    await processErrorNotification(buildJob(env));
    expect(notificationsService.createNotification).not.toHaveBeenCalled();

    // even a regression flag does not notify while the group is ignored
    await processErrorNotification(buildJob(env, { isRegression: true }));
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('falls back to emailing owners and admins when no channel resolves', async () => {
    const env = await setup();
    const member = await createTestUser({ email: `member-${Math.random()}@example.com`, name: 'Plain Member' });
    await db
      .insertInto('organization_members')
      .values({ user_id: member.id, organization_id: env.org.id, role: 'member' } as never)
      .execute();

    await processErrorNotification(buildJob(env, { isEscalating: true }));

    const recipients = mockSendMail.mock.calls.map((c) => c[0].to);
    expect(recipients).toEqual([env.owner.email]);
  });

  describe('resolveErrorChannels', () => {
    const ORG_A = '00000000-0000-0000-0000-0000000000a1';
    const ORG_B = '00000000-0000-0000-0000-0000000000b2';

    it('returns the group channels as the explicit source', async () => {
      const groupChannels = [webhookChannelFor(ORG_A)];
      mockGetErrorGroupChannels.mockResolvedValue(groupChannels);

      const result = await resolveErrorChannels('group-1', ORG_A);

      expect(mockGetErrorGroupChannels).toHaveBeenCalledWith('group-1');
      expect(result.source).toBe('explicit');
      expect(result.channels).toEqual(groupChannels);
      expect(result.fallback).toBeNull();
    });

    it('ignores group channels of another organization', async () => {
      mockGetErrorGroupChannels.mockResolvedValue([webhookChannelFor(ORG_B)]);

      const result = await resolveErrorChannels('group-1', ORG_A);

      expect(result.source).not.toBe('explicit');
      expect(result.channels).toEqual([]);
    });
  });
});
