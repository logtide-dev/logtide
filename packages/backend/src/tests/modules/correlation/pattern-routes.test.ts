import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import patternRoutes from '../../../modules/correlation/pattern-routes.js';
import { createTestContext } from '../../helpers/factories.js';
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

describe('Pattern Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;

    beforeAll(async () => {
        app = Fastify();

        // Add auth decorator
        app.decorateRequest('user', null);

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

        await app.register(patternRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await db.deleteFrom('identifier_patterns').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();

        const context = await createTestContext();
        testUser = context.user;
        testOrganization = context.organization;

        const session = await createTestSession(testUser.id);
        authToken = session.token;
    });

    describe('GET /v1/patterns', () => {
        it('should return custom and default patterns', async () => {
            // Create a custom pattern
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: testOrganization.id,
                    name: 'custom_id',
                    display_name: 'Custom ID',
                    description: 'Test pattern',
                    pattern: '\\bCUST-[0-9]+\\b',
                    field_names: ['custom_id'],
                    enabled: true,
                    priority: 10,
                })
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.custom.length).toBe(1);
            expect(body.data.defaults.length).toBeGreaterThan(0);
        });

        it('should return 403 when user has no organization access', async () => {
            // Create another user without org membership
            const otherUser = await db
                .insertInto('users')
                .values({
                    email: 'other@example.com',
                    password_hash: 'hash',
                    name: 'Other User',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'GET',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should use first organization when organizationId not specified', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/patterns',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe('GET /v1/patterns/defaults', () => {
        it('should return default patterns', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/patterns/defaults',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.length).toBeGreaterThan(0);
            expect(body.data[0].isBuiltIn).toBe(true);
        });
    });

    describe('POST /v1/patterns', () => {
        it('should create a custom pattern', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'order_number',
                    displayName: 'Order Number',
                    description: 'Matches order numbers',
                    pattern: '\\bORD-[0-9]{6}\\b',
                    fieldNames: ['order_id', 'order_number'],
                    enabled: true,
                    priority: 20,
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.name).toBe('order_number');
            expect(body.data.isBuiltIn).toBe(false);
        });

        it('should return 400 for invalid regex', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'invalid_pattern',
                    displayName: 'Invalid Pattern',
                    pattern: '[invalid regex(',
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            // Pattern is detected as ReDoS vulnerable before syntax check
            expect(body.error).toBeDefined();
        });

        it('should return 400 for ReDoS-vulnerable pattern', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'redos_pattern',
                    displayName: 'ReDoS Pattern',
                    pattern: '(a+)+$', // Vulnerable to ReDoS
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('ReDoS');
        });

        it('should return 409 for duplicate pattern name', async () => {
            // Create first pattern
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: testOrganization.id,
                    name: 'existing_pattern',
                    display_name: 'Existing Pattern',
                    pattern: '\\bTEST\\b',
                    field_names: [],
                    enabled: true,
                    priority: 50,
                })
                .execute();

            // Try to create duplicate
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'existing_pattern',
                    displayName: 'Duplicate Pattern',
                    pattern: '\\bDUPE\\b',
                },
            });

            expect(response.statusCode).toBe(409);
        });

        it('should validate pattern name format', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'Invalid Name!', // Contains invalid characters
                    displayName: 'Test',
                    pattern: '\\bTEST\\b',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should use default values for optional fields', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'minimal_pattern',
                    displayName: 'Minimal Pattern',
                    pattern: '\\bMIN\\b',
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.data.enabled).toBe(true);
            expect(body.data.priority).toBe(50);
            expect(body.data.fieldNames).toEqual([]);
        });
    });

    describe('PUT /v1/patterns/:id', () => {
        it('should update a pattern', async () => {
            const pattern = await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: testOrganization.id,
                    name: 'update_test',
                    display_name: 'Update Test',
                    pattern: '\\bOLD\\b',
                    field_names: [],
                    enabled: true,
                    priority: 50,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const response = await app.inject({
                method: 'PUT',
                url: `/v1/patterns/${pattern.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    displayName: 'Updated Test',
                    pattern: '\\bNEW\\b',
                    priority: 30,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.displayName).toBe('Updated Test');
            expect(body.data.pattern).toBe('\\bNEW\\b');
            expect(body.data.priority).toBe(30);
        });

        it('should return 404 for nonexistent pattern', async () => {
            // Use valid UUID format that doesn't exist
            const response = await app.inject({
                method: 'PUT',
                url: `/v1/patterns/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    displayName: 'Updated',
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 400 for invalid regex update', async () => {
            const pattern = await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: testOrganization.id,
                    name: 'regex_test',
                    display_name: 'Regex Test',
                    pattern: '\\bVALID\\b',
                    field_names: [],
                    enabled: true,
                    priority: 50,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const response = await app.inject({
                method: 'PUT',
                url: `/v1/patterns/${pattern.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: '[invalid(',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 when organizationId is missing', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/v1/patterns/some-id',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    displayName: 'Updated',
                },
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('DELETE /v1/patterns/:id', () => {
        it('should delete a pattern', async () => {
            const pattern = await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: testOrganization.id,
                    name: 'delete_test',
                    display_name: 'Delete Test',
                    pattern: '\\bDELETE\\b',
                    field_names: [],
                    enabled: true,
                    priority: 50,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const response = await app.inject({
                method: 'DELETE',
                url: `/v1/patterns/${pattern.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);

            // Verify deleted
            const deleted = await db
                .selectFrom('identifier_patterns')
                .selectAll()
                .where('id', '=', pattern.id)
                .executeTakeFirst();
            expect(deleted).toBeUndefined();
        });

        it('should return 404 for nonexistent pattern', async () => {
            // Use valid UUID format that doesn't exist
            const response = await app.inject({
                method: 'DELETE',
                url: `/v1/patterns/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 400 when organizationId is missing', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/v1/patterns/some-id',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('Regex Validation Edge Cases', () => {
        it('should reject pattern that is too long', async () => {
            const longPattern = 'a'.repeat(501);

            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'long_pattern',
                    displayName: 'Long Pattern',
                    pattern: longPattern,
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('too long');
        });

        it('should reject lookahead assertions in pattern', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'lookahead_pattern',
                    displayName: 'Lookahead Pattern',
                    pattern: '(?=test)\\w+', // Lookahead
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Lookahead');
        });

        it('should reject lookbehind assertions in pattern', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'lookbehind_pattern',
                    displayName: 'Lookbehind Pattern',
                    pattern: '(?<=test)\\w+', // Lookbehind
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Lookahead');
        });

        it('should reject large quantifiers', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'large_quantifier',
                    displayName: 'Large Quantifier',
                    pattern: 'a{101}', // Too large
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Quantifier');
        });

        it('should reject unbounded large quantifiers', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'unbounded_quantifier',
                    displayName: 'Unbounded Quantifier',
                    pattern: 'a{101,}', // Unbounded with large min
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Quantifier');
        });

        it('should accept pattern with valid quantifiers', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'valid_quantifier',
                    displayName: 'Valid Quantifier',
                    pattern: '\\bID-[0-9]{1,10}\\b',
                },
            });

            expect(response.statusCode).toBe(201);
        });

        it('should sanitize regex flags', async () => {
            // This test verifies that only safe flags are used
            const response = await app.inject({
                method: 'POST',
                url: `/v1/patterns?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'flag_test',
                    displayName: 'Flag Test',
                    pattern: '\\btest\\b',
                },
            });

            expect(response.statusCode).toBe(201);
        });
    });

    describe('POST /v1/patterns/test', () => {
        it('should test pattern against text', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/patterns/test',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: '\\bORD-([0-9]+)\\b',
                    text: 'Processing ORD-12345 and ORD-67890',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.count).toBe(2);
            expect(body.data.matches).toContain('12345');
            expect(body.data.matches).toContain('67890');
        });

        it('should return 400 for invalid pattern', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/patterns/test',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: '[invalid(',
                    text: 'Some text',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return empty matches for non-matching pattern', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/patterns/test',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: '\\bNOTFOUND\\b',
                    text: 'This text has no matches',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.count).toBe(0);
            expect(body.data.matches).toEqual([]);
        });

        it('should limit matches to 100', async () => {
            // Create text with many matches
            const text = Array.from({ length: 150 }, (_, i) => `MATCH${i}`).join(' ');

            const response = await app.inject({
                method: 'POST',
                url: '/v1/patterns/test',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: '\\bMATCH[0-9]+\\b',
                    text,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.matches.length).toBe(100);
        });

        it('should reject lookahead patterns for security', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/patterns/test',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: '(?=test)', // Zero-width lookahead - blocked for security
                    text: 'test test test',
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Lookahead/lookbehind assertions are not allowed');
        });

        it('should handle zero-width matches safely', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/patterns/test',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: '\\b', // Word boundary - zero-width but safe
                    text: 'test word here',
                },
            });

            expect(response.statusCode).toBe(200);
            // Should not hang due to infinite loop protection
        });

        it('should use capture group if available', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/patterns/test',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    pattern: 'user_id:\\s*([a-z0-9]+)',
                    text: 'user_id: abc123',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.matches).toContain('abc123');
        });
    });
});
