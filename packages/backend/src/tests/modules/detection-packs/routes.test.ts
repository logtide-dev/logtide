import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { detectionPacksRoutes } from '../../../modules/detection-packs/routes.js';
import { DetectionPacksService } from '../../../modules/detection-packs/service.js';
import { DETECTION_PACKS, getPackById } from '../../../modules/detection-packs/pack-definitions.js';
import { createTestContext, createTestUser, createTestOrganization } from '../../helpers/factories.js';
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

describe('Detection Packs Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(detectionPacksRoutes, { prefix: '/api/v1/detection-packs' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('detection_pack_activations').execute();
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

    describe('GET /api/v1/detection-packs', () => {
        it('should return all detection packs with status', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.packs).toBeDefined();
            expect(body.packs).toHaveLength(DETECTION_PACKS.length);
        });

        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs?organizationId=${testOrganization.id}`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 400 without organizationId', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/detection-packs',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('organizationId');
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return enabled status for activated pack', async () => {
            const service = new DetectionPacksService();
            await service.enablePack(testOrganization.id, 'startup-reliability');

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            const reliabilityPack = body.packs.find((p: any) => p.id === 'startup-reliability');
            expect(reliabilityPack.enabled).toBe(true);
        });
    });

    describe('GET /api/v1/detection-packs/:packId', () => {
        it('should return single pack with status', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs/startup-reliability?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.pack).toBeDefined();
            expect(body.pack.id).toBe('startup-reliability');
            expect(body.pack.name).toBe('Startup Reliability Pack');
        });

        it('should return 404 for non-existent pack', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs/non-existent?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 400 without organizationId', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/detection-packs/startup-reliability',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 401 without auth', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs/startup-reliability?organizationId=${testOrganization.id}`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs/startup-reliability?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('POST /api/v1/detection-packs/:packId/enable', () => {
        it('should enable a pack', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.pack).toBeDefined();
            expect(body.pack.enabled).toBe(true);
            expect(body.pack.generatedRulesCount).toBeGreaterThan(0);
        });

        it('should enable with custom thresholds', async () => {
            const customThresholds = {
                'high-error-rate': { level: 'critical' },
            };

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds,
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.pack.customThresholds).toEqual(customThresholds);
        });

        it('should enable with email recipients', async () => {
            const emailRecipients = ['test@example.com', 'alert@example.com'];

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    emailRecipients,
                },
            });

            expect(response.statusCode).toBe(201);

            // Verify sigma rules have email recipients
            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .select(['email_recipients'])
                .where('organization_id', '=', testOrganization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            expect(sigmaRules[0].email_recipients).toEqual(emailRecipients);
        });

        it('should enable with webhook URL', async () => {
            const webhookUrl = 'https://hooks.slack.com/services/test';

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    webhookUrl,
                },
            });

            expect(response.statusCode).toBe(201);
        });

        it('should return 404 for non-existent pack', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/non-existent/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 409 when pack already enabled', async () => {
            // Enable first
            await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            // Try to enable again
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            expect(response.statusCode).toBe(409);
        });

        it('should return 401 without auth', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return 400 for invalid organizationId format', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: 'invalid-uuid',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 for invalid email format', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    emailRecipients: ['invalid-email'],
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 for invalid webhook URL', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/enable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    webhookUrl: 'not-a-url',
                },
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('POST /api/v1/detection-packs/:packId/disable', () => {
        beforeEach(async () => {
            // Enable a pack for testing disable
            const service = new DetectionPacksService();
            await service.enablePack(testOrganization.id, 'startup-reliability');
        });

        it('should disable an enabled pack', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/detection-packs/startup-reliability/disable?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(204);

            // Verify disabled
            const service = new DetectionPacksService();
            const pack = await service.getPackWithStatus(testOrganization.id, 'startup-reliability');
            expect(pack?.enabled).toBe(false);
        });

        it('should delete sigma rules when disabling', async () => {
            await app.inject({
                method: 'POST',
                url: `/api/v1/detection-packs/startup-reliability/disable?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            expect(sigmaRules).toHaveLength(0);
        });

        it('should return 404 for non-existent pack', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/detection-packs/non-existent/disable?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 400 when pack not enabled', async () => {
            // Disable first
            await app.inject({
                method: 'POST',
                url: `/api/v1/detection-packs/startup-reliability/disable?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            // Try to disable again
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/detection-packs/startup-reliability/disable?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 without organizationId', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/detection-packs/startup-reliability/disable',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 401 without auth', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/detection-packs/startup-reliability/disable?organizationId=${testOrganization.id}`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/detection-packs/startup-reliability/disable?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('PUT /api/v1/detection-packs/:packId/thresholds', () => {
        beforeEach(async () => {
            // Enable a pack for testing threshold updates
            const service = new DetectionPacksService();
            await service.enablePack(testOrganization.id, 'startup-reliability');
        });

        it('should update thresholds for enabled pack', async () => {
            const newThresholds = {
                'high-error-rate': { level: 'low' },
            };

            const response = await app.inject({
                method: 'PUT',
                url: '/api/v1/detection-packs/startup-reliability/thresholds',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds: newThresholds,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.pack.customThresholds).toEqual(newThresholds);
        });

        it('should return 404 for non-existent pack', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/v1/detection-packs/non-existent/thresholds',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds: {},
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 400 when pack not enabled', async () => {
            // Disable the pack first
            const service = new DetectionPacksService();
            await service.disablePack(testOrganization.id, 'startup-reliability');

            const response = await app.inject({
                method: 'PUT',
                url: '/api/v1/detection-packs/startup-reliability/thresholds',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds: { 'high-error-rate': { level: 'low' } },
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('must be enabled');
        });

        it('should return 401 without auth', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/v1/detection-packs/startup-reliability/thresholds',
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds: {},
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'PUT',
                url: '/api/v1/detection-packs/startup-reliability/thresholds',
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds: {},
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return 400 for invalid threshold level', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/v1/detection-packs/startup-reliability/thresholds',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds: {
                        'high-error-rate': { level: 'invalid-level' },
                    },
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should update sigma rule levels when threshold changes', async () => {
            await app.inject({
                method: 'PUT',
                url: '/api/v1/detection-packs/startup-reliability/thresholds',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    customThresholds: {
                        'high-error-rate': { level: 'informational' },
                    },
                },
            });

            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['level'])
                .where('organization_id', '=', testOrganization.id)
                .where('sigma_id', '=', 'pack-startup-reliability-high-error-rate')
                .executeTakeFirst();

            expect(sigmaRule?.level).toBe('informational');
        });
    });

    describe('Organization isolation', () => {
        it('should not expose packs from other organizations', async () => {
            const { organization: otherOrg, user: otherUser } = await createTestContext();
            const otherSession = await createTestSession(otherUser.id);

            const service = new DetectionPacksService();
            await service.enablePack(testOrganization.id, 'startup-reliability');

            // Other user should not see the enabled pack
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/detection-packs?organizationId=${otherOrg.id}`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            const reliabilityPack = body.packs.find((p: any) => p.id === 'startup-reliability');
            expect(reliabilityPack.enabled).toBe(false);
        });
    });
});
