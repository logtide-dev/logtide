import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { adminRoutes } from '../../../modules/admin/routes.js';
import { AdminService, AdminConflictError, AdminNotFoundError } from '../../../modules/admin/service.js';
import { CacheManager } from '../../../utils/cache.js';
import {
    createTestUser,
    createTestOrganization,
    createTestProject,
    createTestApiKey,
} from '../../helpers/factories.js';

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

async function createSession(userId: string, expiresInMs = 24 * 60 * 60 * 1000) {
    const token = crypto.randomBytes(32).toString('hex');
    await db
        .insertInto('sessions')
        .values({ user_id: userId, token, expires_at: new Date(Date.now() + expiresInMs) })
        .execute();
    return token;
}

async function createAdmin(email: string) {
    const user = await createTestUser({ email });
    await db.updateTable('users').set({ is_admin: true }).where('id', '=', user.id).execute();
    return { ...user, is_admin: true };
}

async function cleanDb() {
    await db.deleteFrom('metering_events').execute();
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
}

describe('AdminService safety guards', () => {
    let service: AdminService;

    beforeEach(async () => {
        service = new AdminService();
        await cleanDb();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('lockout guards', () => {
        it('refuses to let an admin disable their own account', async () => {
            const a = await createAdmin('a@test.com');
            await createAdmin('b@test.com');
            await expect(service.updateUserStatus(a.id, true, a.id)).rejects.toBeInstanceOf(AdminConflictError);
            const row = await db.selectFrom('users').select('disabled').where('id', '=', a.id).executeTakeFirstOrThrow();
            expect(row.disabled).toBe(false);
        });

        it('refuses to disable the last active admin', async () => {
            const a = await createAdmin('a@test.com');
            await expect(service.updateUserStatus(a.id, true)).rejects.toThrow(/last active admin/i);
        });

        it('allows disabling an admin when another active admin remains', async () => {
            const a = await createAdmin('a@test.com');
            const b = await createAdmin('b@test.com');
            const user = await service.updateUserStatus(b.id, true, a.id);
            expect(user.disabled).toBe(true);
        });

        it('does not count disabled admins as active', async () => {
            const a = await createAdmin('a@test.com');
            const b = await createAdmin('b@test.com');
            await db.updateTable('users').set({ disabled: true }).where('id', '=', b.id).execute();
            await expect(service.updateUserRole(a.id, false)).rejects.toThrow(/last active admin/i);
        });

        it('refuses to demote the last active admin', async () => {
            const a = await createAdmin('a@test.com');
            await expect(service.updateUserRole(a.id, false)).rejects.toBeInstanceOf(AdminConflictError);
            const row = await db.selectFrom('users').select('is_admin').where('id', '=', a.id).executeTakeFirstOrThrow();
            expect(row.is_admin).toBe(true);
        });

        it('allows demoting an admin when another active admin remains', async () => {
            await createAdmin('a@test.com');
            const b = await createAdmin('b@test.com');
            const user = await service.updateUserRole(b.id, false);
            expect(user.is_admin).toBe(false);
        });

        it('still lets a regular user be disabled', async () => {
            await createAdmin('a@test.com');
            const u = await createTestUser({ email: 'u@test.com' });
            const user = await service.updateUserStatus(u.id, true);
            expect(user.disabled).toBe(true);
        });

        it('throws a not-found error for unknown users', async () => {
            await expect(service.updateUserStatus(MISSING_ID, true)).rejects.toBeInstanceOf(AdminNotFoundError);
            await expect(service.updateUserRole(MISSING_ID, true)).rejects.toBeInstanceOf(AdminNotFoundError);
            await expect(service.resetUserPassword(MISSING_ID, 'password123')).rejects.toBeInstanceOf(
                AdminNotFoundError
            );
        });
    });

    describe('deleteProject', () => {
        it('soft-deletes the project and invalidates its API key cache', async () => {
            const org = await createTestOrganization();
            const project = await createTestProject({ organizationId: org.id });
            const key = await createTestApiKey({ projectId: project.id });
            const spy = vi.spyOn(CacheManager, 'invalidateApiKey');

            const result = await service.deleteProject(project.id);
            expect(result.organizationId).toBe(org.id);

            const row = await db
                .selectFrom('projects')
                .select(['id', 'deleted_at'])
                .where('id', '=', project.id)
                .executeTakeFirst();
            expect(row).toBeDefined();
            expect(row!.deleted_at).not.toBeNull();
            expect(spy).toHaveBeenCalledWith(key.key_hash);
        });

        it('is a no-op on an already soft-deleted project', async () => {
            const project = await createTestProject();
            const first = new Date(Date.now() - 60_000);
            await db.updateTable('projects').set({ deleted_at: first }).where('id', '=', project.id).execute();

            const result = await service.deleteProject(project.id);
            expect(result.alreadyDeleted).toBe(true);
            const row = await db
                .selectFrom('projects')
                .select('deleted_at')
                .where('id', '=', project.id)
                .executeTakeFirstOrThrow();
            expect(new Date(row.deleted_at as any).getTime()).toBe(first.getTime());
        });

        it('throws not found for a missing project', async () => {
            await expect(service.deleteProject(MISSING_ID)).rejects.toBeInstanceOf(AdminNotFoundError);
        });
    });

    describe('deleteOrganization', () => {
        it('throws not found for a missing organization', async () => {
            await expect(service.deleteOrganization(MISSING_ID)).rejects.toBeInstanceOf(AdminNotFoundError);
        });

        it('deletes the org and invalidates cached API keys of its projects', async () => {
            const org = await createTestOrganization();
            const project = await createTestProject({ organizationId: org.id });
            const key = await createTestApiKey({ projectId: project.id });
            const spy = vi.spyOn(CacheManager, 'invalidateApiKey');

            await service.deleteOrganization(org.id);

            const row = await db.selectFrom('organizations').select('id').where('id', '=', org.id).executeTakeFirst();
            expect(row).toBeUndefined();
            expect(spy).toHaveBeenCalledWith(key.key_hash);
        });
    });
});

describe('Admin routes safety', () => {
    let app: FastifyInstance;
    let admin: Awaited<ReturnType<typeof createAdmin>>;
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
        await cleanDb();
        admin = await createAdmin('admin@test.com');
        adminToken = await createSession(admin.id);
    });

    const auth = () => ({ Authorization: `Bearer ${adminToken}` });

    it('PATCH status: self-disable is a 409 with a clear message', async () => {
        await createAdmin('other@test.com');
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/admin/users/${admin.id}/status`,
            headers: auth(),
            payload: { disabled: true },
        });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.payload).error).toMatch(/your own account/i);
    });

    it('PATCH status/role and POST reset-password: unknown user is 404', async () => {
        const status = await app.inject({
            method: 'PATCH',
            url: `/api/v1/admin/users/${MISSING_ID}/status`,
            headers: auth(),
            payload: { disabled: true },
        });
        expect(status.statusCode).toBe(404);

        const role = await app.inject({
            method: 'PATCH',
            url: `/api/v1/admin/users/${MISSING_ID}/role`,
            headers: auth(),
            payload: { is_admin: true },
        });
        expect(role.statusCode).toBe(404);

        const reset = await app.inject({
            method: 'POST',
            url: `/api/v1/admin/users/${MISSING_ID}/reset-password`,
            headers: auth(),
            payload: { newPassword: 'password123' },
        });
        expect(reset.statusCode).toBe(404);
    });

    it('malformed ids are 400, not 500', async () => {
        for (const [method, url] of [
            ['GET', '/api/v1/admin/users/not-a-uuid'],
            ['PATCH', '/api/v1/admin/users/not-a-uuid/status'],
            ['GET', '/api/v1/admin/organizations/not-a-uuid'],
            ['DELETE', '/api/v1/admin/organizations/not-a-uuid'],
            ['GET', '/api/v1/admin/projects/not-a-uuid'],
            ['DELETE', '/api/v1/admin/projects/not-a-uuid'],
        ] as const) {
            const res = await app.inject({ method, url, headers: auth(), payload: method === 'PATCH' ? { disabled: true } : undefined });
            expect(res.statusCode, `${method} ${url}`).toBe(400);
        }
    });

    it('DELETE organization: missing org is 404', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: `/api/v1/admin/organizations/${MISSING_ID}`,
            headers: auth(),
        });
        expect(res.statusCode).toBe(404);
    });

    it('DELETE project soft-deletes and records a soft_delete audit row', async () => {
        const org = await createTestOrganization({ ownerId: admin.id });
        const project = await createTestProject({ organizationId: org.id, userId: admin.id });
        const res = await app.inject({
            method: 'DELETE',
            url: `/api/v1/admin/projects/${project.id}`,
            headers: auth(),
        });
        expect(res.statusCode).toBe(200);
        const row = await db
            .selectFrom('projects')
            .select('deleted_at')
            .where('id', '=', project.id)
            .executeTakeFirstOrThrow();
        expect(row.deleted_at).not.toBeNull();
        const audit = await db
            .selectFrom('audit_log')
            .select(['action', 'organization_id'])
            .where('resource_id', '=', project.id)
            .where('action', '=', 'project.soft_delete')
            .executeTakeFirst();
        expect(audit?.organization_id).toBe(org.id);
    });
});
