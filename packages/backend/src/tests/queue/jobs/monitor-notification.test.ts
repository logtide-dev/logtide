import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';
import { parseWebhookEvent } from '@logtide/shared';

// Mock queue connection before any import that needs it
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

// Mock config
vi.mock('../../../config/index.js', () => ({
  config: {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_USER: 'test@example.com',
    SMTP_PASS: 'password',
    SMTP_FROM: 'noreply@test.com',
    REDIS_URL: 'redis://localhost:6380',
    FRONTEND_URL: 'https://app.logtide.dev',
    NODE_ENV: 'test',
  },
  isSmtpConfigured: vi.fn(() => false),
}));
import { isSmtpConfigured } from '../../../config/index.js';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
    })),
  },
}));

// Mock notifications service
const { createNotificationMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
}));
vi.mock('../../../modules/notifications/service.js', () => ({
  notificationsService: {
    createNotification: createNotificationMock,
  },
}));

// Mock notification channels service
const mockGetMonitorChannels = vi.fn().mockResolvedValue([]);
vi.mock('../../../modules/notification-channels/index.js', () => ({
  notificationChannelsService: {
    getMonitorChannels: (...args: unknown[]) => mockGetMonitorChannels(...args),
    getOrganizationDefaults: vi.fn().mockResolvedValue([]),
  },
}));

// Mock webhookDispatcher; buildEnvelope is kept real so envelope shape is testable.
const { monitorEnqueueMock } = vi.hoisted(() => ({ monitorEnqueueMock: vi.fn() }));
vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
  return {
    ...actual,
    webhookDispatcher: { enqueue: monitorEnqueueMock },
  };
});

import { processMonitorNotification, type MonitorNotificationJob } from '../../../queue/jobs/monitor-notification.js';
import type { Job } from 'bullmq';

