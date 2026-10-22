import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization, createTestProject } from '../../helpers/factories.js';
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

// Mock webhookDispatcher; buildEnvelope is kept real so envelope shape is testable.
const { errorEnqueueMock } = vi.hoisted(() => ({ errorEnqueueMock: vi.fn() }));
vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
  return {
    ...actual,
    webhookDispatcher: { enqueue: errorEnqueueMock },
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
    ERROR_NOTIFICATION_COOLDOWN_MINUTES: 15,
  },
  isSmtpConfigured: vi.fn(() => false), // Default to no SMTP
}));

// Mock nodemailer
const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }) }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
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
const mockGetErrorGroupChannels = vi.fn().mockResolvedValue([]);
vi.mock('../../../modules/notification-channels/index.js', () => ({
  notificationChannelsService: {
    getErrorGroupChannels: (...args: unknown[]) => mockGetErrorGroupChannels(...args),
    getOrganizationDefaults: vi.fn().mockResolvedValue([]),
  },
}));

// Import after mocks
import { processErrorNotification, type ErrorNotificationJobData } from '../../../queue/jobs/error-notification.js';
import { notificationsService } from '../../../modules/notifications/service.js';
import { isSmtpConfigured } from '../../../config/index.js';
import type { Job } from 'bullmq';

/**
 * Helper to create an error group in the database
 */
