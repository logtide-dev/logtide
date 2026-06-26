import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import dashboardRoutes from '../../../modules/dashboard/routes.js';
import {
    createTestContext,
    createTestLog,
    createTestUser,
    createTestOrganization,
    createTestProject,
    createTestApiKey,
} from '../../helpers/factories.js';
import crypto from 'crypto';

async function createTestSession(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

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

describe('Dashboard Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        // Dashboard routes don't use authenticate middleware directly,
        // but rely on request.user being set. We register the routes and
        // add a mock auth hook that sets request.user from the session.
        app.addHook('onRequest', async (request: any) => {
            // API-key auth: mirror the real auth plugin - bind project/org from the
            // key, do NOT set request.user.
            const apiKey = request.headers['x-api-key'];
            if (apiKey) {
                const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
                const row = await db
                    .selectFrom('api_keys')
                    .innerJoin('projects', 'projects.id', 'api_keys.project_id')
                    .select(['api_keys.project_id', 'api_keys.type', 'projects.organization_id'])
                    .where('api_keys.key_hash', '=', keyHash)
                    .executeTakeFirst();
                if (row) {
                    request.projectId = row.project_id;
                    request.organizationId = row.organization_id;
                    request.apiKeyType = row.type;
                }
                return;
            }

            const authHeader = request.headers.authorization;
            if (!authHeader) return;

            const token = authHeader.replace('Bearer ', '');
            const session = await db
                .selectFrom('sessions')
                .select(['user_id'])
                .where('token', '=', token)
                .where('expires_at', '>', new Date())
                .executeTakeFirst();

            if (session) {
                request.user = { id: session.user_id };
            }
        });
        await app.register(dashboardRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();

        const context = await createTestContext();
        testUser = context.user;
        testOrganization = context.organization;
        testProject = context.project;

        const session = await createTestSession(testUser.id);
        authToken = session.token;
    });

    function authHeaders() {
        return { Authorization: `Bearer ${authToken}` };
    }

    // =========================================================================
    // GET /api/v1/dashboard/stats
    // =========================================================================

    describe('GET /api/v1/dashboard/stats', () => {
        it('should return stats for the organization', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.totalLogsToday).toBeDefined();
            expect(body.errorRate).toBeDefined();
            expect(body.activeServices).toBeDefined();
            expect(body.avgThroughput).toBeDefined();
        });

        it('should return 400 for missing organizationId', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/dashboard/stats',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 403 when user is not a member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'other@test.com', name: 'Other', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return zeros when no logs exist', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            const body = JSON.parse(res.payload);
            expect(body.totalLogsToday.value).toBe(0);
        });

        it('should count logs correctly', async () => {
            await createTestLog({ projectId: testProject.id, level: 'info' });
            await createTestLog({ projectId: testProject.id, level: 'error' });

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            const body = JSON.parse(res.payload);
            expect(body.totalLogsToday.value).toBe(2);
        });
    });

    // =========================================================================
    // GET /api/v1/dashboard/timeseries
    // =========================================================================

    describe('GET /api/v1/dashboard/timeseries', () => {
        it('should return timeseries data', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeseries?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.timeseries).toBeDefined();
            expect(Array.isArray(body.timeseries)).toBe(true);
        });

        it('should return 400 for missing organizationId', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/dashboard/timeseries',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 403 when user is not a member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'ts@test.com', name: 'TS', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeseries?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return empty for org with no logs', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeseries?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            const body = JSON.parse(res.payload);
            expect(body.timeseries.length).toBe(0);
        });
    });

    // =========================================================================
    // GET /api/v1/dashboard/top-services
    // =========================================================================

    describe('GET /api/v1/dashboard/top-services', () => {
        it('should return top services', async () => {
            await createTestLog({ projectId: testProject.id, service: 'api' });
            await createTestLog({ projectId: testProject.id, service: 'worker' });

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/top-services?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.services).toBeDefined();
            expect(Array.isArray(body.services)).toBe(true);
        });

        it('should respect limit parameter', async () => {
            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId: testProject.id, service: `svc-${i}` });
            }

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/top-services?organizationId=${testOrganization.id}&limit=2`,
                headers: authHeaders(),
            });

            const body = JSON.parse(res.payload);
            expect(body.services.length).toBeLessThanOrEqual(2);
        });

        it('should return 400 for missing organizationId', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/dashboard/top-services',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 403 when user is not a member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'svc@test.com', name: 'SVC', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/top-services?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });
    });

    // =========================================================================
    // GET /api/v1/dashboard/recent-errors
    // =========================================================================

    describe('GET /api/v1/dashboard/recent-errors', () => {
        it('should return recent errors', async () => {
            await createTestLog({ projectId: testProject.id, level: 'error', message: 'Something broke' });
            await createTestLog({ projectId: testProject.id, level: 'critical', message: 'Total failure' });

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/recent-errors?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.errors).toBeDefined();
            expect(body.errors.length).toBe(2);
        });

        it('should not include info/debug/warn logs', async () => {
            await createTestLog({ projectId: testProject.id, level: 'info' });
            await createTestLog({ projectId: testProject.id, level: 'debug' });
            await createTestLog({ projectId: testProject.id, level: 'warn' });

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/recent-errors?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            const body = JSON.parse(res.payload);
            expect(body.errors.length).toBe(0);
        });

        it('should return 400 for missing organizationId', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/dashboard/recent-errors',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 403 when user is not a member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'err@test.com', name: 'ERR', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/recent-errors?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return empty when no errors exist', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/recent-errors?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            const body = JSON.parse(res.payload);
            expect(body.errors.length).toBe(0);
        });
    });

    // =========================================================================
    // GET /api/v1/dashboard/timeline-events
    // =========================================================================

    describe('GET /api/v1/dashboard/timeline-events', () => {
        it('should return timeline events', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeline-events?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.events).toBeDefined();
            expect(Array.isArray(body.events)).toBe(true);
        });

        it('should return 400 for missing organizationId', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/dashboard/timeline-events',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 403 when user is not a member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'tl@test.com', name: 'TL', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeline-events?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return empty events for org with no alerts or detections', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeline-events?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            const body = JSON.parse(res.payload);
            expect(body.events.length).toBe(0);
        });
    });

    // =========================================================================
    // projectId scoping - verifyProjectBelongsToOrg branch
    // =========================================================================

    describe('projectId parameter scoping', () => {
        it('stats: returns 200 with projectId scoped to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(200);
        });

        it('stats: returns 404 when projectId does not belong to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}&projectId=00000000-0000-0000-0000-000000000000`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(404);
        });

        it('timeseries: returns 200 with projectId scoped to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeseries?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(200);
        });

        it('timeseries: returns 404 when projectId does not belong to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeseries?organizationId=${testOrganization.id}&projectId=00000000-0000-0000-0000-000000000000`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(404);
        });

        it('top-services: returns 200 with projectId scoped to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/top-services?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(200);
        });

        it('top-services: returns 404 when projectId does not belong to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/top-services?organizationId=${testOrganization.id}&projectId=00000000-0000-0000-0000-000000000000`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(404);
        });

        it('timeline-events: returns 200 with projectId scoped to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/timeline-events?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(200);
        });

        it('recent-errors: returns 200 with projectId scoped to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/recent-errors?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(200);
        });

        it('recent-errors: returns 404 when projectId does not belong to the org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/recent-errors?organizationId=${testOrganization.id}&projectId=00000000-0000-0000-0000-000000000000`,
                headers: authHeaders(),
            });
            expect(res.statusCode).toBe(404);
        });
    });

    // =========================================================================
    // API-key tenant isolation (regression for cross-tenant dashboard access)
    //
    // A full-access API key is PROJECT-scoped. It must only read its own org's
    // (and project's) dashboard data, never another organization's, regardless
    // of the organizationId/projectId passed in the query string.
    // =========================================================================
    describe('API-key tenant isolation', () => {
        const ENDPOINTS = [
            '/api/v1/dashboard/stats',
            '/api/v1/dashboard/timeseries',
            '/api/v1/dashboard/top-services',
            '/api/v1/dashboard/timeline-events',
            '/api/v1/dashboard/recent-errors',
            '/api/v1/dashboard/activity-overview',
        ];

        async function buildOtherOrg() {
            const owner = await createTestUser();
            const org = await createTestOrganization({ ownerId: owner.id });
            const project = await createTestProject({ organizationId: org.id, userId: owner.id });
            const apiKey = await createTestApiKey({ projectId: project.id });
            return { org, project, apiKey };
        }

        it('rejects a key bound to org A reading org B with 403 on every endpoint', async () => {
            // testOrganization is org A; its key:
            const orgAKey = await createTestApiKey({ projectId: testProject.id });
            const other = await buildOtherOrg(); // org B

            for (const url of ENDPOINTS) {
                const res = await app.inject({
                    method: 'GET',
                    url: `${url}?organizationId=${other.org.id}`,
                    headers: { 'x-api-key': orgAKey.plainKey },
                });
                expect(res.statusCode, `${url} should be 403`).toBe(403);
            }
        });

        it('rejects a key reading another org even when its own projectId is passed', async () => {
            const orgAKey = await createTestApiKey({ projectId: testProject.id });
            const other = await buildOtherOrg();

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${other.org.id}&projectId=${testProject.id}`,
                headers: { 'x-api-key': orgAKey.plainKey },
            });
            expect(res.statusCode).toBe(403);
        });

        it('rejects a key passing a foreign projectId within its own org with 403', async () => {
            const orgAKey = await createTestApiKey({ projectId: testProject.id });
            const other = await buildOtherOrg();

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}&projectId=${other.project.id}`,
                headers: { 'x-api-key': orgAKey.plainKey },
            });
            expect(res.statusCode).toBe(403);
        });

        it('allows a key to read its own organization', async () => {
            const orgAKey = await createTestApiKey({ projectId: testProject.id });

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}`,
                headers: { 'x-api-key': orgAKey.plainKey },
            });
            expect(res.statusCode).toBe(200);
        });

        it('scopes a key to its own project: only its project data is counted', async () => {
            // Second project in the same org with its own logs.
            const otherProject = await createTestProject({
                organizationId: testOrganization.id,
                userId: testUser.id,
            });
            await createTestLog({ projectId: otherProject.id, level: 'info' });
            await createTestLog({ projectId: testProject.id, level: 'info' });

            const orgAKey = await createTestApiKey({ projectId: testProject.id });

            // No projectId in query: must default to the key's bound project,
            // so only the single log in testProject is counted (not both).
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/dashboard/stats?organizationId=${testOrganization.id}`,
                headers: { 'x-api-key': orgAKey.plainKey },
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.totalLogsToday.value).toBe(1);
        });
    });
});