describe('Monitor webhook envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockReset().mockResolvedValue({ id: 'notification-id' });
    monitorEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    mockGetMonitorChannels.mockReset().mockResolvedValue([]);
  });

  it('enqueues a monitor.status_changed envelope', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org' });

    mockGetMonitorChannels.mockResolvedValueOnce([{
      organizationId: org.id,
      id: '00000000-0000-0000-0000-000000000040',
      type: 'webhook',
      enabled: true,
      config: { url: 'https://hooks.example.com/monitor' },
    }]);

    const job = {
      data: {
        monitorId: 'mon-001',
        monitorName: 'API Health',
        organizationId: org.id,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'down',
        severity: 'high',
        target: 'https://api.example.com/health',
        errorCode: 'ECONNREFUSED',
        responseTimeMs: null,
        consecutiveFailures: 3,
        downtimeDuration: null,
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>;

    await processMonitorNotification(job);

    expect(monitorEnqueueMock).toHaveBeenCalledTimes(1);
    const call = monitorEnqueueMock.mock.calls[0][0];
    expect(call.eventType).toBe('monitor.status_changed');
    const envelope = parseWebhookEvent(call.payload);
    expect(envelope.type).toBe('monitor.status_changed');
    expect(envelope.organizationId).toBe(org.id);
    const d = envelope.data as Record<string, unknown>;
    expect(d).not.toHaveProperty('event_type');
    expect(d).not.toHaveProperty('timestamp');
    // organization object stays in data
    expect(d.organization).toBeTruthy();
    expect((d.organization as Record<string, unknown>).id).toBe(org.id);
    expect(d.monitor_id).toBe('mon-001');
    expect(d.monitor_name).toBe('API Health');
    expect(d.status).toBe('down');
  });

  it('never logs the full webhook URL', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner Log' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org Log' });
    const secretUrl = 'https://hooks.slack.com/services/T000/B000/s3cr3t-token';
    mockGetMonitorChannels.mockResolvedValueOnce([{
      organizationId: org.id,
      id: '00000000-0000-0000-0000-000000000043',
      type: 'webhook',
      enabled: true,
      config: { url: secretUrl },
    }]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await processMonitorNotification({
      data: {
        monitorId: 'mon-log',
        monitorName: 'Log Check',
        organizationId: org.id,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'down',
        severity: 'high',
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>);

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join('\n');
    logSpy.mockRestore();
    errSpy.mockRestore();
    expect(logged).toContain('hooks.slack.com');
    expect(logged).not.toContain('s3cr3t-token');
  });

  it('uses type monitor.status_changed for both down and up events', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner 2' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org 2' });

    mockGetMonitorChannels.mockResolvedValue([{
      organizationId: org.id,
      id: '00000000-0000-0000-0000-000000000041',
      type: 'webhook',
      enabled: true,
      config: { url: 'https://hooks.example.com/monitor2' },
    }]);

    const downJob = {
      data: {
        monitorId: 'mon-002',
        monitorName: 'DB Check',
        organizationId: org.id,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'up',
        severity: 'informational',
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>;

    await processMonitorNotification(downJob);

    const call = monitorEnqueueMock.mock.calls[0][0];
    expect(call.eventType).toBe('monitor.status_changed');
    const envelope = parseWebhookEvent(call.payload);
    expect(envelope.type).toBe('monitor.status_changed');
  });

  it('falls back to /dashboard/uptime/<monitorId> without an incident', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner 3' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org 3' });

    mockGetMonitorChannels.mockResolvedValueOnce([{
      organizationId: org.id,
      id: '00000000-0000-0000-0000-000000000042',
      type: 'webhook',
      enabled: true,
      config: { url: 'https://hooks.example.com/monitor3' },
    }]);

    const job = {
      data: {
        monitorId: 'mon-003',
        monitorName: 'Link Check',
        organizationId: org.id,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'down',
        severity: 'high',
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>;

    await processMonitorNotification(job);

    expect(createNotificationMock).toHaveBeenCalled();
    const notif = createNotificationMock.mock.calls[0][0];
    expect(notif.metadata.link).toBe('/dashboard/uptime/mon-003');

    const envelope = parseWebhookEvent(monitorEnqueueMock.mock.calls[0][0].payload);
    const link = (envelope.data as Record<string, unknown>).link as string;
    expect(link.endsWith('/dashboard/uptime/mon-003')).toBe(true);
    expect((envelope.data as Record<string, unknown>).incident_id ?? null).toBeNull();
  });

  it('webhook envelope carries incident_id and a /dashboard/incidents/<id> link', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner 4' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org 4' });

    mockGetMonitorChannels.mockResolvedValueOnce([{
      organizationId: org.id,
      id: '00000000-0000-0000-0000-000000000043',
      type: 'webhook',
      enabled: true,
      config: { url: 'https://hooks.example.com/monitor4' },
    }]);

    const incidentId = '11111111-1111-4111-8111-111111111111';
    const job = {
      data: {
        monitorId: 'mon-004',
        monitorName: 'Incident Link',
        organizationId: org.id,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'down',
        severity: 'high',
        incidentId,
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>;

    await processMonitorNotification(job);

    const envelope = parseWebhookEvent(monitorEnqueueMock.mock.calls[0][0].payload);
    const d = envelope.data as Record<string, unknown>;
    expect(d.incident_id).toBe(incidentId);
    expect((d.link as string).endsWith(`/dashboard/incidents/${incidentId}`)).toBe(true);
  });

  it('in-app notification metadata link follows the same rule', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner 5' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org 5' });
    const incidentId = '22222222-2222-4222-8222-222222222222';

    await processMonitorNotification({
      data: {
        monitorId: 'mon-005',
        monitorName: 'In-app Link',
        organizationId: org.id,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'down',
        severity: 'high',
        incidentId,
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>);

    expect(createNotificationMock).toHaveBeenCalled();
    const notif = createNotificationMock.mock.calls[0][0];
    expect(notif.metadata.link).toBe(`/dashboard/incidents/${incidentId}`);
    expect(notif.metadata.incidentId).toBe(incidentId);
  });

  it('recovery notifications link to the incident too', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner 6' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org 6' });
    const incidentId = '33333333-3333-4333-8333-333333333333';

    await processMonitorNotification({
      data: {
        monitorId: 'mon-006',
        monitorName: 'Recovered Link',
        organizationId: org.id,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'up',
        severity: 'high',
        incidentId,
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>);

    expect(createNotificationMock.mock.calls[0][0].metadata.link).toBe(`/dashboard/incidents/${incidentId}`);
  });
});

