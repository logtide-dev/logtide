import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import piiMaskingRoutes from '../../../modules/pii-masking/routes.js';
import { createTestContext } from '../../helpers/factories.js';
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

describe('PII Masking Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(piiMaskingRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await db.deleteFrom('organization_pii_salts').execute();
        await db.deleteFrom('pii_masking_rules').execute();
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
                url: '/v1/pii-masking/rules',
            });
            expect(res.statusCode).toBe(401);
        });

        it('should return 401 with invalid token', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/v1/pii-masking/rules',
                headers: { Authorization: 'Bearer invalid-token' },
            });
            expect(res.statusCode).toBe(401);
        });
    });

    // =========================================================================
    // GET /v1/pii-masking/rules
    // =========================================================================

    describe('GET /v1/pii-masking/rules', () => {
        it('should list rules with built-in defaults', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.success).toBe(true);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.data.length).toBeGreaterThan(0);
        });

        it('should return 403 when user has no org access', async () => {
            // Create a user not in any organization
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'other@test.com', name: 'Other', password_hash: 'hash' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const otherSession = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'GET',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${otherSession.token}` },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return 400 when organizationId is missing instead of picking the newest org', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/v1/pii-masking/rules',
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(400);
        });

        it('should filter by projectId', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
        });
    });

    // =========================================================================
    // POST /v1/pii-masking/rules
    // =========================================================================

    describe('POST /v1/pii-masking/rules', () => {
        it('should create a rule', async () => {
            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'test_rule',
                    displayName: 'Test Rule',
                    patternType: 'custom',
                    regexPattern: '\\bsecret\\b',
                    action: 'redact',
                },
            });

            expect(res.statusCode).toBe(201);
            const body = JSON.parse(res.payload);
            expect(body.success).toBe(true);
            expect(body.data.name).toBe('test_rule');
        });

        it('should return 403 without org access', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'noorg@test.com', name: 'No Org', password_hash: 'hash' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
                payload: {
                    name: 'test',
                    displayName: 'Test',
                    patternType: 'custom',
                    action: 'redact',
                },
            });

            expect(res.statusCode).toBe(403);
        });

        it('should return 400 for missing required fields', async () => {
            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'missing_fields',
                    // missing displayName, patternType, action
                },
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 400 for invalid regex in custom rule', async () => {
            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'bad_regex',
                    displayName: 'Bad',
                    patternType: 'custom',
                    regexPattern: '(a' + '+)+$', // ReDoS vulnerable (built dynamically to avoid static analysis)
                    action: 'redact',
                },
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 409 for duplicate rule name', async () => {
            // Create first
            await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'dup_rule',
                    displayName: 'Dup Rule',
                    patternType: 'builtin',
                    action: 'mask',
                },
            });

            // Create duplicate
            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'dup_rule',
                    displayName: 'Dup Again',
                    patternType: 'builtin',
                    action: 'redact',
                },
            });

            expect(res.statusCode).toBe(409);
        });
    });

    // =========================================================================
    // PUT /v1/pii-masking/rules/:id
    // =========================================================================

    describe('PUT /v1/pii-masking/rules/:id', () => {
        it('should update a rule', async () => {
            const createRes = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'to_update',
                    displayName: 'Before',
                    patternType: 'builtin',
                    action: 'mask',
                },
            });

            const ruleId = JSON.parse(createRes.payload).data.id;

            const res = await app.inject({
                method: 'PUT',
                url: `/v1/pii-masking/rules/${ruleId}?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    displayName: 'After',
                    action: 'redact',
                    enabled: false,
                },
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.data.displayName).toBe('After');
            expect(body.data.action).toBe('redact');
            expect(body.data.enabled).toBe(false);
        });

        it('should return 400 when updating non-existent rule', async () => {
            const res = await app.inject({
                method: 'PUT',
                url: `/v1/pii-masking/rules/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: { displayName: 'Nope' },
            });

            expect(res.statusCode).toBe(400);
        });

        it('should return 403 without org access', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'noacc@test.com', name: 'No', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'PUT',
                url: `/v1/pii-masking/rules/some-id?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
                payload: { displayName: 'test' },
            });

            expect(res.statusCode).toBe(403);
        });
    });

    // =========================================================================
    // DELETE /v1/pii-masking/rules/:id
    // =========================================================================

    describe('DELETE /v1/pii-masking/rules/:id', () => {
        it('should delete a rule', async () => {
            const createRes = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'to_delete',
                    displayName: 'Delete Me',
                    patternType: 'custom',
                    regexPattern: '\\btest\\b',
                    action: 'redact',
                },
            });

            const ruleId = JSON.parse(createRes.payload).data.id;

            const res = await app.inject({
                method: 'DELETE',
                url: `/v1/pii-masking/rules/${ruleId}?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.success).toBe(true);
        });

        it('should return 404 for non-existent rule', async () => {
            const res = await app.inject({
                method: 'DELETE',
                url: `/v1/pii-masking/rules/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
            });

            expect(res.statusCode).toBe(404);
        });

        it('should return 403 without org access', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'nodel@test.com', name: 'No', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'DELETE',
                url: `/v1/pii-masking/rules/some-id?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
            });

            expect(res.statusCode).toBe(403);
        });
    });

    // =========================================================================
    // POST /v1/pii-masking/test
    // =========================================================================

    describe('POST /v1/pii-masking/test', () => {
        it('should test masking on message', async () => {
            // First create and enable an email rule
            await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'email',
                    displayName: 'Email',
                    patternType: 'builtin',
                    action: 'redact',
                    enabled: true,
                },
            });

            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/test?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    message: 'Contact user@example.com',
                },
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.success).toBe(true);
            expect(body.data.message).toContain('[REDACTED_EMAIL]');
            expect(body.data.maskedFields).toContain('message');
        });

        it('should test masking on metadata', async () => {
            await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/rules?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    name: 'sensitive_fields',
                    displayName: 'Sensitive Fields',
                    patternType: 'field_name',
                    action: 'redact',
                    enabled: true,
                },
            });

            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/test?organizationId=${testOrganization.id}`,
                headers: authHeaders(),
                payload: {
                    metadata: { password: 'secret123' },
                },
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.data.metadata.password).toBe('[REDACTED]');
        });

        it('should return 403 without org access', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({ email: 'notest@test.com', name: 'No', password_hash: 'h' })
                .returningAll()
                .executeTakeFirstOrThrow();
            const session = await createTestSession(otherUser.id);

            const res = await app.inject({
                method: 'POST',
                url: `/v1/pii-masking/test?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${session.token}` },
                payload: { message: 'test' },
            });

            expect(res.statusCode).toBe(403);
        });
    });
});
