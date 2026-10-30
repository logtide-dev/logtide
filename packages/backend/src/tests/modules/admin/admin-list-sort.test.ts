import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { adminRoutes } from '../../../modules/admin/routes.js';
import {
    createTestUser,
    createTestOrganization,
    createTestProject,
    createTestApiKey,
    createTestAlertRule,
} from '../../helpers/factories.js';

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

const at = (n: number) => new Date(Date.UTC(2026, 0, n));

describe('admin list sort, filters and validation', () => {
    let app: FastifyInstance;
    let headers: { Authorization: string };
    let adminId: string;

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
        const admin = await createTestUser({ email: 'root-admin@test.com', name: 'Root' });
        adminId = admin.id;
        await db.updateTable('users').set({ is_admin: true, created_at: at(1) }).where('id', '=', admin.id).execute();
        const token = crypto.randomBytes(32).toString('hex');
        await db
            .insertInto('sessions')
            .values({ user_id: admin.id, token, expires_at: new Date(Date.now() + 3600_000) })
            .execute();
        headers = { Authorization: `Bearer ${token}` };
    });

    async function get(url: string) {
        return app.inject({ method: 'GET', url: `/api/v1/admin${url}`, headers });
    }

    describe('users', () => {
        async function seedUsers() {
            const a = await createTestUser({ email: 'alice@test.com', name: 'Zed' });
            const b = await createTestUser({ email: 'bob@test.com', name: 'Amy' });
            const c = await createTestUser({ email: 'carol@test.com', name: 'Max', disabled: true });
            await db.updateTable('users').set({ created_at: at(2), last_login: at(20) }).where('id', '=', a.id).execute();
            await db.updateTable('users').set({ created_at: at(3), last_login: at(10) }).where('id', '=', b.id).execute();
            await db.updateTable('users').set({ created_at: at(4), last_login: null }).where('id', '=', c.id).execute();
            return { a, b, c };
        }

        it('defaults to created_at desc', async () => {
            await seedUsers();
            const res = await get('/users');
            expect(res.statusCode).toBe(200);
            expect(res.json().users.map((u: any) => u.email)).toEqual([
                'carol@test.com',
                'bob@test.com',
                'alice@test.com',
                'root-admin@test.com',
            ]);
        });

        it.each([
            ['email', 'asc', ['alice@test.com', 'bob@test.com', 'carol@test.com', 'root-admin@test.com']],
            ['email', 'desc', ['root-admin@test.com', 'carol@test.com', 'bob@test.com', 'alice@test.com']],
            ['name', 'asc', ['bob@test.com', 'carol@test.com', 'root-admin@test.com', 'alice@test.com']],
            ['name', 'desc', ['alice@test.com', 'root-admin@test.com', 'carol@test.com', 'bob@test.com']],
            ['created_at', 'asc', ['root-admin@test.com', 'alice@test.com', 'bob@test.com', 'carol@test.com']],
            ['created_at', 'desc', ['carol@test.com', 'bob@test.com', 'alice@test.com', 'root-admin@test.com']],
        ])('sorts by %s %s', async (sort, order, expected) => {
            await seedUsers();
            const res = await get(`/users?sort=${sort}&order=${order}`);
            expect(res.statusCode).toBe(200);
            expect(res.json().users.map((u: any) => u.email)).toEqual(expected);
        });

        it('sorts by last_login with nulls last in both orders', async () => {
            await seedUsers();
            await db.updateTable('users').set({ last_login: null }).where('id', '=', adminId).execute();

            const asc = (await get('/users?sort=last_login&order=asc')).json().users.map((u: any) => u.email);
            expect(asc.slice(0, 2)).toEqual(['bob@test.com', 'alice@test.com']);
            expect(asc.slice(2).sort()).toEqual(['carol@test.com', 'root-admin@test.com']);

            const desc = (await get('/users?sort=last_login&order=desc')).json().users.map((u: any) => u.email);
            expect(desc.slice(0, 2)).toEqual(['alice@test.com', 'bob@test.com']);
            expect(desc.slice(2).sort()).toEqual(['carol@test.com', 'root-admin@test.com']);
        });

        it('breaks ties by id in the order direction, stable across pages', async () => {
            const ids: string[] = [adminId];
            for (let i = 0; i < 5; i++) {
                const u = await createTestUser({ email: `tie${i}@test.com`, name: 'Same' });
                ids.push(u.id);
            }
            await db.updateTable('users').set({ name: 'Same', created_at: at(5) }).execute();
            const sorted = [...ids].sort();

            const asc = (await get('/users?sort=name&order=asc')).json().users.map((u: any) => u.id);
            expect(asc).toEqual(sorted);
            const desc = (await get('/users?sort=name&order=desc')).json().users.map((u: any) => u.id);
            expect(desc).toEqual([...sorted].reverse());

            const p1 = (await get('/users?sort=name&order=asc&limit=3&page=1')).json().users.map((u: any) => u.id);
            const p2 = (await get('/users?sort=name&order=asc&limit=3&page=2')).json().users.map((u: any) => u.id);
            expect([...p1, ...p2]).toEqual(sorted);
        });

        it('filters by role and status and keeps total consistent', async () => {
            await seedUsers();
            const admins = (await get('/users?role=admin')).json();
            expect(admins.users.map((u: any) => u.email)).toEqual(['root-admin@test.com']);
            expect(admins.total).toBe(1);

            const plain = (await get('/users?role=user')).json();
            expect(plain.total).toBe(3);

            const disabled = (await get('/users?status=disabled')).json();
            expect(disabled.users.map((u: any) => u.email)).toEqual(['carol@test.com']);
            expect(disabled.total).toBe(1);

            const active = (await get('/users?status=active&role=user')).json();
            expect(active.users.map((u: any) => u.email).sort()).toEqual(['alice@test.com', 'bob@test.com']);
        });

        it('returns orgCount per user', async () => {
            const { a } = await seedUsers();
            await createTestOrganization({ name: 'O1', slug: 'o1', ownerId: a.id });
            await createTestOrganization({ name: 'O2', slug: 'o2', ownerId: a.id });
            const res = (await get('/users?search=alice')).json();
            expect(res.users[0].orgCount).toBe(2);
            const root = (await get('/users?search=root-admin')).json();
            expect(root.users[0].orgCount).toBe(0);
        });
    });

    describe('organizations', () => {
        async function seedOrgs() {
            const o1 = await createTestUser({ email: 'own1@test.com' });
            const o2 = await createTestUser({ email: 'own2@test.com' });
            const o3 = await createTestUser({ email: 'own3@test.com' });
            const alpha = await createTestOrganization({ name: 'Alpha', slug: 'alpha', ownerId: o1.id });
            const beta = await createTestOrganization({ name: 'Beta', slug: 'beta', ownerId: o2.id });
            const gamma = await createTestOrganization({ name: 'Gamma', slug: 'gamma', ownerId: o3.id });
            await db.updateTable('organizations').set({ created_at: at(3) }).where('id', '=', alpha.id).execute();
            await db.updateTable('organizations').set({ created_at: at(2) }).where('id', '=', beta.id).execute();
            await db.updateTable('organizations').set({ created_at: at(1) }).where('id', '=', gamma.id).execute();
            // members: alpha 1, beta 3, gamma 2
            const m1 = await createTestUser({ email: 'm1@test.com' });
            const m2 = await createTestUser({ email: 'm2@test.com' });
            await db.insertInto('organization_members').values([
                { organization_id: beta.id, user_id: m1.id, role: 'member' },
                { organization_id: beta.id, user_id: m2.id, role: 'member' },
                { organization_id: gamma.id, user_id: m1.id, role: 'member' },
            ]).execute();
            // projects: alpha 3, beta 1, gamma 0 (+1 deleted that must not count)
            for (let i = 0; i < 3; i++) await createTestProject({ organizationId: alpha.id });
            await createTestProject({ organizationId: beta.id });
            const del = await createTestProject({ organizationId: gamma.id });
            await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', del.id).execute();
            return { alpha, beta, gamma, o1, o2, o3 };
        }

        const names = (res: any) => res.json().organizations.map((o: any) => o.name);

        it('defaults to created_at desc', async () => {
            await seedOrgs();
            expect(names(await get('/organizations'))).toEqual(['Alpha', 'Beta', 'Gamma']);
        });

        it.each([
            ['name', 'asc', ['Alpha', 'Beta', 'Gamma']],
            ['name', 'desc', ['Gamma', 'Beta', 'Alpha']],
            ['created_at', 'asc', ['Gamma', 'Beta', 'Alpha']],
            ['created_at', 'desc', ['Alpha', 'Beta', 'Gamma']],
            ['members', 'asc', ['Alpha', 'Gamma', 'Beta']],
            ['members', 'desc', ['Beta', 'Gamma', 'Alpha']],
            ['projects', 'asc', ['Gamma', 'Beta', 'Alpha']],
            ['projects', 'desc', ['Alpha', 'Beta', 'Gamma']],
        ])('sorts by %s %s', async (sort, order, expected) => {
            await seedOrgs();
            const res = await get(`/organizations?sort=${sort}&order=${order}`);
            expect(res.statusCode).toBe(200);
            expect(names(res)).toEqual(expected);
        });

        it('breaks ties by id', async () => {
            const owner = await createTestUser({ email: 'tie-owner@test.com' });
            const ids: string[] = [];
            for (let i = 0; i < 4; i++) {
                const o = await createTestOrganization({ name: `Same${i}`, slug: `same-${i}`, ownerId: owner.id });
                ids.push(o.id);
            }
            const asc = (await get('/organizations?sort=members&order=asc')).json().organizations.map((o: any) => o.id);
            expect(asc).toEqual([...ids].sort());
            const desc = (await get('/organizations?sort=projects&order=desc')).json().organizations.map((o: any) => o.id);
            expect(desc).toEqual([...ids].sort().reverse());
        });

        it('returns ownerId and ownerEmail, earliest owner when several', async () => {
            const { alpha, o1 } = await seedOrgs();
            const second = await createTestUser({ email: 'second-owner@test.com' });
            await db.insertInto('organization_members').values({
                organization_id: alpha.id,
                user_id: second.id,
                role: 'owner',
                created_at: new Date(Date.now() + 60_000),
            }).execute();
            const res = (await get('/organizations?search=alpha')).json();
            expect(res.organizations[0].ownerEmail).toBe('own1@test.com');
            expect(res.organizations[0].ownerId).toBe(o1.id);
            expect(res.organizations[0].memberCount).toBe(2);
            expect(res.organizations[0].projectCount).toBe(3);
        });

        it('returns null owner when the org has no owner membership', async () => {
            const { gamma } = await seedOrgs();
            await db.deleteFrom('organization_members').where('organization_id', '=', gamma.id).where('role', '=', 'owner').execute();
            const res = (await get('/organizations?search=gamma')).json();
            expect(res.organizations[0].ownerEmail).toBeNull();
            expect(res.organizations[0].ownerId).toBeNull();
        });
    });

    describe('projects', () => {
        async function seedProjects() {
            const orgA = await createTestOrganization({ name: 'Zeta Org', slug: 'zeta-org' });
            const orgB = await createTestOrganization({ name: 'Acme Org', slug: 'acme-org' });
            const p1 = await createTestProject({ name: 'banana', organizationId: orgA.id });
            const p2 = await createTestProject({ name: 'apple', organizationId: orgB.id });
            const p3 = await createTestProject({ name: 'cherry', organizationId: orgA.id });
            const p4 = await createTestProject({ name: 'dead', organizationId: orgB.id });
            await db.updateTable('projects').set({ created_at: at(1) }).where('id', '=', p1.id).execute();
            await db.updateTable('projects').set({ created_at: at(2) }).where('id', '=', p2.id).execute();
            await db.updateTable('projects').set({ created_at: at(3) }).where('id', '=', p3.id).execute();
            await db.updateTable('projects').set({ created_at: at(4), deleted_at: at(10) }).where('id', '=', p4.id).execute();
            return { orgA, orgB, p1, p2, p3, p4 };
        }

        const names = (res: any) => res.json().projects.map((p: any) => p.name);

        it('defaults to created_at desc and excludes deleted', async () => {
            await seedProjects();
            const res = await get('/projects');
            expect(names(res)).toEqual(['cherry', 'apple', 'banana']);
            expect(res.json().total).toBe(3);
        });

        it.each([
            ['name', 'asc', ['apple', 'banana', 'cherry']],
            ['name', 'desc', ['cherry', 'banana', 'apple']],
            ['created_at', 'asc', ['banana', 'apple', 'cherry']],
            ['created_at', 'desc', ['cherry', 'apple', 'banana']],
            // Acme Org: apple; Zeta Org: banana, cherry (id tiebreak is not name based, so assert groups)
            ['organization', 'asc', ['apple']],
            ['organization', 'desc', ['banana', 'cherry']],
        ])('sorts by %s %s', async (sort, order, expected) => {
            await seedProjects();
            const res = await get(`/projects?sort=${sort}&order=${order}`);
            expect(res.statusCode).toBe(200);
            const got = names(res);
            if (sort === 'organization') {
                // first group by org name; within an org the id tiebreaker decides
                const orgs = res.json().projects.map((p: any) => p.organization_name);
                const sortedOrgs = [...orgs].sort();
                expect(orgs).toEqual(order === 'asc' ? sortedOrgs : [...sortedOrgs].reverse());
                expect(got.slice(0, expected.length).sort()).toEqual([...expected].sort());
            } else {
                expect(got).toEqual(expected);
            }
        });

        it('breaks ties by id', async () => {
            const ids: string[] = [];
            for (let i = 0; i < 4; i++) {
                const org = await createTestOrganization({ name: 'Tie Org', slug: `tie-org-${i}` });
                const p = await createTestProject({ name: 'same', organizationId: org.id });
                ids.push(p.id);
            }
            const asc = (await get('/projects?sort=name&order=asc')).json().projects.map((p: any) => p.id);
            expect(asc).toEqual([...ids].sort());
            const desc = (await get('/projects?sort=organization&order=desc')).json().projects.map((p: any) => p.id);
            expect(desc).toEqual([...ids].sort().reverse());
        });

        it('filters by organizationId', async () => {
            const { orgB } = await seedProjects();
            const res = (await get(`/projects?organizationId=${orgB.id}`)).json();
            expect(res.projects.map((p: any) => p.name)).toEqual(['apple']);
            expect(res.total).toBe(1);
        });

        it('supports deleted=exclude|include|only with deletedAt and organizationId', async () => {
            const { orgB } = await seedProjects();
            const include = (await get('/projects?deleted=include&sort=created_at&order=desc')).json();
            expect(include.total).toBe(4);
            expect(include.projects.map((p: any) => p.name)).toEqual(['dead', 'cherry', 'apple', 'banana']);
            const dead = include.projects[0];
            expect(dead.deletedAt).not.toBeNull();
            expect(dead.organizationId).toBe(orgB.id);
            expect(include.projects[1].deletedAt).toBeNull();

            const only = (await get('/projects?deleted=only')).json();
            expect(only.projects.map((p: any) => p.name)).toEqual(['dead']);
            expect(only.total).toBe(1);

            const exclude = (await get('/projects?deleted=exclude')).json();
            expect(exclude.total).toBe(3);

            const combo = (await get(`/projects?deleted=include&organizationId=${orgB.id}&search=dea`)).json();
            expect(combo.projects.map((p: any) => p.name)).toEqual(['dead']);
        });

        it('returns alertRulesEnabled and alertRulesTotal per row', async () => {
            const org = await createTestOrganization({ name: 'R Org', slug: 'r-org' });
            const p = await createTestProject({ name: 'ruled', organizationId: org.id });
            await createTestProject({ name: 'bare', organizationId: org.id });
            await createTestAlertRule({ organizationId: org.id, projectId: p.id, enabled: true });
            await createTestAlertRule({ organizationId: org.id, projectId: p.id, enabled: true });
            await createTestAlertRule({ organizationId: org.id, projectId: p.id, enabled: false });
            const res = (await get('/projects?search=ruled')).json();
            const row = res.projects[0];
            expect(row.alertRulesTotal).toBe(3);
            expect(row.alertRulesEnabled).toBe(2);
            expect(row.alertRulesCount).toBe(3);
            expect(row.logs30d).toBe(0);
            const bare = (await get('/projects?search=bare')).json().projects[0];
            expect(bare.alertRulesTotal).toBe(0);
            expect(bare.alertRulesEnabled).toBe(0);
        });

        it('summary matches the row definitions and ignores deleted projects', async () => {
            const { orgA, p1, p4 } = await seedProjects();
            await createTestApiKey({ projectId: p1.id });
            await createTestApiKey({ projectId: p1.id });
            const revoked = await createTestApiKey({ projectId: p1.id });
            await db.updateTable('api_keys').set({ revoked: true }).where('id', '=', revoked.id).execute();
            await createTestApiKey({ projectId: p4.id });
            await createTestAlertRule({ organizationId: orgA.id, projectId: p1.id, enabled: true });
            await createTestAlertRule({ organizationId: orgA.id, projectId: p1.id, enabled: false });
            await createTestAlertRule({ organizationId: orgA.id, projectId: p4.id, enabled: true });

            const res = await get('/projects/summary');
            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({
                totalProjects: 3,
                activeApiKeys: 2,
                alertRulesTotal: 2,
                alertRulesEnabled: 1,
                logs30d: 0,
                logsWindowDays: 30,
            });
        });

        it('summary works on an empty instance', async () => {
            const res = (await get('/projects/summary')).json();
            expect(res.totalProjects).toBe(0);
            expect(res.logs30d).toBe(0);
        });
    });

    describe('validation', () => {
        it.each([
            '/users?page=0',
            '/users?page=-1',
            '/users?page=abc',
            '/users?page=1.5',
            '/users?page=99999999',
            '/users?limit=0',
            '/users?limit=-5',
            '/users?limit=abc',
            '/users?sort=password_hash',
            '/users?sort=members',
            '/users?order=sideways',
            '/users?role=root',
            '/users?status=banned',
            '/organizations?sort=email',
            '/organizations?order=up',
            '/organizations?page=0',
            '/projects?sort=members',
            '/projects?order=DESC',
            '/projects?deleted=maybe',
            '/projects?organizationId=not-a-uuid',
            '/projects?limit=abc',
        ])('rejects %s with 400 and a message', async (url) => {
            const res = await get(url);
            expect(res.statusCode).toBe(400);
            expect(typeof res.json().error).toBe('string');
            expect(res.json().error.length).toBeGreaterThan(5);
        });

        it('still clamps an oversized limit to 200', async () => {
            const res = await get('/users?limit=99999');
            expect(res.statusCode).toBe(200);
            expect(res.json().limit).toBe(200);
        });

        it('accepts the empty string for optional params', async () => {
            const res = await get('/users?sort=&order=&role=&status=');
            expect(res.statusCode).toBe(200);
        });
    });
});
