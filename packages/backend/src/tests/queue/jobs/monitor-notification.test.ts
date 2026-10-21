import { describe, it, expect, beforeEach, vi } from 'vitest';
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

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
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

  it('uses type monitor.status_changed for both down and up events', async () => {
    const owner = await createTestUser({ name: 'Monitor Owner 2' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Monitor Org 2' });

    mockGetMonitorChannels.mockResolvedValue([{
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
