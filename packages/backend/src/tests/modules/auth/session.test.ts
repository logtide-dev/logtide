import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser } from '../../helpers/factories.js';
import { build } from '../../../server.js';
import { CacheManager } from '../../../utils/cache.js';
import supertest from 'supertest';

describe('Auth Session Lifecycle', () => {
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
        // Reset system settings and cache to avoid auth-free mode pollution
        await db.deleteFrom('system_settings').execute();
        await CacheManager.invalidateSettings();
        // Reset rate limiting by clearing Redis
        await CacheManager.invalidateSettings(); // This also helps reset rate limit caches

        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('users').execute();
    });

    it('should create a session on successful login', async () => {
        const user = await createTestUser({
            email: 'test@example.com',
            password: 'password123',
        });

        const response = await supertest(app.server)
            .post('/api/v1/auth/login')
            .send({
                email: 'test@example.com',
                password: 'password123',
            });

        expect(response.status).toBe(200);
        expect(response.body.session).toBeDefined();
        expect(response.body.session.token).toBeDefined();

        // Verify session in DB
        const session = await db
            .selectFrom('sessions')
            .selectAll()
            .where('user_id', '=', user.id)
            .executeTakeFirst();

        expect(session).toBeDefined();
        expect(session?.token).toBe(response.body.session.token);
    });

    it('should reject invalid credentials', async () => {
        await createTestUser({
            email: 'test@example.com',
            password: 'password123',
        });

        const response = await supertest(app.server)
            .post('/api/v1/auth/login')
            .send({
                email: 'test@example.com',
                password: 'wrongpassword',
            });

        expect(response.status).toBe(401);
    });

    it('should validate session on protected route', async () => {
        const user = await createTestUser();

        // Login to get token
        const loginResponse = await supertest(app.server)
            .post('/api/v1/auth/login')
            .send({
                email: user.email,
                password: 'password123', // factory default
            });

        const token = loginResponse.body.session.token;

        // Access protected route (e.g. /api/v1/auth/me)
        const response = await supertest(app.server)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.user.id).toBe(user.id);
    });

    it('should invalidate session on logout', async () => {
        const user = await createTestUser();

        const loginResponse = await supertest(app.server)
            .post('/api/v1/auth/login')
            .send({
                email: user.email,
                password: 'password123',
            });

        const token = loginResponse.body.session.token;

        // Logout
        const logoutResponse = await supertest(app.server)
            .post('/api/v1/auth/logout')
            .set('Authorization', `Bearer ${token}`);

        expect(logoutResponse.status).toBe(200);

        // Verify session removed from DB
        const session = await db
            .selectFrom('sessions')
            .selectAll()
            .where('token', '=', token)
            .executeTakeFirst();

        expect(session).toBeUndefined();

        // Verify token no longer works
        const meResponse = await supertest(app.server)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(meResponse.status).toBe(401);
    });
});
