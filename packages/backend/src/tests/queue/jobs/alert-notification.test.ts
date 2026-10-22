import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processAlertNotification, type AlertNotificationData } from '../../../queue/jobs/alert-notification.js';
import { parseWebhookEvent } from '@logtide/shared';
import { hooks } from '../../../hooks/index.js';
import { db } from '../../../database/index.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';

// Mock nodemailer: one shared sendMail so tests can read the sent messages
// (the job caches its transporter across tests).
const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));
vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: sendMailMock,
        })),
    },
}));

// Mock webhookDispatcher: SSRF guard, hook execution, retry/backoff are
// all handled inside the dispatcher and covered by deliver-once.test.ts (#218).
// buildEnvelope is kept real so the envelope shape is testable.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));
vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
    return {
        ...actual,
        webhookDispatcher: { enqueue: enqueueMock },
    };
});

// Mock alertsService
vi.mock('../../../modules/alerts/index.js', () => ({
    alertsService: {
        markAsNotified: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock notificationChannelsService
const { mockGetAlertRuleChannels, mockGetOrganizationDefaults, mockGetSigmaRuleChannels } = vi.hoisted(() => ({
    mockGetAlertRuleChannels: vi.fn(),
    mockGetOrganizationDefaults: vi.fn(),
    mockGetSigmaRuleChannels: vi.fn(),
}));
// Channels returned by the real service always belong to the queried
// organization, so the mock stamps organizationId like the DB rows do.
const mockChannelsService = vi.hoisted(() => ({
    getAlertRuleChannels: async (ruleId: string, organizationId: string) =>
        ((await mockGetAlertRuleChannels(ruleId, organizationId)) as Record<string, unknown>[]).map((c) => ({
            organizationId,
            ...c,
        })),
    getSigmaRuleChannels: async (ruleId: string, organizationId: string) =>
        ((await mockGetSigmaRuleChannels(ruleId, organizationId)) as Record<string, unknown>[]).map((c) => ({
            organizationId,
            ...c,
        })),
    getOrganizationDefaults: async (organizationId: string, eventType: string) =>
        ((await mockGetOrganizationDefaults(organizationId, eventType)) as Record<string, unknown>[]).map((c) => ({
            organizationId,
            ...c,
        })),
}));
// The job imports the index, the shared resolver imports the service file.
vi.mock('../../../modules/notification-channels/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../modules/notification-channels/index.js')>();
    return { ...actual, notificationChannelsService: mockChannelsService };
});
vi.mock('../../../modules/notification-channels/service.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../modules/notification-channels/service.js')>();
    return { ...actual, notificationChannelsService: mockChannelsService };
});

// Mock config
vi.mock('../../../config/index.js', () => {
  const config = {
        SMTP_HOST: 'smtp.test.com',
        SMTP_PORT: 587,
        SMTP_USER: 'test@test.com',
        SMTP_PASS: 'password',
        SMTP_FROM: 'alerts@test.com',
        SMTP_SECURE: false,
        REDIS_URL: 'redis://localhost:6379',
        CACHE_ENABLED: true,
        CACHE_TTL: 60,
        FRONTEND_URL: 'https://app.logtide.dev',
        NODE_ENV: 'test',
  };
  return { config, isSmtpConfigured: () => !!config.SMTP_HOST };
});