describe('Monitor notification routing', () => {
  const PD_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const MONITOR_ID = '00000000-0000-0000-0000-0000000000b1';

  beforeEach(async () => {
    vi.clearAllMocks();
    monitorEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    sendMailMock.mockReset().mockResolvedValue({ messageId: 'test-id' });
    createNotificationMock.mockReset().mockResolvedValue({ id: 'notification-id' });
    vi.mocked(isSmtpConfigured).mockReturnValue(false);
    mockGetMonitorChannels.mockReset().mockResolvedValue([]);
    await db.deleteFrom('organization_default_channels').execute();
  });

  function jobFor(orgId: string, overrides: Partial<MonitorNotificationJob> = {}) {
    return {
      data: {
        monitorId: MONITOR_ID,
        monitorName: 'Routing Check',
        organizationId: orgId,
        projectId: '00000000-0000-0000-0000-000000000000',
        status: 'down',
        severity: 'high',
        ...overrides,
      } as MonitorNotificationJob,
    } as Job<MonitorNotificationJob>;
  }

  function channel(orgId: string, type: 'email' | 'webhook' | 'pagerduty', config: unknown, id: string) {
    return { id, organizationId: orgId, name: id, type, enabled: true, config };
  }

  it('uses the organization default channels for monitoring when the monitor has none', async () => {
    vi.mocked(isSmtpConfigured).mockReturnValue(true);
    const owner = await createTestUser({ name: 'Default Owner' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Default Org' });
    const ch = await db
      .insertInto('notification_channels')
      .values({
        organization_id: org.id,
        name: 'Ops mail',
        type: 'email',
        enabled: true,
        config: { recipients: ['ops@example.com'] },
        description: null,
        created_by: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('organization_default_channels')
      .values({ organization_id: org.id, event_type: 'monitoring', channel_id: ch.id })
      .execute();

    await processMonitorNotification(jobFor(org.id));

    expect(sendMailMock.mock.calls.map((c) => c[0].to)).toEqual(['ops@example.com']);
  });

  it('sends a PagerDuty trigger on down with the monitor dedup key', async () => {
    const owner = await createTestUser({ name: 'PD Owner' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'PD Org' });
    mockGetMonitorChannels.mockResolvedValueOnce([
      channel(org.id, 'pagerduty', { routingKey: PD_KEY }, '00000000-0000-0000-0000-0000000000aa'),
    ]);

    await processMonitorNotification(jobFor(org.id));

    expect(monitorEnqueueMock).toHaveBeenCalledTimes(1);
    const call = monitorEnqueueMock.mock.calls[0][0];
    expect(call.url).toBe('https://events.pagerduty.com/v2/enqueue');
    expect(call.payload.event_action).toBe('trigger');
    expect(call.payload.dedup_key).toBe(`monitor:${MONITOR_ID}`);
    expect(call.payload.routing_key).toBe(PD_KEY);
  });

  it('sends a PagerDuty resolve on recovery with the same dedup key', async () => {
    const owner = await createTestUser({ name: 'PD Owner 2' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'PD Org 2' });
    mockGetMonitorChannels.mockResolvedValueOnce([
      channel(org.id, 'pagerduty', { routingKey: PD_KEY }, '00000000-0000-0000-0000-0000000000ab'),
    ]);

    await processMonitorNotification(jobFor(org.id, { status: 'up', severity: 'informational' }));

    const call = monitorEnqueueMock.mock.calls[0][0];
    expect(call.payload.event_action).toBe('resolve');
    expect(call.payload.dedup_key).toBe(`monitor:${MONITOR_ID}`);
  });

  it('nothing resolved with SMTP on emails owners and admins only, never plain members', async () => {
    vi.mocked(isSmtpConfigured).mockReturnValue(true);
    const owner = await createTestUser({ email: 'mon-owner@test.com', name: 'Owner User' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Fallback Org' });
    const admin = await createTestUser({ email: 'mon-admin@test.com', name: 'Admin User' });
    const member = await createTestUser({ email: 'mon-member@test.com', name: 'Member User' });
    await db
      .insertInto('organization_members')
      .values([
        { user_id: admin.id, organization_id: org.id, role: 'admin' },
        { user_id: member.id, organization_id: org.id, role: 'member' },
      ])
      .execute();

    await processMonitorNotification(jobFor(org.id, { severity: 'critical' }));

    expect(sendMailMock.mock.calls.map((c) => c[0].to).sort()).toEqual([
      'mon-admin@test.com',
      'mon-owner@test.com',
    ]);
  });

  it('a webhook-only routing sends no email even with SMTP configured', async () => {
    vi.mocked(isSmtpConfigured).mockReturnValue(true);
    const owner = await createTestUser({ name: 'Hook Owner' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Hook Org' });
    mockGetMonitorChannels.mockResolvedValueOnce([
      channel(org.id, 'webhook', { url: 'https://hooks.example.com/m' }, '00000000-0000-0000-0000-0000000000ac'),
    ]);

    await processMonitorNotification(jobFor(org.id));

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(monitorEnqueueMock).toHaveBeenCalledTimes(1);
  });
});
