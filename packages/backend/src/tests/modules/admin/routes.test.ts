import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { adminRoutes } from '../../../modules/admin/routes.js';
import { createTestContext, createTestUser, createTestProject, createTestOrganization } from '../../helpers/factories.js';
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

// Helper to create an admin user
async function createAdminUser() {
    const user = await createTestUser({ email: `admin-${Date.now()}@test.com`, name: 'Admin User' });
    await db
        .updateTable('users')
        .set({ is_admin: true })
        .where('id', '=', user.id)
        .execute();
    return { ...user, is_admin: true };
}

describe('Admin Routes', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;
    let adminUser: any;
    let regularUser: any;
    let testOrg: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(adminRoutes, { prefix: '/api/v1/admin' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        // Clean up in correct order
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

        // Create admin user
        adminUser = await createAdminUser();
        const adminSession = await createTestSession(adminUser.id);
        adminToken = adminSession.token;

        // Create regular user
        regularUser = await createTestUser({ email: 'regular@test.com' });
        const userSession = await createTestSession(regularUser.id);
        userToken = userSession.token;

        // Create test organization and project
        testOrg = await createTestOrganization({ ownerId: adminUser.id });
        testProject = await createTestProject({ organizationId: testOrg.id, userId: adminUser.id });
    });

    describe('Authentication & Authorization', () => {
        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/system',
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/system',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/admin/stats/system', () => {
        it('should return system stats for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/system',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('users');
            expect(body).toHaveProperty('organizations');
            expect(body).toHaveProperty('projects');
        });
    });

    describe('GET /api/v1/admin/stats/health', () => {
        it('should return health stats for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/health',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('database');
            expect(body).toHaveProperty('redis');
            expect(body).toHaveProperty('overall');
        });
    });

    describe('GET /api/v1/admin/users', () => {
        it('should return paginated users list', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/users',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('users');
            expect(body).toHaveProperty('total');
            expect(body).toHaveProperty('page');
            expect(Array.isArray(body.users)).toBe(true);
        });

        it('should support pagination parameters', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/users?page=1&limit=10',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.page).toBe(1);
        });

        it('should support search parameter', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/users?search=admin',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.users.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('GET /api/v1/admin/users/:id', () => {
        it('should return user details', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/admin/users/${regularUser.id}`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.email).toBe('regular@test.com');
        });

        it('should return 404 for non-existent user', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('PATCH /api/v1/admin/users/:id/status', () => {
        it('should disable a user', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${regularUser.id}/status`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    disabled: true,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.message).toContain('disabled');
        });

        it('should enable a user', async () => {
            // First disable the user
            await db.updateTable('users').set({ disabled: true }).where('id', '=', regularUser.id).execute();

            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${regularUser.id}/status`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    disabled: false,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.message).toContain('enabled');
        });

        it('should return 400 for invalid disabled value', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${regularUser.id}/status`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    disabled: 'invalid',
                },
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('POST /api/v1/admin/users/:id/reset-password', () => {
        it('should reset user password', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/admin/users/${regularUser.id}/reset-password`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    newPassword: 'newpassword123',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.message).toContain('reset');
        });

        it('should return 400 for short password', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/admin/users/${regularUser.id}/reset-password`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    newPassword: 'short',
                },
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('GET /api/v1/admin/organizations', () => {
        it('should return organizations list', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/organizations',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('organizations');
            expect(body).toHaveProperty('total');
        });
    });

    describe('GET /api/v1/admin/organizations/:id', () => {
        it('should return organization details', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/admin/organizations/${testOrg.id}`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.name).toBe(testOrg.name);
        });

        it('should return 404 for non-existent organization', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('DELETE /api/v1/admin/organizations/:id', () => {
        it('should delete an organization', async () => {
            // Create a new org to delete
            const orgToDelete = await createTestOrganization({ ownerId: adminUser.id });

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/admin/organizations/${orgToDelete.id}`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe('GET /api/v1/admin/projects', () => {
        it('should return projects list', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/projects',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('projects');
            expect(body).toHaveProperty('total');
        });
    });

    describe('GET /api/v1/admin/projects/:id', () => {
        it('should return project details', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/admin/projects/${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.name).toBe(testProject.name);
        });

        it('should return 404 for non-existent project', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/api/v1/admin/projects/00000000-0000-0000-0000-000000000000',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('DELETE /api/v1/admin/projects/:id', () => {
        it('should delete a project', async () => {
            // Create a new project to delete
            const projectToDelete = await createTestProject({ organizationId: testOrg.id, userId: adminUser.id });

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/admin/projects/${projectToDelete.id}`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe('GET /api/v1/admin/cache/stats', () => {
        it('should return cache statistics', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/cache/stats',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('hits');
            expect(body).toHaveProperty('misses');
        });
    });

    describe('POST /api/v1/admin/cache/clear', () => {
        it('should clear cache', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/admin/cache/clear',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.message).toContain('cleared');
        });
    });

    describe('POST /api/v1/admin/cache/invalidate/:projectId', () => {
        it('should invalidate project cache', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/admin/cache/invalidate/${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.message).toContain('invalidated');
        });
    });

    describe('GET /api/v1/admin/stats/platform-timeline', () => {
        it('should return platform timeline for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/platform-timeline',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('timeline');
            expect(Array.isArray(body.timeline)).toBe(true);
        });

        it('should accept hours parameter', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/platform-timeline?hours=48',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });

        it('should return 400 for invalid hours parameter', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/platform-timeline?hours=0',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 for hours > 168', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/platform-timeline?hours=200',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/platform-timeline',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/admin/stats/active-issues', () => {
        it('should return active issues for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/active-issues',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('openIncidents');
            expect(body).toHaveProperty('criticalDetections24h');
            expect(body).toHaveProperty('failedNotifications24h');
            expect(body).toHaveProperty('openErrorGroups');
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/active-issues',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/admin/stats/compression', () => {
        it('should return compression stats for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/compression',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('hypertables');
            expect(Array.isArray(body.hypertables)).toBe(true);
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/compression',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/admin/stats/continuous-aggregates', () => {
        it('should return aggregate stats for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/continuous-aggregates',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('aggregates');
            expect(Array.isArray(body.aggregates)).toBe(true);
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/continuous-aggregates',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/admin/stats/slow-queries', () => {
        it('should return slow queries for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/slow-queries',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('activeQueries');
            expect(body).toHaveProperty('topSlowQueries');
            expect(body).toHaveProperty('pgStatStatementsAvailable');
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/stats/slow-queries',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/admin/version-check', () => {
        it('should return version check result for admin', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/version-check',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('currentVersion');
            expect(body).toHaveProperty('channel');
            expect(body).toHaveProperty('updateAvailable');
            expect(body).toHaveProperty('checkedAt');
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/admin/version-check',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('PATCH /api/v1/admin/users/:id/role', () => {
        it('should promote user to admin', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${regularUser.id}/role`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    is_admin: true,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.message).toContain('promoted');
        });

        it('should demote user from admin', async () => {
            // Make regular user an admin first
            await db.updateTable('users').set({ is_admin: true }).where('id', '=', regularUser.id).execute();

            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${regularUser.id}/role`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    is_admin: false,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.message).toContain('demoted');
        });

        it('should return 400 for invalid is_admin value', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${regularUser.id}/role`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    is_admin: 'invalid',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should prevent admin from demoting themselves', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${adminUser.id}/role`,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
                payload: {
                    is_admin: false,
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Cannot remove admin role from yourself');
        });

        it('should return 403 for non-admin users', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/admin/users/${regularUser.id}/role`,
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
                payload: {
                    is_admin: true,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });
});
