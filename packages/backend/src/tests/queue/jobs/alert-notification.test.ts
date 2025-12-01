import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processAlertNotification, type AlertNotificationData } from '../../../queue/jobs/alert-notification.js';
import { db } from '../../../database/index.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';

// Mock nodemailer
vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: vi.fn().mockResolvedValue({}),
        })),
    },
}));

// Mock fetch for webhooks
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock alertsService
vi.mock('../../../modules/alerts/index.js', () => ({
    alertsService: {
        markAsNotified: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock config
vi.mock('../../../config/index.js', () => ({
    config: {
        SMTP_HOST: 'smtp.test.com',
        SMTP_PORT: 587,
        SMTP_USER: 'test@test.com',
        SMTP_PASS: 'password',
        SMTP_FROM: 'alerts@test.com',
        SMTP_SECURE: false,
        REDIS_URL: 'redis://localhost:6379',
        CACHE_ENABLED: true,
        CACHE_TTL: 60,
    },
}));

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
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

        it('should send email notification when recipients are configured', async () => {
            const { organization, project } = await createTestContext();

            const jobData: AlertNotificationData = {
                historyId: '00000000-0000-0000-0000-000000000001',
                rule_id: '00000000-0000-0000-0000-000000000002',
                rule_name: 'Email Alert Rule',
                organization_id: organization.id,
                project_id: project.id,
                log_count: 100,
                threshold: 50,
                time_window: 5,
                email_recipients: ['admin@example.com', 'ops@example.com'],
                webhook_url: undefined,
            };

            const consoleSpy = vi.spyOn(console, 'log');

            await processAlertNotification({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Email notifications sent')
            );
        });

        it('should send webhook notification when URL is configured', async () => {
            const { organization, project } = await createTestContext();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                statusText: 'OK',
            });

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
                webhook_url: 'https://hooks.example.com/alert',
            };

            await processAlertNotification({ data: jobData });

            expect(mockFetch).toHaveBeenCalledWith(
                'https://hooks.example.com/alert',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            );
        });

        it('should handle webhook failure gracefully', async () => {
            const { organization, project } = await createTestContext();
            const { alertsService } = await import('../../../modules/alerts/index.js');

            mockFetch.mockResolvedValueOnce({
                ok: false,
                statusText: 'Internal Server Error',
            });

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
                webhook_url: 'https://hooks.example.com/failing',
            };

            await processAlertNotification({ data: jobData });

            // Should mark as notified with error
            expect(alertsService.markAsNotified).toHaveBeenCalledWith(
                jobData.historyId,
                expect.stringContaining('Webhook failed')
            );
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

        it('should send both email and webhook notifications', async () => {
            const { organization, project } = await createTestContext();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                statusText: 'OK',
            });

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
                email_recipients: ['admin@example.com'],
                webhook_url: 'https://hooks.example.com/alert',
            };

            await processAlertNotification({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Email notifications sent')
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Webhook notification sent')
            );
            expect(mockFetch).toHaveBeenCalled();
        });

        it('should include correct data in webhook payload', async () => {
            const { organization, project } = await createTestContext();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                statusText: 'OK',
            });

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
                webhook_url: 'https://hooks.example.com/alert',
            };

            await processAlertNotification({ data: jobData });

            const callArgs = mockFetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            expect(body.alert_name).toBe('Webhook Payload Test');
            expect(body.log_count).toBe(150);
            expect(body.threshold).toBe(100);
            expect(body.time_window).toBe(10);
            expect(body.timestamp).toBeDefined();
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
});
