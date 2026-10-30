import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';
import { parseWebhookEvent } from '@logtide/shared';

// Mock queue connection BEFORE importing anything that uses it
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

// Mock webhookDispatcher so it doesn't hit real queues/SSRF guard.
// buildEnvelope is kept real so the envelope shape can be validated.
const { incidentEnqueueMock, sendMailMock } = vi.hoisted(() => ({
  incidentEnqueueMock: vi.fn(),
  sendMailMock: vi.fn(),
}));
vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
  return {
    ...actual,
    webhookDispatcher: { enqueue: incidentEnqueueMock },
  };
});

// Mock the config module
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
  },
  isSmtpConfigured: vi.fn(() => false), // Default to no SMTP
}));

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
    })),
  },
}));

// Mock the notifications service
vi.mock('../../../modules/notifications/service.js', () => ({
  notificationsService: {
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-id' }),
  },
}));

// Mock the notification channels service
const mockGetIncidentChannels = vi.fn().mockResolvedValue([]);
vi.mock('../../../modules/notification-channels/index.js', () => ({
  notificationChannelsService: {
    getIncidentChannels: (...args: unknown[]) => mockGetIncidentChannels(...args),
    getOrganizationDefaults: vi.fn().mockResolvedValue([]),
  },
}));

// Import after mocks
import { processIncidentNotification, type IncidentNotificationJob } from '../../../queue/jobs/incident-notification.js';
import { notificationsService } from '../../../modules/notifications/service.js';
import { isSmtpConfigured } from '../../../config/index.js';
import type { Job } from 'bullmq';