async function createTestErrorGroup(overrides: {
  organizationId: string;
  projectId?: string | null;
  fingerprint?: string;
  exceptionType?: string;
  exceptionMessage?: string | null;
  language?: string;
  status?: 'open' | 'resolved' | 'ignored';
}) {
  const fingerprint = overrides.fingerprint || `fp-${Date.now()}-${Math.random()}`;

  const errorGroup = await db
    .insertInto('error_groups')
    .values({
      organization_id: overrides.organizationId,
      project_id: overrides.projectId || null,
      fingerprint,
      exception_type: overrides.exceptionType || 'Error',
      exception_message: overrides.exceptionMessage || 'Test error message',
      language: overrides.language || 'nodejs',
      status: overrides.status || 'open',
      occurrence_count: 1,
      first_seen: new Date(),
      last_seen: new Date(),
      affected_services: ['test-service'],
      sample_log_id: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return errorGroup;
}

describe('Error Notification Job', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    errorEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    mockGetErrorGroupChannels.mockReset().mockResolvedValue([]);
  });

  describe('processErrorNotification', () => {
    it('should skip notification when organization not found', async () => {
      const nonExistentOrgId = '00000000-0000-0000-0000-000000000000';

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: nonExistentOrgId,
          projectId: 'proj-1',
          fingerprint: 'fp-test',
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should skip notification when error group not found', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: 'non-existent-fingerprint',
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should skip notification when error group is ignored', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'ignored',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: false,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should send notification when error group is open', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'TypeError',
          exceptionMessage: 'Cannot read property x of undefined',
          language: 'nodejs',
          service: 'api-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: owner.id,
          title: 'New Error: TypeError',
          type: 'alert',
          organizationId: org.id,
        })
      );
    });

    it('should send notification when error group is resolved (not ignored)', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'resolved',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: false,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('should notify only owners and admins', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const admin = await createTestUser({ email: 'admin@test.com', name: 'Admin User' });
      const member = await createTestUser({ email: 'member@test.com', name: 'Member User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      // Add admin to organization
      await db
        .insertInto('organization_members')
        .values({
          user_id: admin.id,
          organization_id: org.id,
          role: 'admin',
        })
        .execute();

      // Add regular member to organization
      await db
        .insertInto('organization_members')
        .values({
          user_id: member.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      // Should notify owner and admin, but not regular member
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(2);
    });

    it('should handle notification with correct metadata for new error group', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-123',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'ReferenceError',
          exceptionMessage: 'x is not defined',
          language: 'nodejs',
          service: 'worker-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: owner.id,
          title: 'New Error: ReferenceError',
          message: 'x is not defined',
          type: 'alert',
          organizationId: org.id,
          projectId: project.id,
          metadata: expect.objectContaining({
            exceptionId: 'exc-123',
            errorGroupId: errorGroup.id,
            exceptionType: 'ReferenceError',
            language: 'nodejs',
            service: 'worker-service',
            isNewErrorGroup: true,
            link: `/dashboard/errors/${errorGroup.id}`,
          }),
        })
      );
    });

    it('should handle notification with correct title for existing error group', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'SyntaxError',
          exceptionMessage: 'Unexpected token',
          language: 'nodejs',
          service: 'parser-service',
          isNewErrorGroup: false,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error: SyntaxError', // Note: no "New" prefix
          metadata: expect.objectContaining({
            isNewErrorGroup: false,
          }),
        })
      );
    });

    it('should truncate long exception messages', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const longMessage = 'A'.repeat(200);

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: longMessage,
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'A'.repeat(100) + '...',
        })
      );
    });

    it('should use default message when exceptionMessage is null', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: null,
          language: 'nodejs',
          service: 'my-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'An error occurred in my-service',
        })
      );
    });

    it('should do nothing when no members in organization', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      // Remove all members from organization
      await db
        .deleteFrom('organization_members')
        .where('organization_id', '=', org.id)
        .execute();

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should skip notification when project not found', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: null, // No project
        status: 'open',
      });

      const nonExistentProjectId = '00000000-0000-0000-0000-000000000000';

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: nonExistentProjectId,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should handle all supported languages', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const languages = ['nodejs', 'python', 'java', 'go', 'php', 'unknown'] as const;

      for (const language of languages) {
        vi.clearAllMocks();

        const errorGroup = await createTestErrorGroup({
          organizationId: org.id,
          projectId: project.id,
          status: 'open',
          language,
        });

        const job = {
          data: {
            exceptionId: `exc-${language}`,
            organizationId: org.id,
            projectId: project.id,
            fingerprint: errorGroup.fingerprint,
            exceptionType: 'Error',
            exceptionMessage: `${language} error`,
            language,
            service: 'test-service',
            isNewErrorGroup: true,
          } as ErrorNotificationJobData,
        } as Job<ErrorNotificationJobData>;

        await processErrorNotification(job);

        expect(notificationsService.createNotification).toHaveBeenCalled();
      }
    });
  });

  describe('Email notifications', () => {
    it('should send emails when SMTP is configured', async () => {
      vi.mocked(isSmtpConfigured).mockReturnValue(true);

      const owner = await createTestUser({ name: 'Owner User', email: 'owner@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@test.com',
          subject: expect.stringContaining('[New Error]'),
        })
      );
    });

    it('should not send emails when SMTP is not configured', async () => {
      vi.mocked(isSmtpConfigured).mockReturnValue(false);

      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'Error',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'test-service',
          isNewErrorGroup: true,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should use correct email subject for existing error', async () => {
      vi.mocked(isSmtpConfigured).mockReturnValue(true);

      const owner = await createTestUser({ name: 'Owner User', email: 'owner@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      const job = {
        data: {
          exceptionId: 'exc-1',
          organizationId: org.id,
          projectId: project.id,
          fingerprint: errorGroup.fingerprint,
          exceptionType: 'TypeError',
          exceptionMessage: 'Test error',
          language: 'nodejs',
          service: 'api-service',
          isNewErrorGroup: false, // Existing error
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;

      await processErrorNotification(job);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '[Error] TypeError in api-service',
        })
      );
    });
  });
});