describe('Alert Notification Job', () => {
    beforeEach(async () => {
        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('sigma_rules').execute();
        await db.deleteFrom('alert_rules').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('notifications').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();

        vi.clearAllMocks();
        enqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
        sendMailMock.mockReset().mockResolvedValue({});
        mockGetAlertRuleChannels.mockReset();
        mockGetAlertRuleChannels.mockResolvedValue([]);
        mockGetOrganizationDefaults.mockReset();
        mockGetOrganizationDefaults.mockResolvedValue([]);
        mockGetSigmaRuleChannels.mockReset();
        mockGetSigmaRuleChannels.mockResolvedValue([]);
        hooks.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        hooks.clear();
    });

    describe('processAlertNotification', () => {
        it('should create in-app notifications for organization members', async () => {
            const { organization, project, user } = await createTestContext();

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Test Alert Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            // Check that in-app notification was created
            const notifications = await db
                .selectFrom('notifications')
                .selectAll()
                .where('user_id', '=', user.id)
                .execute();

            expect(notifications.length).toBeGreaterThan(0);
            expect(notifications[0].title).toContain('Test Alert Rule');
        });

        it('should send email notification when email channel is configured', async () => {
            const { organization, project } = await createTestContext();

            // Mock notification channel with email recipients
            mockGetAlertRuleChannels.mockResolvedValueOnce([{
                id: '00000000-0000-0000-0000-000000000010',
                type: 'email',
                enabled: true,
                config: { recipients: ['admin@example.com', 'ops@example.com'] },
            }]);

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Email Alert Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            const consoleSpy = vi.spyOn(console, 'log');

            await processAlertNotification({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Email notifications sent')
            );
        });

        it('should enqueue webhook when webhook channel is configured', async () => {
            const { organization, project } = await createTestContext();

            // Mock notification channel with webhook
            mockGetAlertRuleChannels.mockResolvedValueOnce([{
                id: '00000000-0000-0000-0000-000000000010',
                type: 'webhook',
                enabled: true,
                config: { url: 'https://hooks.example.com/alert' },
            }]);

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Webhook Alert Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(enqueueMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://hooks.example.com/alert',
                    eventType: 'alert.triggered',
                    payload: expect.objectContaining({
                        type: 'alert.triggered',
                        version: 1,
                        data: expect.objectContaining({
                            alert_name: 'Webhook Alert Rule',
                        }),
                    }),
                })
            );
        });

        it('should enqueue webhook and complete job even if delivery is deferred', async () => {
            const { organization, project } = await createTestContext();
            const { alertsService } = await import('../../../modules/alerts/index.js');

            // Mock notification channel with webhook
            mockGetAlertRuleChannels.mockResolvedValueOnce([{
                id: '00000000-0000-0000-0000-000000000010',
                type: 'webhook',
                enabled: true,
                config: { url: 'https://hooks.example.com/failing' },
            }]);

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Failing Webhook Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            // Webhook delivery is now async (dispatcher handles retries);
            // the consumer job should still enqueue and mark as notified without error.
            expect(enqueueMock).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'https://hooks.example.com/failing' })
            );
            expect(alertsService.markAsNotified).toHaveBeenCalledWith(jobData.historyId);
        });

        it('should skip email when no recipients configured', async () => {
            const { organization, project } = await createTestContext();

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'No Email Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('No email recipients configured')
            );
        });

        it('should skip webhook when no URL configured', async () => {
            const { organization, project } = await createTestContext();

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'No Webhook Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('No webhook configured')
            );
        });

        it('should include project name in notification when project_id is provided', async () => {
            const { organization, project, user } = await createTestContext();

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Project Alert Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            const notifications = await db
                .selectFrom('notifications')
                .selectAll()
                .where('user_id', '=', user.id)
                .execute();

            expect(notifications.length).toBeGreaterThan(0);
            expect(notifications[0].message).toContain('project');
        });

        it('should handle missing organization members gracefully', async () => {
            // Create an organization without any members
            const user = await createTestUser();
            const orgResult = await db
                .insertInto('organizations')
                .values({
                    name: 'Empty Org',
                    slug: `empty-org-${Date.now()}`,
                    owner_id: user.id,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Empty Org Alert',
                organization_id: orgResult.id,
                project_id: null,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('No members found')
            );
        });

        it('should send both email and enqueue webhook when both channels configured', async () => {
            const { organization, project } = await createTestContext();

            // Mock notification channels with both email and webhook
            mockGetAlertRuleChannels.mockResolvedValueOnce([
                {
                    id: '00000000-0000-0000-0000-000000000010',
                    type: 'email',
                    enabled: true,
                    config: { recipients: ['admin@example.com'] },
                },
                {
                    id: '00000000-0000-0000-0000-000000000011',
                    type: 'webhook',
                    enabled: true,
                    config: { url: 'https://hooks.example.com/alert' },
                },
            ]);

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Full Notification Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Email notifications sent')
            );
            expect(enqueueMock).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'https://hooks.example.com/alert' })
            );
        });

        it('should include correct data in webhook payload', async () => {
            const { organization, project } = await createTestContext();

            // Mock notification channel with webhook
            mockGetAlertRuleChannels.mockResolvedValueOnce([{
                id: '00000000-0000-0000-0000-000000000010',
                type: 'webhook',
                enabled: true,
                config: { url: 'https://hooks.example.com/alert' },
            }]);

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Webhook Payload Test',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 150,
                threshold: 100,
                time_window: 10,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(enqueueMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://hooks.example.com/alert',
                    eventType: 'alert.triggered',
                    payload: expect.objectContaining({
                        type: 'alert.triggered',
                        version: 1,
                    }),
                })
            );

            // Envelope must satisfy the shared schema
            const call = enqueueMock.mock.calls[0][0];
            const envelope = parseWebhookEvent(call.payload);
            expect(envelope.type).toBe('alert.triggered');
            expect(envelope.organizationId).toBe(organization.id);
            expect(envelope.projectId).toBe(project.id);
            expect(envelope.data).not.toHaveProperty('event_type');
            expect(envelope.data).not.toHaveProperty('timestamp');
            expect(envelope.data).not.toHaveProperty('organization_id');
            expect(envelope.data).not.toHaveProperty('project_id');
            expect((envelope.data as Record<string, unknown>).alert_name).toBe('Webhook Payload Test');
            expect((envelope.data as Record<string, unknown>).log_count).toBe(150);
        });

        it('should ignore legacy email_recipients field and only use channels', async () => {
            const { organization, project } = await createTestContext();

            // No channels configured
            mockGetAlertRuleChannels.mockResolvedValueOnce([]);

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Legacy Fields Ignored',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                // Legacy fields populated but should be ignored
                email_recipients: ['old@example.com'],
                webhook_url: 'https://hooks.example.com/old',
            };

            await processAlertNotification({ data: jobData });

            // Should NOT send email despite legacy field
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('No email recipients configured')
            );
            // Should NOT enqueue webhook despite legacy field
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('No webhook configured')
            );
            expect(enqueueMock).not.toHaveBeenCalled();
        });

        it('should mark notification as complete after successful processing', async () => {
            const { organization, project } = await createTestContext();
            const { alertsService } = await import('../../../modules/alerts/index.js');

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Complete Alert',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(alertsService.markAsNotified).toHaveBeenCalledWith(
                jobData.historyId
            );
        });
    });

    describe('SSRF protection and null historyId', () => {
        // SSRF/hook behavior moved to the webhook dispatcher (#218); covered by deliver-once.test.ts.

        it('should skip markAsNotified when historyId is null', async () => {
            const { organization, project } = await createTestContext();
            const { alertsService } = await import('../../../modules/alerts/index.js');

            const jobData: AlertNotificationData = {
                historyId: null as any,
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Null HistoryId Alert',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(alertsService.markAsNotified).not.toHaveBeenCalled();
        });

        it('should still call markAsNotified when historyId is present', async () => {
            const { organization, project } = await createTestContext();
            const { alertsService } = await import('../../../modules/alerts/index.js');

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Valid HistoryId Alert',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: undefined,
            };

            await processAlertNotification({ data: jobData });

            expect(alertsService.markAsNotified).toHaveBeenCalledWith(
                jobData.historyId
            );
        });
    });

    // SSRF/hook behavior moved to the webhook dispatcher (#218); covered by deliver-once.test.ts.

    describe('envelope shape', () => {
        it('anomaly alert uses type alert.triggered with baseline_metadata in data', async () => {
            const { organization, project } = await createTestContext();

            mockGetAlertRuleChannels.mockResolvedValueOnce([{
                id: '00000000-0000-0000-0000-000000000010',
                type: 'webhook',
                enabled: true,
                config: { url: 'https://hooks.example.com/anomaly' },
            }]);

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Anomaly Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 500,
                threshold: 100,
                time_window: 60,
                email_recipients: [],
                webhook_url: undefined,
                baseline_metadata: {
                    baseline_value: 100,
                    current_value: 500,
                    deviation_ratio: 5,
                    baseline_type: 'rolling_average',
                    evaluation_time: new Date().toISOString(),
                },
            };

            await processAlertNotification({ data: jobData });

            const call = enqueueMock.mock.calls[0][0];
            expect(call.eventType).toBe('alert.triggered');
            const envelope = parseWebhookEvent(call.payload);
            expect(envelope.type).toBe('alert.triggered');
            // baseline_metadata must be in data, not at envelope level
            const d = envelope.data as Record<string, unknown>;
            expect(d.baseline_metadata).toBeTruthy();
            expect(d).not.toHaveProperty('organization_id');
        });
    });

    describe('1.6 lifecycle kinds', () => {
        const RULE_ID = '00000000-0000-4000-8000-000000000002';
        const HISTORY_ID = '00000000-0000-4000-8000-000000000001';
        const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';
        const WEBHOOK_URL = 'https://hooks.example.com/alert';
        const webhookChannel = {
            id: '00000000-0000-4000-8000-000000000010',
            type: 'webhook',
            enabled: true,
            config: { url: WEBHOOK_URL },
        };
        const emailChannel = {
            id: '00000000-0000-4000-8000-000000000011',
            type: 'email',
            enabled: true,
            config: { recipients: ['oncall@example.com'] },
        };

        function firingJob(
            organizationId: string,
            projectId: string | null,
            o: Partial<AlertNotificationData> = {}
        ): AlertNotificationData {
            return {
                historyId: HISTORY_ID,
                rule_id: RULE_ID,
                rule_name: 'Test Alert Rule',
                organization_id: organizationId,
                project_id: projectId,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: [],
                webhook_url: null,
                kind: 'triggered',
                firing_since: new Date(Date.now() - 35 * 60_000).toISOString(),
                incident_id: null,
                ...o,
            };
        }

        function resolvedJob(organizationId: string, projectId: string | null, o: Record<string, unknown> = {}) {
            return {
                kind: 'resolved' as const,
                rule_id: RULE_ID,
                rule_name: 'Test Alert Rule',
                organization_id: organizationId,
                project_id: projectId,
                alert_type: 'threshold' as const,
                log_count: 1,
                threshold: 50,
                time_window: 5,
                firing_since: '2026-10-21T10:00:00.000Z',
                resolved_at: '2026-10-21T10:42:30.000Z',
                incident_id: INCIDENT_ID,
                ...o,
            };
        }

        async function notificationsOf(userId: string) {
            return db.selectFrom('notifications').selectAll().where('user_id', '=', userId).execute();
        }

        it('triggered in-app title is sentence case', async () => {
            const { organization, project, user } = await createTestContext();

            await processAlertNotification({ data: firingJob(organization.id, project.id) });

            const [notification] = await notificationsOf(user.id);
            expect(notification.title).toBe('Alert triggered: Test Alert Rule');
            expect(notification.metadata).toMatchObject({ kind: 'triggered', incidentId: null, historyId: HISTORY_ID });
        });

        it('jobs without kind keep the triggered copy', async () => {
            const { organization, project, user } = await createTestContext();
            const { kind: _kind, firing_since: _f, incident_id: _i, ...legacy } = firingJob(organization.id, project.id);

            await processAlertNotification({ data: legacy });

            const [notification] = await notificationsOf(user.id);
            expect(notification.title).toBe('Alert triggered: Test Alert Rule');
            expect(notification.message).not.toContain('firing for');
        });

        it('renotify uses still firing copy in-app and in the email subject', async () => {
            const { organization, project, user } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([emailChannel]);

            await processAlertNotification({
                data: firingJob(organization.id, project.id, { kind: 'renotify', incident_id: INCIDENT_ID }),
            });

            const [notification] = await notificationsOf(user.id);
            expect(notification.title).toBe('Alert still firing: Test Alert Rule');
            expect(notification.message).toContain(', firing for 35 minutes.');
            expect(notification.metadata).toMatchObject({ kind: 'renotify', incidentId: INCIDENT_ID });
            expect(sendMailMock).toHaveBeenCalledTimes(1);
            expect(sendMailMock.mock.calls[0][0].subject).toBe('[Alert] Still firing: Test Alert Rule - 100 logs');
            expect(sendMailMock.mock.calls[0][0].to).toBe('oncall@example.com');
        });

        it('triggered email subjects for threshold and anomaly rules', async () => {
            const { organization, project } = await createTestContext();
            const baseline = {
                baseline_value: 1200,
                current_value: 6000,
                deviation_ratio: 5,
                baseline_type: 'rolling_7d_avg',
                evaluation_time: new Date().toISOString(),
            };

            for (const [o, subject] of [
                [{ log_count: 12345 }, '[Alert] Test Alert Rule - 12,345 logs exceeded threshold'],
                [{ baseline_metadata: baseline }, '[Anomaly] Test Alert Rule - 5x above baseline'],
                [{ baseline_metadata: baseline, kind: 'renotify' }, '[Anomaly] Still active: Test Alert Rule - 5x above baseline'],
            ] as const) {
                sendMailMock.mockClear();
                mockGetAlertRuleChannels.mockResolvedValueOnce([emailChannel]);
                await processAlertNotification({ data: firingJob(organization.id, project.id, o as Partial<AlertNotificationData>) });
                expect(sendMailMock.mock.calls[0][0].subject).toBe(subject);
            }
        });

        it('anomaly in-app titles are sentence case', async () => {
            const { organization, project, user } = await createTestContext();
            const baseline = {
                baseline_value: 1200,
                current_value: 6000,
                deviation_ratio: 5,
                baseline_type: 'rolling_7d_avg',
                evaluation_time: new Date().toISOString(),
            };

            await processAlertNotification({ data: firingJob(organization.id, project.id, { baseline_metadata: baseline }) });
            await processAlertNotification({
                data: firingJob(organization.id, project.id, { baseline_metadata: baseline, kind: 'renotify', historyId: '00000000-0000-4000-8000-000000000003' }),
            });

            const titles = (await notificationsOf(user.id)).map((n) => n.title).sort();
            expect(titles).toEqual(['Anomaly detected: Test Alert Rule', 'Anomaly still active: Test Alert Rule']);
            const messages = (await notificationsOf(user.id)).map((n) => n.message).join(' | ');
            expect(messages).toContain('(6,000 vs 1,200 logs/hr)');
        });

        it('formats numbers in in-app messages with en-US separators', async () => {
            const { organization, project, user } = await createTestContext();

            await processAlertNotification({
                data: firingJob(organization.id, project.id, { log_count: 12345, threshold: 10000, time_window: 1440 }),
            });

            const [notification] = await notificationsOf(user.id);
            expect(notification.message).toContain('12,345');
            expect(notification.message).toContain('threshold of 10,000 in 1,440 minutes');
        });

        it('triggered webhook data carries rule id, renotify flag and incident link', async () => {
            const { organization, project } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([webhookChannel]);
            const job = firingJob(organization.id, project.id, { kind: 'renotify', incident_id: INCIDENT_ID });

            await processAlertNotification({ data: job });

            expect(enqueueMock).toHaveBeenCalledTimes(1);
            const call = enqueueMock.mock.calls[0][0];
            expect(call).toMatchObject({
                url: WEBHOOK_URL,
                eventType: 'alert.triggered',
                eventId: `${HISTORY_ID}:${WEBHOOK_URL}`,
                channelId: webhookChannel.id,
                ruleId: RULE_ID,
            });
            const envelope = parseWebhookEvent(call.payload);
            expect(envelope.type).toBe('alert.triggered');
            expect(envelope.data).toMatchObject({
                alert_name: 'Test Alert Rule',
                alert_rule_id: RULE_ID,
                renotify: true,
                firing_since: job.firing_since,
                incident_id: INCIDENT_ID,
            });
            expect((envelope.data as { link: string }).link).toBe(`https://app.logtide.dev/dashboard/incidents/${INCIDENT_ID}`);
        });

        it('triggered webhook without incident links to the alerts page', async () => {
            const { organization, project } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([webhookChannel]);

            await processAlertNotification({ data: firingJob(organization.id, project.id) });

            const envelope = parseWebhookEvent(enqueueMock.mock.calls[0][0].payload);
            expect(envelope.data).toMatchObject({ renotify: false, incident_id: null, link: 'https://app.logtide.dev/dashboard/alerts' });
        });

        it('jobs without kind keep the pre-1.6 webhook payload', async () => {
            const { organization, project } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([webhookChannel]);
            const { kind: _kind, firing_since: _f, incident_id: _i, ...legacy } = firingJob(organization.id, project.id);

            await processAlertNotification({ data: legacy });

            const envelope = parseWebhookEvent(enqueueMock.mock.calls[0][0].payload);
            expect(Object.keys(envelope.data).sort()).toEqual(
                ['alert_name', 'baseline_metadata', 'link', 'log_count', 'threshold', 'time_window'].sort()
            );
        });

        it('resolved jobs enqueue alert.resolved to webhook channels only', async () => {
            const { organization, project, user } = await createTestContext();
            const { alertsService } = await import('../../../modules/alerts/index.js');
            mockGetAlertRuleChannels.mockResolvedValueOnce([emailChannel, webhookChannel]);
            const job = resolvedJob(organization.id, project.id);

            await processAlertNotification({ data: job });

            expect(enqueueMock).toHaveBeenCalledTimes(1);
            const call = enqueueMock.mock.calls[0][0];
            expect(call).toMatchObject({
                url: WEBHOOK_URL,
                eventType: 'alert.resolved',
                eventId: `${RULE_ID}:${job.firing_since}:resolved:${WEBHOOK_URL}`,
                channelId: webhookChannel.id,
                ruleId: RULE_ID,
            });
            const envelope = parseWebhookEvent(call.payload);
            expect(envelope.type).toBe('alert.resolved');
            expect(envelope.organizationId).toBe(organization.id);
            expect(envelope.projectId).toBe(project.id);
            expect(envelope.data).toEqual({
                alert_rule_id: RULE_ID,
                alert_name: 'Test Alert Rule',
                alert_type: 'threshold',
                title: 'Alert resolved: Test Alert Rule',
                message: 'Test Alert Rule is back to normal after 43 minutes',
                log_count: 1,
                threshold: 50,
                time_window: 5,
                firing_since: job.firing_since,
                resolved_at: job.resolved_at,
                duration_seconds: 2550,
                incident_id: INCIDENT_ID,
                link: `https://app.logtide.dev/dashboard/incidents/${INCIDENT_ID}`,
            });

            expect(await notificationsOf(user.id)).toHaveLength(0);
            expect(sendMailMock).not.toHaveBeenCalled();
            expect(alertsService.markAsNotified).not.toHaveBeenCalled();
        });

        it('resolved copy for rate-of-change rules and short episodes', async () => {
            const { organization, project } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValue([webhookChannel]);

            await processAlertNotification({
                data: resolvedJob(organization.id, null, {
                    alert_type: 'rate_of_change',
                    resolved_at: '2026-10-21T10:01:10.000Z',
                    incident_id: null,
                }),
            });

            const envelope = parseWebhookEvent(enqueueMock.mock.calls[0][0].payload);
            expect(envelope.projectId).toBeNull();
            expect(envelope.data).toMatchObject({
                message: 'Test Alert Rule log volume is back to its baseline after 1 minute',
                duration_seconds: 70,
                incident_id: null,
                link: 'https://app.logtide.dev/dashboard/alerts',
            });
        });

        it('resolved jobs without webhook destinations send nothing', async () => {
            const { organization, project } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([emailChannel]);

            await processAlertNotification({ data: resolvedJob(organization.id, project.id) });

            expect(enqueueMock).not.toHaveBeenCalled();
            expect(sendMailMock).not.toHaveBeenCalled();
        });

        it('dispatch ignores the job name and uses data.kind', async () => {
            const { organization, project, user } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([webhookChannel]);

            await processAlertNotification({ name: 'alert-notifications', data: resolvedJob(organization.id, project.id) } as never);

            expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'alert.resolved' }));
            expect(await notificationsOf(user.id)).toHaveLength(0);
        });

        it('alert rule jobs fall back to org default alert channels', async () => {
            const { organization, project } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([]);
            mockGetOrganizationDefaults.mockResolvedValueOnce([webhookChannel]);

            await processAlertNotification({ data: firingJob(organization.id, project.id) });

            expect(mockGetOrganizationDefaults).toHaveBeenCalledWith(organization.id, 'alert');
            expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ url: WEBHOOK_URL, eventType: 'alert.triggered' }));
            // A destination resolved: no owners and admins email fallback.
            expect(sendMailMock).not.toHaveBeenCalled();
        });

        it('resolved jobs also use the org default alert channels', async () => {
            const { organization, project } = await createTestContext();
            mockGetOrganizationDefaults.mockResolvedValueOnce([webhookChannel]);

            await processAlertNotification({ data: resolvedJob(organization.id, project.id) });

            expect(mockGetOrganizationDefaults).toHaveBeenCalledWith(organization.id, 'alert');
            expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'alert.resolved' }));
        });

        it('rule channels win over org defaults', async () => {
            const { organization, project } = await createTestContext();
            mockGetAlertRuleChannels.mockResolvedValueOnce([webhookChannel]);

            await processAlertNotification({ data: firingJob(organization.id, project.id) });

            expect(mockGetOrganizationDefaults).not.toHaveBeenCalled();
        });

        it('alert rule jobs with no channels and no defaults email owners and admins only', async () => {
            const { organization, project, user: owner } = await createTestContext();
            const admin = await createTestUser({ email: `admin-${Date.now()}@example.com` });
            const member = await createTestUser({ email: `member-${Date.now()}@example.com` });
            const disabledAdmin = await createTestUser({ email: `gone-${Date.now()}@example.com`, disabled: true });
            await db
                .insertInto('organization_members')
                .values([
                    { organization_id: organization.id, user_id: admin.id, role: 'admin' },
                    { organization_id: organization.id, user_id: member.id, role: 'member' },
                    { organization_id: organization.id, user_id: disabledAdmin.id, role: 'admin' },
                ])
                .execute();

            await processAlertNotification({ data: firingJob(organization.id, project.id) });

            expect(sendMailMock).toHaveBeenCalledTimes(1);
            const to = (sendMailMock.mock.calls[0][0].to as string).split(', ').sort();
            expect(to).toEqual([admin.email, owner.email].sort());
            // In-app still goes to every member.
            expect(await notificationsOf(member.id)).toHaveLength(1);
        });

        it('the owners and admins fallback needs SMTP', async () => {
            const { organization, project } = await createTestContext();
            const { config } = await import('../../../config/index.js');
            const saved = config.SMTP_HOST;
            (config as { SMTP_HOST?: string }).SMTP_HOST = undefined;
            try {
                await processAlertNotification({ data: firingJob(organization.id, project.id) });
            } finally {
                (config as { SMTP_HOST?: string }).SMTP_HOST = saved;
            }

            expect(sendMailMock).not.toHaveBeenCalled();
        });

        describe('PagerDuty destinations', () => {
            const PD_ROUTING_KEY = 'r'.repeat(32);
            const pagerDutyChannel = {
                id: '00000000-0000-4000-8000-000000000012',
                type: 'pagerduty',
                name: 'On call',
                enabled: true,
                config: { routingKey: PD_ROUTING_KEY },
            };
            const PD_URL = 'https://events.pagerduty.com/v2/enqueue';

            function pagerDutyCalls() {
                return enqueueMock.mock.calls.map((c) => c[0]).filter((c) => c.url === PD_URL);
            }

            it('triggers with the rule dedup key on alert.triggered', async () => {
                const { organization, project } = await createTestContext();
                mockGetAlertRuleChannels.mockResolvedValueOnce([pagerDutyChannel]);

                await processAlertNotification({ data: firingJob(organization.id, project.id) });

                const calls = pagerDutyCalls();
                expect(calls).toHaveLength(1);
                expect(calls[0].payload).toMatchObject({
                    routing_key: PD_ROUTING_KEY,
                    event_action: 'trigger',
                    dedup_key: `alert:${RULE_ID}`,
                });
                expect(calls[0].channelId).toBe(pagerDutyChannel.id);
                // PagerDuty is not an email or webhook destination.
                expect(sendMailMock).not.toHaveBeenCalled();
                expect(enqueueMock.mock.calls.filter((c) => c[0].url !== PD_URL)).toHaveLength(0);
            });

            it('re-notifications keep the same dedup key', async () => {
                const { organization, project } = await createTestContext();
                mockGetAlertRuleChannels.mockResolvedValueOnce([pagerDutyChannel]);

                await processAlertNotification({
                    data: firingJob(organization.id, project.id, { kind: 'renotify' }),
                });

                expect(pagerDutyCalls()[0].payload).toMatchObject({
                    event_action: 'trigger',
                    dedup_key: `alert:${RULE_ID}`,
                });
            });

            it('resolves the same dedup key on alert.resolved', async () => {
                const { organization, project } = await createTestContext();
                mockGetAlertRuleChannels.mockResolvedValueOnce([pagerDutyChannel]);

                await processAlertNotification({ data: resolvedJob(organization.id, project.id) });

                const calls = pagerDutyCalls();
                expect(calls).toHaveLength(1);
                expect(calls[0].payload).toEqual({
                    routing_key: PD_ROUTING_KEY,
                    event_action: 'resolve',
                    dedup_key: `alert:${RULE_ID}`,
                });
            });

            it('uses org default alert channels when the rule has none', async () => {
                const { organization, project } = await createTestContext();
                mockGetOrganizationDefaults.mockResolvedValueOnce([pagerDutyChannel]);

                await processAlertNotification({ data: firingJob(organization.id, project.id) });

                expect(mockGetOrganizationDefaults).toHaveBeenCalledWith(organization.id, 'alert');
                expect(pagerDutyCalls()).toHaveLength(1);
                expect(sendMailMock).not.toHaveBeenCalled();
            });

            it('Sigma jobs without kind never page', async () => {
                const { organization, project } = await createTestContext();
                mockGetAlertRuleChannels.mockResolvedValueOnce([pagerDutyChannel]);

                await processAlertNotification({
                    data: firingJob(organization.id, project.id, { kind: undefined }),
                });

                expect(pagerDutyCalls()).toHaveLength(0);
            });
        });

        it('jobs without kind never use org defaults', async () => {
            const { organization, project } = await createTestContext();
            const { alertsService } = await import('../../../modules/alerts/index.js');
            mockGetOrganizationDefaults.mockResolvedValue([webhookChannel]);

            // Sigma detection job shape (sigma-detection.ts): no kind, no history row.
            await processAlertNotification({
                data: {
                    historyId: null as never,
                    rule_id: RULE_ID,
                    rule_name: '[Sigma] Suspicious login',
                    organization_id: organization.id,
                    project_id: project.id,
                    log_count: 3,
                    threshold: 1,
                    time_window: 1,
                    email_recipients: ['sec@example.com'],
                    webhook_url: 'https://hooks.example.com/sigma',
                },
            });

            expect(mockGetOrganizationDefaults).not.toHaveBeenCalled();
            expect(enqueueMock).not.toHaveBeenCalled();
            expect(sendMailMock).not.toHaveBeenCalled();
            expect(alertsService.markAsNotified).not.toHaveBeenCalled();
        });
    });

    describe('sigma delivery (event_type sigma)', () => {
        const emailChannel = (id: string, to: string) => ({
            id,
            type: 'email',
            enabled: true,
            config: { recipients: [to] },
        });

        async function runSigma(organizationId: string, projectId: string) {
            await processAlertNotification({
                data: {
                    historyId: null as unknown as string,
                    kind: 'triggered',
                    event_type: 'sigma',
                    rule_id: '00000000-0000-0000-0000-0000000000aa',
                    rule_name: '[Sigma] Suspicious login',
                    organization_id: organizationId,
                    project_id: projectId,
                    log_count: 3,
                    threshold: 1,
                    time_window: 1,
                    email_recipients: [],
                    webhook_url: null,
                },
            });
        }

        it('delivers to the sigma rule channel and not to the alert defaults', async () => {
            const { organization, project } = await createTestContext();
            mockGetSigmaRuleChannels.mockResolvedValue([emailChannel('c-sigma', 'sigma-rule@example.com')]);
            mockGetOrganizationDefaults.mockImplementation(async (_org: string, type: string) =>
                type === 'alert' ? [emailChannel('c-alert', 'alert-default@example.com')] : []
            );

            await runSigma(organization.id, project.id);

            expect(mockGetAlertRuleChannels).not.toHaveBeenCalled();
            expect(sendMailMock).toHaveBeenCalledTimes(1);
            expect(sendMailMock.mock.calls[0][0].to).toBe('sigma-rule@example.com');
        });

        it('uses the sigma org defaults, not the alert defaults, when the rule has no channel', async () => {
            const { organization, project } = await createTestContext();
            mockGetOrganizationDefaults.mockImplementation(async (_org: string, type: string) =>
                type === 'sigma'
                    ? [emailChannel('c-sigma-def', 'sigma-default@example.com')]
                    : [emailChannel('c-alert', 'alert-default@example.com')]
            );

            await runSigma(organization.id, project.id);

            expect(mockGetOrganizationDefaults).toHaveBeenCalledWith(organization.id, 'sigma');
            expect(sendMailMock).toHaveBeenCalledTimes(1);
            expect(sendMailMock.mock.calls[0][0].to).toBe('sigma-default@example.com');
        });

        it('falls back to the owners and admins when sigma has no channel and no default', async () => {
            const { organization, project, user: owner } = await createTestContext();

            await runSigma(organization.id, project.id);

            expect(sendMailMock).toHaveBeenCalledTimes(1);
            expect(sendMailMock.mock.calls[0][0].to).toBe(owner.email);
        });

        it('still reads alert rule channels and alert defaults for alert jobs', async () => {
            const { organization, project } = await createTestContext();
            mockGetOrganizationDefaults.mockImplementation(async (_org: string, type: string) =>
                type === 'alert' ? [emailChannel('c-alert', 'alert-default@example.com')] : []
            );

            await processAlertNotification({
                data: {
                    historyId: '00000000-0000-0000-0000-000000000001',
                    kind: 'triggered',
                    rule_id: '00000000-0000-0000-0000-000000000002',
                    rule_name: 'Plain alert',
                    organization_id: organization.id,
                    project_id: project.id,
                    log_count: 100,
                    threshold: 50,
                    time_window: 5,
                    email_recipients: [],
                    webhook_url: undefined,
                },
            });

            expect(mockGetSigmaRuleChannels).not.toHaveBeenCalled();
            expect(sendMailMock.mock.calls[0][0].to).toBe('alert-default@example.com');
        });
    });
});
