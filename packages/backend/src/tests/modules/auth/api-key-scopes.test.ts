import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext, createTestApiKey, createTestLog } from '../../helpers/factories.js';
import { build } from '../../../server.js';
import supertest from 'supertest';

/**
 * Tests for API key scopes (write-only vs full-access)
 * and domain/IP allowlist enforcement.
 */
describe('API Key Scopes', () => {
    let app: any;

    beforeAll(async () => {
        app = await build();
        await app.ready();
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    beforeEach(async () => {
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('users').execute();
        await db.deleteFrom('sessions').execute();
    });

    // ============================================================
    // Key type creation
    // ============================================================
    describe('API key type creation', () => {
        it('should create a write-only key by default', async () => {
            const { user, project } = await createTestContext();

            const loginResponse = await supertest(app.server)
                .post('/api/v1/auth/login')
                .send({ email: user.email, password: 'password123' });
            const token = loginResponse.body.session.token;

            const response = await supertest(app.server)
                .post(`/api/v1/projects/${project.id}/api-keys`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Default Key' });

            expect(response.status).toBe(201);
            expect(response.body.type).toBe('write');

            // Verify in DB
            const key = await db
                .selectFrom('api_keys')
                .selectAll()
                .where('id', '=', response.body.id)
                .executeTakeFirst();
            expect(key?.type).toBe('write');
        });

        it('should create a full-access key when specified', async () => {
            const { user, project } = await createTestContext();

            const loginResponse = await supertest(app.server)
                .post('/api/v1/auth/login')
                .send({ email: user.email, password: 'password123' });
            const token = loginResponse.body.session.token;

            const response = await supertest(app.server)
                .post(`/api/v1/projects/${project.id}/api-keys`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Full Key', type: 'full' });

            expect(response.status).toBe(201);
            expect(response.body.type).toBe('full');
        });

        it('should create a key with allowed origins', async () => {
            const { user, project } = await createTestContext();

            const loginResponse = await supertest(app.server)
                .post('/api/v1/auth/login')
                .send({ email: user.email, password: 'password123' });
            const token = loginResponse.body.session.token;

            const response = await supertest(app.server)
                .post(`/api/v1/projects/${project.id}/api-keys`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    name: 'Origin-Restricted Key',
                    type: 'write',
                    allowedOrigins: ['example.com', '*.mysite.io'],
                });

            expect(response.status).toBe(201);

            // Verify in DB
            const key = await db
                .selectFrom('api_keys')
                .selectAll()
                .where('id', '=', response.body.id)
                .executeTakeFirst();
            expect(key?.allowed_origins).toEqual(['example.com', '*.mysite.io']);
        });

        it('should reject invalid key type', async () => {
            const { user, project } = await createTestContext();

            const loginResponse = await supertest(app.server)
                .post('/api/v1/auth/login')
                .send({ email: user.email, password: 'password123' });
            const token = loginResponse.body.session.token;

            const response = await supertest(app.server)
                .post(`/api/v1/projects/${project.id}/api-keys`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Bad Key', type: 'admin' });

            expect(response.status).toBe(400);
        });

        it('should list keys with type included', async () => {
            const { user, project } = await createTestContext();
            await createTestApiKey({ projectId: project.id, name: 'Write Key', type: 'write' });
            await createTestApiKey({ projectId: project.id, name: 'Full Key', type: 'full' });

            const loginResponse = await supertest(app.server)
                .post('/api/v1/auth/login')
                .send({ email: user.email, password: 'password123' });
            const token = loginResponse.body.session.token;

            const response = await supertest(app.server)
                .get(`/api/v1/projects/${project.id}/api-keys`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            const types = response.body.apiKeys.map((k: any) => k.type);
            expect(types).toContain('write');
            expect(types).toContain('full');
        });
    });

    // ============================================================
    // Write-only key blocked from read endpoints
    // ============================================================
    describe('write-only key access enforcement', () => {
        it('should allow write-only key to ingest logs', async () => {
            const writeKey = await createTestApiKey({ type: 'write' });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', writeKey.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test message',
                    }],
                });

            expect(response.status).toBe(200);
            expect(response.body.received).toBe(1);
        });

        it('should block write-only key from querying logs', async () => {
            const writeKey = await createTestApiKey({ type: 'write' });

            const response = await supertest(app.server)
                .get('/api/v1/logs')
                .query({ projectId: writeKey.project_id })
                .set('x-api-key', writeKey.plainKey);

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Forbidden');
            expect(response.body.message).toContain('write-only');
        });

        it('should block write-only key from stats endpoint', async () => {
            const writeKey = await createTestApiKey({ type: 'write' });

            const response = await supertest(app.server)
                .get('/api/v1/stats')
                .query({ projectId: writeKey.project_id })
                .set('x-api-key', writeKey.plainKey);

            expect(response.status).toBe(403);
        });

        it('should allow full-access key to query logs', async () => {
            const fullKey = await createTestApiKey({ type: 'full' });

            const response = await supertest(app.server)
                .get('/api/v1/logs')
                .query({ projectId: fullKey.project_id })
                .set('x-api-key', fullKey.plainKey);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('logs');
        });

        it('should allow full-access key to ingest logs', async () => {
            const fullKey = await createTestApiKey({ type: 'full' });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', fullKey.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test message',
                    }],
                });

            expect(response.status).toBe(200);
        });
    });

    // ============================================================
    // Origin/IP allowlist
    // ============================================================
    describe('origin allowlist enforcement', () => {
        it('should allow requests with no allowlist configured', async () => {
            const key = await createTestApiKey({ type: 'write', allowedOrigins: null });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://random-site.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });

        it('should allow requests with empty allowlist', async () => {
            const key = await createTestApiKey({ type: 'write', allowedOrigins: [] });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://any-site.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });

        it('should allow requests from an exact origin match', async () => {
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['https://myapp.com'],
            });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://myapp.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });

        it('should allow requests from hostname match', async () => {
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['myapp.com'],
            });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://myapp.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });

        it('should block requests from non-allowed origin', async () => {
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['https://myapp.com'],
            });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://evil-site.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('allowlist');
        });

        it('should allow wildcard subdomain match', async () => {
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['*.example.com'],
            });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://app.example.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });

        it('should allow wildcard matching the root domain itself', async () => {
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['*.example.com'],
            });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://example.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });

        it('should allow deeply nested subdomain with wildcard', async () => {
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['*.example.com'],
            });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://deep.nested.sub.example.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });

        it('should block wildcard for different domain', async () => {
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['*.example.com'],
            });

            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .set('Origin', 'https://notexample.com')
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(403);
        });

        it('should allow IP-based requests when IP is in allowlist', async () => {
            // supertest connects via the IPv6-mapped address ::ffff:127.0.0.1,
            // which must match the plain IPv4 entry (and a range around it)
            const key = await createTestApiKey({
                type: 'write',
                allowedOrigins: ['127.0.0.0/8'],
            });

            // Request without Origin header (server-side), IP will be checked
            const response = await supertest(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', key.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'test',
                    }],
                });

            expect(response.status).toBe(200);
        });
    });
});