describe('Error webhook envelope', () => {
  beforeEach(() => {
    errorEnqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    mockGetErrorGroupChannels.mockReset().mockResolvedValue([]);
  });

  it('enqueues an error.detected envelope with project in data', async () => {
    const owner = await createTestUser({ name: 'Owner User' });
    const org = await createTestOrganization({ ownerId: owner.id, name: 'Envelope Org' });
    const project = await createTestProject({ organizationId: org.id, userId: owner.id });

    mockGetErrorGroupChannels.mockResolvedValueOnce([{
      id: '00000000-0000-0000-0000-000000000030',
      organizationId: org.id,
      type: 'webhook',
      enabled: true,
      config: { url: 'https://hooks.example.com/error' },
    }]);

    // Create a real error group so the notification slot can be claimed
    const errorGroup = await import('../../../database/index.js').then(({ db }) =>
      db.insertInto('error_groups').values({
        organization_id: org.id,
        project_id: project.id,
        fingerprint: `fp-envelope-${Date.now()}`,
        exception_type: 'EnvelopeError',
        exception_message: 'envelope test',
        language: 'nodejs',
        status: 'open',
        occurrence_count: 1,
        first_seen: new Date(),
        last_seen: new Date(),
        affected_services: ['svc'],
        sample_log_id: null,
      }).returningAll().executeTakeFirstOrThrow()
    );

    const job = {
      data: {
        exceptionId: 'exc-env-1',
        organizationId: org.id,
        projectId: project.id,
        fingerprint: errorGroup.fingerprint,
        exceptionType: 'EnvelopeError',
        exceptionMessage: 'envelope test',
        language: 'nodejs' as const,
        service: 'api',
        isNewErrorGroup: true,
      } as ErrorNotificationJobData,
    } as Job<ErrorNotificationJobData>;

    await processErrorNotification(job);

    expect(errorEnqueueMock).toHaveBeenCalledTimes(1);
    const call = errorEnqueueMock.mock.calls[0][0];
    expect(call.eventType).toBe('error.detected');
    const envelope = parseWebhookEvent(call.payload);
    expect(envelope.type).toBe('error.detected');
    expect(envelope.organizationId).toBe(org.id);
    expect(envelope.projectId).toBe(project.id);
    const d = envelope.data as Record<string, unknown>;
    expect(d).not.toHaveProperty('event_type');
    expect(d).not.toHaveProperty('timestamp');
    // organization object STAYS in data
    expect(d.organization).toBeTruthy();
    expect((d.organization as Record<string, unknown>).id).toBe(org.id);
    // project object STAYS in data
    expect(d.project).toBeTruthy();
    expect(d.is_new).toBe(true);
  });
});

  describe('Notification throttling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGetErrorGroupChannels.mockResolvedValue([]);
    });

    function buildJob(
      org: { id: string },
      project: { id: string },
      fingerprint: string,
      isNewErrorGroup: boolean
    ): Job<ErrorNotificationJobData> {
      return {
        data: {
          exceptionId: `exc-${Math.random()}`,
          organizationId: org.id,
          projectId: project.id,
          fingerprint,
          exceptionType: 'Svelte error',
          exceptionMessage: 'Maximum update depth exceeded',
          language: 'nodejs',
          service: 'web',
          isNewErrorGroup,
        } as ErrorNotificationJobData,
      } as Job<ErrorNotificationJobData>;
    }

    it('should send only one notification for a burst of the same error', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });
      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      // First occurrence is new, the rest are repeats firing in a tight loop.
      await processErrorNotification(buildJob(org, project, errorGroup.fingerprint, true));
      for (let i = 0; i < 20; i++) {
        await processErrorNotification(buildJob(org, project, errorGroup.fingerprint, false));
      }

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('should throttle a second occurrence within the cooldown window', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });
      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      await processErrorNotification(buildJob(org, project, errorGroup.fingerprint, true));
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      await processErrorNotification(buildJob(org, project, errorGroup.fingerprint, false));
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should notify again once the cooldown window has elapsed', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });
      const errorGroup = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      await processErrorNotification(buildJob(org, project, errorGroup.fingerprint, true));
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Backdate the last notification past the cooldown (default 15m).
      await db
        .updateTable('error_groups')
        .set({ last_notified_at: new Date(Date.now() - 60 * 60 * 1000) })
        .where('id', '=', errorGroup.id)
        .execute();

      await processErrorNotification(buildJob(org, project, errorGroup.fingerprint, false));
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('should throttle each error group independently', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });
      const groupA = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });
      const groupB = await createTestErrorGroup({
        organizationId: org.id,
        projectId: project.id,
        status: 'open',
      });

      await processErrorNotification(buildJob(org, project, groupA.fingerprint, true));
      await processErrorNotification(buildJob(org, project, groupA.fingerprint, false));
      await processErrorNotification(buildJob(org, project, groupB.fingerprint, true));

      // One for A (second is throttled) + one for B = 2 total.
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(2);
    });
  });

describe('Error Notification Language Labels', () => {
  it('should have correct language labels for all supported languages', () => {
    const languageLabels: Record<string, string> = {
      nodejs: 'Node.js',
      python: 'Python',
      java: 'Java',
      go: 'Go',
      php: 'PHP',
      unknown: 'Unknown',
    };

    expect(languageLabels.nodejs).toBe('Node.js');
    expect(languageLabels.python).toBe('Python');
    expect(languageLabels.java).toBe('Java');
    expect(languageLabels.go).toBe('Go');
    expect(languageLabels.php).toBe('PHP');
    expect(languageLabels.unknown).toBe('Unknown');
  });
});
