import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../database/index.js';
import { adminRoutes } from '../../modules/admin/routes.js';
import { createTestUser, createTestOrganization } from '../helpers/factories.js';
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

    return { token };
}

async function createAdminUser() {
    const user = await createTestUser({ email: `admin-pagination-${Date.now()}@test.com` });
    await db.updateTable('users').set({ is_admin: true }).where('id', '=', user.id).execute();
    return user;
}

describe('Admin pagination bounds', () => {
    let app: FastifyInstance;
    let adminToken: string;

    beforeAll(async () => {
        app = Fastify();
        await app.register(adminRoutes, { prefix: '/api/v1/admin' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('users').execute();

        const adminUser = await createAdminUser();
        const session = await createTestSession(adminUser.id);
        adminToken = session.token;

        await createTestOrganization({ ownerId: adminUser.id });
    });

    it('clamps limit to 200 when given an oversized value', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin/users?limit=99999999&page=1',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.users.length).toBeLessThanOrEqual(200);
    });

    it('rejects a non-numeric page with 400', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin/users?page=notanumber',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatch(/page/);
    });

    it('rejects a non-numeric limit with 400', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin/users?limit=notanumber',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatch(/limit/);
    });

    it('clamps limit to 200 for /organizations endpoint', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin/organizations?limit=99999999',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.limit).toBe(200);
        expect(body.organizations.length).toBeLessThanOrEqual(200);
    });

    it('clamps limit to 200 for /projects endpoint', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin/projects?limit=99999999',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.limit).toBe(200);
        expect(body.projects.length).toBeLessThanOrEqual(200);
    });
});
