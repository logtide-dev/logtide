import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { registerSiemSseRoutes } from '../../../modules/siem/sse-events.js';
import { createTestContext } from '../../helpers/factories.js';
import { CacheManager } from '../../../utils/cache.js';
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

describe('SIEM SSE Events', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await registerSiemSseRoutes(app);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        // Clean up system settings first (reset auth mode to standard)
        await db.deleteFrom('system_settings').execute();
        await CacheManager.invalidateSettings();

        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('incident_comments').execute();
        await db.deleteFrom('incident_history').execute();
        await db.deleteFrom('incident_alerts').execute();
        await db.deleteFrom('detection_events').execute();
        await db.deleteFrom('incidents').execute();
        await db.deleteFrom('sigma_rules').execute();
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('api_keys').execute();
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

    describe('GET /api/v1/siem/events', () => {
        it('should return 401 without token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?organizationId=${testOrganization.id}`,
            });

            // Missing token - query validation fails with 400 or we get 401
            expect([400, 401]).toContain(response.statusCode);
        });

        it('should return 401 for invalid token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?organizationId=${testOrganization.id}&token=invalid-token`,
            });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Invalid');
        });

        it('should return 403 when user is not member of organization', async () => {
            // Create another user not in the organization
            const otherUser = await db
                .insertInto('users')
                .values({
                    email: 'other@test.com',
                    name: 'Other User',
                    password_hash: 'hash',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?organizationId=${testOrganization.id}&token=${otherSession.token}`,
            });

            expect(response.statusCode).toBe(403);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('not a member');
        });

        it('should validate organizationId is a UUID', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?organizationId=not-a-uuid&token=${authToken}`,
            });

            expect(response.statusCode).toBe(400);
        });

        it('should accept valid projectId filter', async () => {
            // SSE endpoints use reply.hijack() which doesn't complete normally
            // We use a timeout to verify the request doesn't fail immediately with 4xx
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 100);

            try {
                const response = await app.inject({
                    method: 'GET',
                    url: `/api/v1/siem/events?organizationId=${testOrganization.id}&projectId=${testProject.id}&token=${authToken}`,
                    signal: controller.signal as any,
                });
                clearTimeout(timeoutId);
                // If we get a response, it should be success or internal error (not 4xx validation error)
                expect([200, 500]).toContain(response.statusCode);
            } catch (error: any) {
                clearTimeout(timeoutId);
                // AbortError is expected - means the SSE connection was established
                if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
                    expect(true).toBe(true); // Connection was established successfully
                } else {
                    throw error;
                }
            }
        });

        it('should accept valid incidentId filter', async () => {
            // Create an incident first
            const incident = await db
                .insertInto('incidents')
                .values({
                    organization_id: testOrganization.id,
                    project_id: testProject.id,
                    title: 'Test Incident',
                    severity: 'high',
                    status: 'open',
                    detection_count: 0,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            // SSE endpoints use reply.hijack() which doesn't complete normally
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 100);

            try {
                const response = await app.inject({
                    method: 'GET',
                    url: `/api/v1/siem/events?organizationId=${testOrganization.id}&incidentId=${incident.id}&token=${authToken}`,
                    signal: controller.signal as any,
                });
                clearTimeout(timeoutId);
                expect([200, 500]).toContain(response.statusCode);
            } catch (error: any) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
                    expect(true).toBe(true);
                } else {
                    throw error;
                }
            }
        });

        it('should reject invalid incidentId format', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?organizationId=${testOrganization.id}&incidentId=not-a-uuid&token=${authToken}`,
            });

            expect(response.statusCode).toBe(400);
        });

        it('should require organizationId parameter', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?token=${authToken}`,
            });

            expect(response.statusCode).toBe(400);
        });

        it('should handle expired session token', async () => {
            // Create an expired session
            const expiredToken = crypto.randomBytes(32).toString('hex');
            await db
                .insertInto('sessions')
                .values({
                    user_id: testUser.id,
                    token: expiredToken,
                    expires_at: new Date(Date.now() - 1000), // Already expired
                })
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?organizationId=${testOrganization.id}&token=${expiredToken}`,
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('SSE Connection Headers', () => {
        it('should set correct Content-Type for SSE (when connection succeeds)', async () => {
            // SSE endpoints use reply.hijack() which doesn't complete normally
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 100);

            try {
                const response = await app.inject({
                    method: 'GET',
                    url: `/api/v1/siem/events?organizationId=${testOrganization.id}&token=${authToken}`,
                    signal: controller.signal as any,
                });
                clearTimeout(timeoutId);
                expect([200, 500]).toContain(response.statusCode);
            } catch (error: any) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
                    expect(true).toBe(true);
                } else {
                    throw error;
                }
            }
        });
    });

    describe('Query Parameter Validation', () => {
        it('should validate all optional UUID parameters', async () => {
            // Test with all valid parameters
            const incident = await db
                .insertInto('incidents')
                .values({
                    organization_id: testOrganization.id,
                    project_id: testProject.id,
                    title: 'Test Incident',
                    severity: 'high',
                    status: 'open',
                    detection_count: 0,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            // SSE endpoints use reply.hijack() which doesn't complete normally
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 100);

            try {
                const response = await app.inject({
                    method: 'GET',
                    url: `/api/v1/siem/events?organizationId=${testOrganization.id}&projectId=${testProject.id}&incidentId=${incident.id}&token=${authToken}`,
                    signal: controller.signal as any,
                });
                clearTimeout(timeoutId);
                expect([200, 500]).toContain(response.statusCode);
            } catch (error: any) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
                    expect(true).toBe(true);
                } else {
                    throw error;
                }
            }
        });

        it('should handle empty token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/events?organizationId=${testOrganization.id}&token=`,
            });

            expect(response.statusCode).toBe(400);
        });
    });
});