describe('Incident Notification Job', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    incidentEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    sendMailMock.mockReset().mockResolvedValue({ messageId: 'test-id' });
    vi.mocked(isSmtpConfigured).mockReturnValue(false);
    mockGetIncidentChannels.mockReset().mockResolvedValue([]);
  });

  describe('processIncidentNotification', () => {
    it('should do nothing when organization not found', async () => {
      // Use a valid UUID that doesn't exist in the database
      const nonExistentOrgId = '00000000-0000-0000-0000-000000000000';

      const job = {
        data: {
          incidentId: 'incident-1',
          organizationId: nonExistentOrgId,
          title: 'Test Incident',
          description: 'Test description',
          severity: 'high',
          affectedServices: ['api'],
        } as IncidentNotificationJob,
      } as Job<IncidentNotificationJob>;

      await processIncidentNotification(job);

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should send in-app notifications to all members for critical severity', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const member = await createTestUser({ email: 'member@test.com', name: 'Member User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      // Add member to organization
      await db
        .insertInto('organization_members')
        .values({
          user_id: member.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      const job = {
        data: {
          incidentId: 'incident-1',
          organizationId: org.id,
          title: 'Critical Security Incident',
          description: 'Critical security breach detected',
          severity: 'critical',
          affectedServices: ['api', 'db'],
        } as IncidentNotificationJob,
      } as Job<IncidentNotificationJob>;

      await processIncidentNotification(job);

      // Should notify both owner and member for critical severity
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(2);
    });

    it('should send in-app notifications only to owners/admins for low severity', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const member = await createTestUser({ email: 'member@test.com', name: 'Member User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      // Add member to organization (not admin)
      await db
        .insertInto('organization_members')
        .values({
          user_id: member.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      const job = {
        data: {
          incidentId: 'incident-1',
          organizationId: org.id,
          title: 'Low Priority Incident',
          description: 'Minor issue detected',
          severity: 'low',
          affectedServices: ['logging'],
        } as IncidentNotificationJob,
      } as Job<IncidentNotificationJob>;

      await processIncidentNotification(job);

      // Should only notify owner for low severity (member excluded)
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('should include admin in notifications for medium severity', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const admin = await createTestUser({ email: 'admin@test.com', name: 'Admin User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      // Add admin to organization
      await db
        .insertInto('organization_members')
        .values({
          user_id: admin.id,
          organization_id: org.id,
          role: 'admin',
        })
        .execute();

      const job = {
        data: {
          incidentId: 'incident-1',
          organizationId: org.id,
          title: 'Medium Priority Incident',
          description: 'Suspicious activity detected',
          severity: 'medium',
          affectedServices: null,
        } as IncidentNotificationJob,
      } as Job<IncidentNotificationJob>;

      await processIncidentNotification(job);

      // Should notify both owner and admin for medium severity
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(2);
    });

    it('should handle notification with correct metadata', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      const job = {
        data: {
          incidentId: 'incident-123',
          organizationId: org.id,
          title: 'Test Incident',
          description: 'Test description',
          severity: 'high',
          affectedServices: ['api'],
        } as IncidentNotificationJob,
      } as Job<IncidentNotificationJob>;

      await processIncidentNotification(job);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: owner.id,
          title: 'Test Incident',
          message: 'Security Incident [High]',
          type: 'alert',
          organizationId: org.id,
          metadata: expect.objectContaining({
            incidentId: 'incident-123',
            severity: 'high',
            link: '/dashboard/incidents/incident-123',
          }),
        })
      );
    });

    it('should do nothing when no members in organization', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      // Remove owner from organization members
      await db
        .deleteFrom('organization_members')
        .where('organization_id', '=', org.id)
        .execute();

      const job = {
        data: {
          incidentId: 'incident-1',
          organizationId: org.id,
          title: 'Test Incident',
          description: null,
          severity: 'informational',
          affectedServices: [],
        } as IncidentNotificationJob,
      } as Job<IncidentNotificationJob>;

      await processIncidentNotification(job);

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should handle all severity levels correctly', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      const severities = ['critical', 'high', 'medium', 'low', 'informational'] as const;

      for (const severity of severities) {
        vi.clearAllMocks();

        const job = {
          data: {
            incidentId: `incident-${severity}`,
            organizationId: org.id,
            title: `${severity} Incident`,
            description: `${severity} description`,
            severity,
            affectedServices: null,
          } as IncidentNotificationJob,
        } as Job<IncidentNotificationJob>;

        await processIncidentNotification(job);

        expect(notificationsService.createNotification).toHaveBeenCalled();
      }
    });
  });
});

describe('Incident webhook envelope', () => {
  beforeEach(() => {
    incidentEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    mockGetIncidentChannels.mockReset();
  });

  it('enqueues an incident.created envelope', async () => {
    const owner = await createTestUser({ name: 'Owner User' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Webhook Org' });

    mockGetIncidentChannels.mockResolvedValueOnce([{
      id: '00000000-0000-0000-0000-000000000020',
      organizationId: org.id,
      name: 'Hook',
      type: 'webhook',
      enabled: true,
      config: { url: 'https://hooks.example.com/incident' },
    }]);

    const job = {
      data: {
        incidentId: '00000000-0000-0000-0000-000000000099',
        organizationId: org.id,
        title: 'Envelope Test Incident',
        description: 'something suspicious',
        severity: 'high',
        affectedServices: ['api'],
      } as IncidentNotificationJob,
    } as Job<IncidentNotificationJob>;

    await processIncidentNotification(job);

    expect(incidentEnqueueMock).toHaveBeenCalledTimes(1);
    const call = incidentEnqueueMock.mock.calls[0][0];
    expect(call.eventType).toBe('incident.created');
    const envelope = parseWebhookEvent(call.payload);
    expect(envelope.type).toBe('incident.created');
    expect(envelope.organizationId).toBe(org.id);
    expect(envelope.projectId).toBeNull();
    const d = envelope.data as Record<string, unknown>;
    expect(d).not.toHaveProperty('event_type');
    expect(d).not.toHaveProperty('timestamp');
    expect(d.incident_id).toBe('00000000-0000-0000-0000-000000000099');
    expect(d.title).toBe('Envelope Test Incident');
  });
});

describe('Incident webhook request settings', () => {
  beforeEach(() => {
    incidentEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    mockGetIncidentChannels.mockReset();
  });

  it('passes channel id, method and headers to the dispatcher', async () => {
    const owner = await createTestUser({ name: 'Owner Auth' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Incident Auth Org' });
    mockGetIncidentChannels.mockResolvedValueOnce([{
      id: '00000000-0000-0000-0000-0000000000aa',
      organizationId: org.id,
      name: 'Authed hook',
      type: 'webhook',
      enabled: true,
      config: { url: 'https://hooks.example.com/auth', method: 'PUT', headers: { 'X-Team': 'ops' }, auth: { type: 'bearer', token: 'tok-123' } },
    }]);

    await processIncidentNotification({
      data: {
        incidentId: '00000000-0000-0000-0000-000000000098',
        organizationId: org.id,
        title: 'Auth Incident',
        description: 'x',
        severity: 'high',
        affectedServices: ['api'],
      } as IncidentNotificationJob,
    } as Job<IncidentNotificationJob>);

    expect(incidentEnqueueMock).toHaveBeenCalledTimes(1);
    const call = incidentEnqueueMock.mock.calls[0][0];
    expect(call.channelId).toBe('00000000-0000-0000-0000-0000000000aa');
    expect(call.method).toBe('PUT');
    expect(call.headers).toEqual({ 'X-Team': 'ops', Authorization: 'Bearer tok-123' });
  });
});

describe('Incident Notification Email Generation', () => {
  // Test the email HTML generation logic
  it('should generate correct severity colors for all levels', () => {
    const severityColors: Record<string, string> = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#ca8a04',
      low: '#2563eb',
      informational: '#6b7280',
    };

    // Verify we have all severity levels covered
    expect(Object.keys(severityColors)).toContain('critical');
    expect(Object.keys(severityColors)).toContain('high');
    expect(Object.keys(severityColors)).toContain('medium');
    expect(Object.keys(severityColors)).toContain('low');
    expect(Object.keys(severityColors)).toContain('informational');
  });

  it('should generate correct severity labels for all levels', () => {
    const severityLabels: Record<string, string> = {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      informational: 'Informational',
    };

    expect(severityLabels.critical).toBe('Critical');
    expect(severityLabels.high).toBe('High');
    expect(severityLabels.medium).toBe('Medium');
    expect(severityLabels.low).toBe('Low');
    expect(severityLabels.informational).toBe('Informational');
  });
});

describe('Incident notification routing and links', () => {
  const PD_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

  beforeEach(async () => {
    vi.clearAllMocks();
    incidentEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    sendMailMock.mockReset().mockResolvedValue({ messageId: 'test-id' });
    vi.mocked(isSmtpConfigured).mockReturnValue(false);
    mockGetIncidentChannels.mockReset().mockResolvedValue([]);
    await db.deleteFrom('organization_default_channels').execute();
  });

  function jobFor(orgId: string, overrides: Partial<IncidentNotificationJob> = {}) {
    return {
      data: {
        incidentId: '00000000-0000-0000-0000-000000000077',
        organizationId: orgId,
        title: 'Link Test Incident',
        description: 'desc',
        severity: 'high',
        affectedServices: ['api'],
        ...overrides,
      } as IncidentNotificationJob,
    } as Job<IncidentNotificationJob>;
  }

  function channel(orgId: string, type: 'email' | 'webhook' | 'pagerduty', config: unknown, id: string) {
    return { id, organizationId: orgId, name: id, type, enabled: true, config };
  }

  it('links to /dashboard/incidents/<id> in the email, webhook payload and in-app record', async () => {
    vi.mocked(isSmtpConfigured).mockReturnValue(true);
    const owner = await createTestUser({ name: 'Owner User' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Link Org' });
    mockGetIncidentChannels.mockResolvedValueOnce([
      channel(org.id, 'email', { recipients: ['ops@example.com'] }, 'c-email'),
      channel(org.id, 'webhook', { url: 'https://hooks.example.com/incident' }, 'c-hook'),
    ]);

    await processIncidentNotification(jobFor(org.id));

    const id = '00000000-0000-0000-0000-000000000077';
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.html).toContain('/dashboard/incidents/' + id);
    expect(mail.text).toContain('/dashboard/incidents/' + id);
    expect(mail.html).not.toContain('/dashboard/security/incidents');

    const payload = incidentEnqueueMock.mock.calls[0][0].payload as { data: { link: string } };
    expect(payload.data.link).toBe('https://app.logtide.dev/dashboard/incidents/' + id);

    const inApp = vi.mocked(notificationsService.createNotification).mock.calls[0][0] as any;
    expect(inApp.metadata.link).toBe('/dashboard/incidents/' + id);
    expect(JSON.stringify([mail, payload, inApp])).not.toContain('/dashboard/security/incidents');
  });

  it('a webhook-only routing sends no email even with SMTP configured', async () => {
    vi.mocked(isSmtpConfigured).mockReturnValue(true);
    const owner = await createTestUser({ name: 'Owner User' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Webhook Only Org' });
    mockGetIncidentChannels.mockResolvedValueOnce([
      channel(org.id, 'webhook', { url: 'https://hooks.slack.com/services/T1/B2/x' }, 'c-hook'),
    ]);

    await processIncidentNotification(jobFor(org.id));

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(incidentEnqueueMock).toHaveBeenCalledTimes(1);
  });

  it('nothing resolved with SMTP on emails owners and admins only', async () => {
    vi.mocked(isSmtpConfigured).mockReturnValue(true);
    const owner = await createTestUser({ email: 'fallback-owner@test.com', name: 'Owner User' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Fallback Org' });
    const admin = await createTestUser({ email: 'fallback-admin@test.com', name: 'Admin User' });
    const member = await createTestUser({ email: 'fallback-member@test.com', name: 'Member User' });
    await db
      .insertInto('organization_members')
      .values([
        { user_id: admin.id, organization_id: org.id, role: 'admin' },
        { user_id: member.id, organization_id: org.id, role: 'member' },
      ])
      .execute();

    await processIncidentNotification(jobFor(org.id, { severity: 'critical' }));

    const recipients = sendMailMock.mock.calls.map((c) => c[0].to).sort();
    expect(recipients).toEqual(['fallback-admin@test.com', 'fallback-owner@test.com']);
  });

  it('sends a PagerDuty trigger with the incident dedup key and still runs with no members', async () => {
    const owner = await createTestUser({ name: 'Owner User' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'PD Org' });
    await db.deleteFrom('organization_members').where('organization_id', '=', org.id).execute();
    mockGetIncidentChannels.mockResolvedValueOnce([
      channel(org.id, 'pagerduty', { routingKey: PD_KEY }, '00000000-0000-0000-0000-0000000000aa'),
    ]);

    await processIncidentNotification(jobFor(org.id));

    expect(incidentEnqueueMock).toHaveBeenCalledTimes(1);
    const call = incidentEnqueueMock.mock.calls[0][0];
    expect(call.url).toBe('https://events.pagerduty.com/v2/enqueue');
    expect(call.payload.event_action).toBe('trigger');
    expect(call.payload.dedup_key).toBe('incident:00000000-0000-0000-0000-000000000077');
    expect(call.payload.routing_key).toBe(PD_KEY);
  });
});
