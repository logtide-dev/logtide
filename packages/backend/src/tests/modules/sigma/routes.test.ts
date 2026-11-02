import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { sigmaRoutes } from '../../../modules/sigma/routes.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';
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

const VALID_SIGMA_YAML = `
title: Test Rule
status: stable
level: medium
logsource:
    product: linux
detection:
    selection:
        message|contains: 'suspicious'
    condition: selection
`;

describe('Sigma Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(sigmaRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await db.deleteFrom('detection_events').execute();
        await db.deleteFrom('sigma_rules').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('alert_rules').execute();
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
    // Authentication
    // =========================================================================

    describe('Authentication', () => {
        it('should return 401 without auth', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/rules?organizationId=${testOrganization.id}`,
            });
            expect(res.statusCode).toBe(401);
        });
    });

    // =========================================================================
    // POST /api/v1/sigma/import
    // =========================================================================

    describe('POST /api/v1/sigma/import', () => {
        it('should import a valid sigma YAML', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/sigma/import',
                headers: authHeaders(),
                payload: {
                    yaml: VALID_SIGMA_YAML,
                    organizationId: testOrganization.id,
                    createAlertRule: false,
                },
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.sigmaRule).toBeDefined();
            expect(body.sigmaRule.title).toBe('Test Rule');
        });

        it('should return 403 when not a member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'other@test.com', name: 'Other', password_hash: 'hash' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const otherSession = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/sigma/import',
                headers: { Authorization: `Bearer ${otherSession.token}` },
                payload: {
                    yaml: VALID_SIGMA_YAML,
                    organizationId: testOrganization.id,
                },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return 400 for missing yaml', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/sigma/import',
                headers: authHeaders(),
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 400 for invalid YAML content', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/sigma/import',
                headers: authHeaders(),
                payload: {
                    yaml: 'not valid sigma yaml: }{',
                    organizationId: testOrganization.id,
                },
            });

            expect(res.statusCode).toBe(400);
        });

        it('should import with channelIds', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/sigma/import',
                headers: authHeaders(),
                payload: {
                    yaml: VALID_SIGMA_YAML,
                    organizationId: testOrganization.id,
                    createAlertRule: false,
                    channelIds: [],
                },
            });

            expect(res.statusCode).toBe(200);
        });
    });

    // =========================================================================
    // GET /api/v1/sigma/rules
    // =========================================================================

    describe('GET /api/v1/sigma/rules', () => {
        it('should list rules for an organization', async () => {
            await createTestSigmaRule({
                organizationId: testOrganization.id,
            });

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(Array.isArray(body.rules)).toBe(true);
            expect(body.rules.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nm@test.com', name: 'NM', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/rules?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return 400 for missing organizationId', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/sigma/rules',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(400);
        });
    });

    // =========================================================================
    // GET /api/v1/sigma/rules/:id
    // =========================================================================

    describe('GET /api/v1/sigma/rules/:id', () => {
        it('should get a specific rule', async () => {
            const rule = await createTestSigmaRule({
                organizationId: testOrganization.id,
            });

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/rules/${rule.id}?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.rule.id).toBe(rule.id);
        });

        it('should return 404 for non-existent rule', async () => {
            const fakeId = crypto.randomUUID();
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/rules/${fakeId}?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(404);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nm2@test.com', name: 'NM2', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const fakeId = crypto.randomUUID();
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/rules/${fakeId}?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });
    });

    // =========================================================================
    // PATCH /api/v1/sigma/rules/:id
    // =========================================================================

    describe('PATCH /api/v1/sigma/rules/:id', () => {
        it('should toggle rule enabled state', async () => {
            const rule = await createTestSigmaRule({
                organizationId: testOrganization.id,
            });

            const res = await app.inject({
                method: 'PATCH',
                url: `/api/v1/sigma/rules/${rule.id}`,
                headers: authHeaders(),
                payload: {
                    organizationId: testOrganization.id,
                    enabled: false,
                },
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.rule).toBeDefined();
        });

        it('should return 400 when no update fields provided', async () => {
            const rule = await createTestSigmaRule({
                organizationId: testOrganization.id,
            });

            const res = await app.inject({
                method: 'PATCH',
                url: `/api/v1/sigma/rules/${rule.id}`,
                headers: authHeaders(),
                payload: {
                    organizationId: testOrganization.id,
                },
            });

            expect(res.statusCode).toBe(400);
            const body = JSON.parse(res.payload);
            expect(body.error).toContain('No update fields');
        });

        it('should return 404 for non-existent rule (enabled update)', async () => {
            const fakeId = crypto.randomUUID();
            const res = await app.inject({
                method: 'PATCH',
                url: `/api/v1/sigma/rules/${fakeId}`,
                headers: authHeaders(),
                payload: {
                    organizationId: testOrganization.id,
                    enabled: true,
                },
            });

            expect(res.statusCode).toBe(404);
        });

        it('should return 404 for non-existent rule (channelIds only)', async () => {
            const fakeId = crypto.randomUUID();
            const res = await app.inject({
                method: 'PATCH',
                url: `/api/v1/sigma/rules/${fakeId}`,
                headers: authHeaders(),
                payload: {
                    organizationId: testOrganization.id,
                    channelIds: [],
                },
            });

            expect(res.statusCode).toBe(404);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nm3@test.com', name: 'NM3', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const fakeId = crypto.randomUUID();
            const res = await app.inject({
                method: 'PATCH',
                url: `/api/v1/sigma/rules/${fakeId}`,
                headers: { Authorization: `Bearer ${session.token}` },
                payload: {
                    organizationId: testOrganization.id,
                    enabled: true,
                },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should update channelIds for existing rule', async () => {
            const rule = await createTestSigmaRule({
                organizationId: testOrganization.id,
            });

            const res = await app.inject({
                method: 'PATCH',
                url: `/api/v1/sigma/rules/${rule.id}`,
                headers: authHeaders(),
                payload: {
                    organizationId: testOrganization.id,
                    channelIds: [],
                },
            });

            expect(res.statusCode).toBe(200);
        });
    });

    // =========================================================================
    // DELETE /api/v1/sigma/rules/:id
    // =========================================================================

    describe('DELETE /api/v1/sigma/rules/:id', () => {
        it('should delete a rule', async () => {
            const rule = await createTestSigmaRule({
                organizationId: testOrganization.id,
            });

            const res = await app.inject({
                method: 'DELETE',
                url: `/api/v1/sigma/rules/${rule.id}?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.success).toBe(true);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nm4@test.com', name: 'NM4', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const fakeId = crypto.randomUUID();
            const res = await app.inject({
                method: 'DELETE',
                url: `/api/v1/sigma/rules/${fakeId}?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should pass deleteAlertRule parameter', async () => {
            const rule = await createTestSigmaRule({
                organizationId: testOrganization.id,
            });

            const res = await app.inject({
                method: 'DELETE',
                url: `/api/v1/sigma/rules/${rule.id}?organizationId=${testOrganization.id}&deleteAlertRule=true`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
        });
    });

    // =========================================================================
    // GET /api/v1/sigma/sync/status
    // =========================================================================

    describe('GET /api/v1/sigma/sync/status', () => {
        it('should get sync status', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/sync/status?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nm5@test.com', name: 'NM5', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/sync/status?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });
    });

    // =========================================================================
    // GET /api/v1/sigma/mitre/tactics
    // =========================================================================

    describe('GET /api/v1/sigma/mitre/tactics', () => {
        it('should list all MITRE tactics', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/sigma/mitre/tactics',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.tactics).toBeDefined();
            expect(Array.isArray(body.tactics)).toBe(true);
        });
    });

    // =========================================================================
    // GET /api/v1/sigma/mitre/techniques/:technique
    // =========================================================================

    describe('GET /api/v1/sigma/mitre/techniques/:technique', () => {
        it('should search by MITRE technique (returns results or 500 from jsonb cast)', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/mitre/techniques/T1059?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            // The sync service uses @> jsonb operator on text[] columns
            // which may fail on some DB versions. Accept both 200 and 500.
            expect(res.statusCode).toBe(200);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nm6@test.com', name: 'NM6', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/mitre/techniques/T1059?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });
    });

    // =========================================================================
    // GET /api/v1/sigma/mitre/tactics/:tactic
    // =========================================================================

    describe('GET /api/v1/sigma/mitre/tactics/:tactic', () => {
        it('should search by MITRE tactic (returns results or 500 from jsonb cast)', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/mitre/tactics/execution?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            // The sync service uses @> jsonb operator on text[] columns
            // which may fail on some DB versions. Accept both 200 and 500.
            expect(res.statusCode).toBe(200);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nm7@test.com', name: 'NM7', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sigma/mitre/tactics/execution?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });
    });
});
