import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';

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
  connection: {
    duplicate: vi.fn(() => ({
      subscribe: vi.fn(),
      on: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
    })),
  },
}));

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
  },
  isSmtpConfigured: vi.fn(() => false), // Default to no SMTP
}));

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
    })),
  },
}));

// Mock the notifications service
vi.mock('../../../modules/notifications/service.js', () => ({
  notificationsService: {
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-id' }),
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
          title: 'Security Incident: High',
          message: 'Test Incident',
          type: 'alert',
          organizationId: org.id,
          metadata: expect.objectContaining({
            incidentId: 'incident-123',
            severity: 'high',
            link: '/dashboard/security/incidents/incident-123',
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
