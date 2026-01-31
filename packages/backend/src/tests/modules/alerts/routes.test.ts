import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { alertsRoutes } from '../../../modules/alerts/routes.js';
import { createTestContext, createTestUser, createTestAlertRule } from '../../helpers/factories.js';
import crypto from 'crypto';

// Helper to create a session for a user
async function createTestSession(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db
        .insertInto('sessions')
        .values({
            user_id: userId,
            token,
            expires_at: expiresAt,
        })
        .execute();

    return { token, expiresAt };
}

describe('Alerts Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(alertsRoutes, { prefix: '/api/v1/alerts' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

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

        // Create test context
        const context = await createTestContext();
        testUser = context.user;
        testOrganization = context.organization;
        testProject = context.project;

        // Create session for auth
        const session = await createTestSession(testUser.id);
        authToken = session.token;
    });

    describe('POST /api/v1/alerts', () => {
        it('should create an alert rule', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    projectId: testProject.id,
                    name: 'Test Alert Rule',
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 5,
                    emailRecipients: ['test@example.com'],
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.alertRule).toBeDefined();
            expect(body.alertRule.name).toBe('Test Alert Rule');
        });

        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts',
                payload: {
                    organizationId: testOrganization.id,
                    name: 'Test Alert',
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 5,
                    emailRecipients: ['test@example.com'],
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 400 for invalid payload', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    // Missing required fields
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts',
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    name: 'Test Alert',
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 5,
                    emailRecipients: ['test@example.com'],
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/alerts', () => {
        it('should get alert rules for organization', async () => {
            await createTestAlertRule({
                organizationId: testOrganization.id,
                name: 'Rule 1',
            });
            await createTestAlertRule({
                organizationId: testOrganization.id,
                name: 'Rule 2',
            });

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.alertRules).toHaveLength(2);
        });

        it('should return 400 without organizationId', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/alerts',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should filter by projectId', async () => {
            await createTestAlertRule({
                organizationId: testOrganization.id,
                projectId: testProject.id,
                name: 'Project Rule',
            });
            await createTestAlertRule({
                organizationId: testOrganization.id,
                projectId: null,
                name: 'Org Rule',
            });

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            // Project filter returns project-specific rules AND org-wide rules (projectId: null)
            expect(body.alertRules.length).toBeGreaterThanOrEqual(1);
            expect(body.alertRules.some((r: any) => r.name === 'Project Rule')).toBe(true);
        });

        it('should filter enabled only', async () => {
            await createTestAlertRule({
                organizationId: testOrganization.id,
                name: 'Enabled Rule',
                enabled: true,
            });
            await createTestAlertRule({
                organizationId: testOrganization.id,
                name: 'Disabled Rule',
                enabled: false,
            });

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts?organizationId=${testOrganization.id}&enabledOnly=true`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.alertRules).toHaveLength(1);
            expect(body.alertRules[0].name).toBe('Enabled Rule');
        });
    });

    describe('GET /api/v1/alerts/:id', () => {
        it('should get alert rule by ID', async () => {
            const rule = await createTestAlertRule({
                organizationId: testOrganization.id,
                name: 'Test Rule',
            });

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts/${rule.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.alertRule.id).toBe(rule.id);
            expect(body.alertRule.name).toBe('Test Rule');
        });

        it('should return 404 for non-existent rule', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 400 for invalid UUID', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts/invalid-uuid?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('PUT /api/v1/alerts/:id', () => {
        it('should update alert rule', async () => {
            const rule = await createTestAlertRule({
                organizationId: testOrganization.id,
                name: 'Original Name',
            });

            const response = await app.inject({
                method: 'PUT',
                url: `/api/v1/alerts/${rule.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'Updated Name',
                    threshold: 20,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.alertRule.name).toBe('Updated Name');
        });

        it('should return 404 for non-existent rule', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: `/api/v1/alerts/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'Updated',
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('DELETE /api/v1/alerts/:id', () => {
        it('should delete alert rule', async () => {
            const rule = await createTestAlertRule({
                organizationId: testOrganization.id,
                name: 'To Delete',
            });

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/alerts/${rule.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(204);

            // Verify deleted
            const getResponse = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts/${rule.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });
            expect(getResponse.statusCode).toBe(404);
        });

        it('should return 404 for non-existent rule', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/alerts/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('GET /api/v1/alerts/history', () => {
        it('should get alert history', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts/history?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.history).toBeDefined();
            expect(body.total).toBeDefined();
        });

        it('should return 400 without organizationId', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/alerts/history',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should support pagination', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/alerts/history?organizationId=${testOrganization.id}&limit=10&offset=0`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe('POST /api/v1/alerts/preview', () => {
        it('should preview alert rule', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    projectId: testProject.id,
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 5,
                    previewRange: '1d',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.preview).toBeDefined();
            expect(body.preview.summary).toBeDefined();
            expect(body.preview.incidents).toBeDefined();
            expect(body.preview.statistics).toBeDefined();
            expect(body.preview.suggestions).toBeDefined();
        });

        it('should return 400 for invalid payload', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    // Missing required fields
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other-preview@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 5,
                    previewRange: '1d',
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return 401 without auth', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                payload: {
                    organizationId: testOrganization.id,
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 5,
                    previewRange: '1d',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should accept different preview ranges', async () => {
            const ranges = ['1d', '7d', '14d', '30d'];

            for (const range of ranges) {
                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/alerts/preview',
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                    },
                    payload: {
                        organizationId: testOrganization.id,
                        level: ['error'],
                        threshold: 10,
                        timeWindow: 5,
                        previewRange: range,
                    },
                });

                expect(response.statusCode).toBe(200);
            }
        });

        it('should accept service filter', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    projectId: testProject.id,
                    service: 'api-service',
                    level: ['error', 'critical'],
                    threshold: 5,
                    timeWindow: 10,
                    previewRange: '7d',
                },
            });

            expect(response.statusCode).toBe(200);
        });

        it('should return 400 for invalid time window', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 2000, // Exceeds max of 1440
                    previewRange: '1d',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 for invalid level', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    level: ['invalid-level'],
                    threshold: 10,
                    timeWindow: 5,
                    previewRange: '1d',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should preview for org-wide alert (null projectId)', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/alerts/preview',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    projectId: null,
                    level: ['error'],
                    threshold: 10,
                    timeWindow: 5,
                    previewRange: '1d',
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });
});
