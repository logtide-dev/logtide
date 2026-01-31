import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import correlationRoutes from '../../../modules/correlation/routes.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';
import crypto from 'crypto';

// Helper to create a session for a user
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

describe('Correlation Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();

        // Add auth decorator
        app.decorateRequest('user', null);
        app.decorateRequest('projectId', null);

        // Add simple auth hook
        app.addHook('preHandler', async (request: any) => {
            const authHeader = request.headers.authorization;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const session = await db
                    .selectFrom('sessions')
                    .innerJoin('users', 'users.id', 'sessions.user_id')
                    .select(['users.id', 'users.email', 'users.name'])
                    .where('sessions.token', '=', token)
                    .where('sessions.expires_at', '>', new Date())
                    .executeTakeFirst();

                if (session) {
                    request.user = session;
                }
            }
        });

        await app.register(correlationRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await db.deleteFrom('log_identifiers').execute();
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

    describe('Authentication', () => {
        it('should return 401 when no auth token provided for correlation', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/v1/correlation/test-id?projectId=${testProject.id}`,
            });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Authentication required');
        });

        it('should return 401 when no auth token provided for log identifiers', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/logs/some-log-id/identifiers',
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 401 when no auth token provided for batch identifiers', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/logs/identifiers/batch',
                payload: { logIds: ['log-1'] },
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('GET /v1/correlation/:identifierValue', () => {
        it('should return correlated logs', async () => {
            const log1 = await createTestLog({ projectId: testProject.id });
            const log2 = await createTestLog({ projectId: testProject.id });

            // Store identifiers
            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log1.id,
                        log_time: log1.time,
                        project_id: testProject.id,
                        organization_id: testOrganization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'test-request-123',
                        source_field: 'message',
                    },
                    {
                        log_id: log2.id,
                        log_time: log2.time,
                        project_id: testProject.id,
                        organization_id: testOrganization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'test-request-123',
                        source_field: 'message',
                    },
                ])
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/v1/correlation/test-request-123?projectId=${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.logs.length).toBe(2);
        });

        it('should return 403 for unauthorized project', async () => {
            // Use a valid UUID format for a project that doesn't exist
            const response = await app.inject({
                method: 'GET',
                url: `/v1/correlation/test-id?projectId=00000000-0000-0000-0000-000000000000`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return empty result for unknown identifier', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/v1/correlation/unknown-id?projectId=${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.logs.length).toBe(0);
        });

        it('should respect limit parameter', async () => {
            // Create multiple logs
            for (let i = 0; i < 10; i++) {
                const log = await createTestLog({ projectId: testProject.id });
                await db
                    .insertInto('log_identifiers')
                    .values({
                        log_id: log.id,
                        log_time: log.time,
                        project_id: testProject.id,
                        organization_id: testOrganization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'shared-request',
                        source_field: 'message',
                    })
                    .execute();
            }

            const response = await app.inject({
                method: 'GET',
                url: `/v1/correlation/shared-request?projectId=${testProject.id}&limit=5`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.logs.length).toBe(5);
        });

        it('should cap limit at 100', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/v1/correlation/test?projectId=${testProject.id}&limit=200`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            // Limit is capped internally, no error
        });

        it('should decode URL-encoded identifier', async () => {
            const log = await createTestLog({ projectId: testProject.id });
            await db
                .insertInto('log_identifiers')
                .values({
                    log_id: log.id,
                    log_time: log.time,
                    project_id: testProject.id,
                    organization_id: testOrganization.id,
                    identifier_type: 'request_id',
                    identifier_value: 'request/with/slashes',
                    source_field: 'message',
                })
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/v1/correlation/${encodeURIComponent('request/with/slashes')}?projectId=${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.identifier.value).toBe('request/with/slashes');
        });
    });

    describe('GET /v1/logs/:logId/identifiers', () => {
        it('should return identifiers for a log', async () => {
            const log = await createTestLog({ projectId: testProject.id });

            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log.id,
                        log_time: log.time,
                        project_id: testProject.id,
                        organization_id: testOrganization.id,
                        identifier_type: 'uuid',
                        identifier_value: '123e4567-e89b-12d3-a456-426614174000',
                        source_field: 'message',
                    },
                    {
                        log_id: log.id,
                        log_time: log.time,
                        project_id: testProject.id,
                        organization_id: testOrganization.id,
                        identifier_type: 'user_id',
                        identifier_value: 'usr_123',
                        source_field: 'metadata.user_id',
                    },
                ])
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/v1/logs/${log.id}/identifiers`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.identifiers.length).toBe(2);
        });

        it('should return 404 for nonexistent log', async () => {
            // Use a valid UUID format that doesn't exist
            const response = await app.inject({
                method: 'GET',
                url: `/v1/logs/00000000-0000-0000-0000-000000000000/identifiers`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return empty array for log with no identifiers', async () => {
            const log = await createTestLog({ projectId: testProject.id });

            const response = await app.inject({
                method: 'GET',
                url: `/v1/logs/${log.id}/identifiers`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.identifiers.length).toBe(0);
        });
    });

    describe('POST /v1/logs/identifiers/batch', () => {
        it('should return identifiers for multiple logs', async () => {
            const log1 = await createTestLog({ projectId: testProject.id });
            const log2 = await createTestLog({ projectId: testProject.id });

            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log1.id,
                        log_time: log1.time,
                        project_id: testProject.id,
                        organization_id: testOrganization.id,
                        identifier_type: 'uuid',
                        identifier_value: 'uuid-1',
                        source_field: 'message',
                    },
                    {
                        log_id: log2.id,
                        log_time: log2.time,
                        project_id: testProject.id,
                        organization_id: testOrganization.id,
                        identifier_type: 'uuid',
                        identifier_value: 'uuid-2',
                        source_field: 'message',
                    },
                ])
                .execute();

            const response = await app.inject({
                method: 'POST',
                url: '/v1/logs/identifiers/batch',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    logIds: [log1.id, log2.id],
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(Object.keys(body.data.identifiers).length).toBe(2);
        });

        it('should return empty object for empty logIds array', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/logs/identifiers/batch',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    logIds: [],
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.identifiers).toEqual({});
        });

        it('should return 400 for batch exceeding 100 items', async () => {
            const logIds = Array.from({ length: 101 }, (_, i) => `log-${i}`);

            const response = await app.inject({
                method: 'POST',
                url: '/v1/logs/identifiers/batch',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    logIds,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return empty for nonexistent logs', async () => {
            // Use valid UUID formats that don't exist
            const response = await app.inject({
                method: 'POST',
                url: '/v1/logs/identifiers/batch',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    logIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.identifiers).toEqual({});
        });

        it('should only return identifiers for accessible logs', async () => {
            // Create log in test project
            const log = await createTestLog({ projectId: testProject.id });

            await db
                .insertInto('log_identifiers')
                .values({
                    log_id: log.id,
                    log_time: log.time,
                    project_id: testProject.id,
                    organization_id: testOrganization.id,
                    identifier_type: 'uuid',
                    identifier_value: 'uuid-1',
                    source_field: 'message',
                })
                .execute();

            const response = await app.inject({
                method: 'POST',
                url: '/v1/logs/identifiers/batch',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    logIds: [log.id],
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.identifiers[log.id]).toBeDefined();
        });

        it('should return 403 when user has no access to logs project', async () => {
            // Create another user without org membership
            const otherUser = await db
                .insertInto('users')
                .values({
                    email: 'unauthorized@example.com',
                    password_hash: 'hash',
                    name: 'Unauthorized User',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const otherSession = await createTestSession(otherUser.id);

            // Create log in test project
            const log = await createTestLog({ projectId: testProject.id });

            const response = await app.inject({
                method: 'POST',
                url: '/v1/logs/identifiers/batch',
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
                payload: {
                    logIds: [log.id],
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /v1/logs/:logId/identifiers access control', () => {
        it('should return 403 when user has no access to log project', async () => {
            // Create another user without org membership
            const otherUser = await db
                .insertInto('users')
                .values({
                    email: 'noaccess@example.com',
                    password_hash: 'hash',
                    name: 'No Access User',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const otherSession = await createTestSession(otherUser.id);

            // Create log in test project
            const log = await createTestLog({ projectId: testProject.id });

            const response = await app.inject({
                method: 'GET',
                url: `/v1/logs/${log.id}/identifiers`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });
});
