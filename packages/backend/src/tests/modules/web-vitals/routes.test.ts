import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../../../database/index.js';
import { webVitalsRoutes } from '../../../modules/web-vitals/routes.js';
import { createTestContext } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insertInto('sessions').values({ user_id: userId, token, expires_at: expiresAt }).execute();
    return { token };
}

describe('Web vitals routes', () => {
    let app: FastifyInstance;
    let testUser: any;
    let testProject: any;
    let authToken: string;

    const range = () => {
        const to = new Date();
        const from = new Date(to.getTime() - 60 * 60 * 1000);
        return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    };
    const get = (url: string, token = authToken) =>
        app.inject({ method: 'GET', url, headers: { Authorization: `Bearer ${token}` } });

    beforeAll(async () => {
        app = Fastify();
        await app.register(webVitalsRoutes, { prefix: '/api/v1/web-vitals' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        const ctx = await createTestContext();
        testUser = ctx.user;
        testProject = ctx.project;
        authToken = (await createTestSession(testUser.id)).token;
    });

    it('401 without token', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/v1/web-vitals/summary?projectId=${testProject.id}&${range()}`,
        });
        expect(res.statusCode).toBe(401);
    });

    it('400 when required params are missing', async () => {
        const res = await get(`/api/v1/web-vitals/summary?projectId=${testProject.id}`);
        expect(res.statusCode).toBe(400);
    });

    it('400 when from after to', async () => {
        const res = await get(
            `/api/v1/web-vitals/summary?projectId=${testProject.id}&from=2025-01-02T00:00:00.000Z&to=2025-01-01T00:00:00.000Z`,
        );
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.payload).error).toBe('from must be before to');
    });

    it('400 for range over 31 days', async () => {
        const res = await get(
            `/api/v1/web-vitals/summary?projectId=${testProject.id}&from=2025-01-01T00:00:00.000Z&to=2025-02-05T00:00:00.000Z`,
        );
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.payload).error).toBe('Range must be 31 days or less');
    });

    it('accepts exactly 31 days', async () => {
        const res = await get(
            `/api/v1/web-vitals/summary?projectId=${testProject.id}&from=2025-01-01T00:00:00.000Z&to=2025-02-01T00:00:00.000Z`,
        );
        expect(res.statusCode).toBe(200);
    });

    it('403 for project of another organization', async () => {
        const other = await createTestContext();
        const res = await get(`/api/v1/web-vitals/summary?projectId=${other.project.id}&${range()}`);
        expect(res.statusCode).toBe(403);
    });

    it('200 shape for own project with zero samples', async () => {
        const res = await get(`/api/v1/web-vitals/summary?projectId=${testProject.id}&${range()}`);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.payload);
        expect(body).toMatchObject({
            projectId: testProject.id, sampleCount: 0, skipped: 0, truncated: false, routes: [],
        });
        expect(body.metrics).toHaveLength(5);
        expect(body.metrics[0]).toMatchObject({ name: 'LCP', p75: null, rating: null, samples: 0 });
    });

    it('200 with real records, ignoring other projects', async () => {
        const other = await createTestContext();
        const now = new Date();
        const row = (projectId: string, value: number) => ({
            project_id: projectId, service: 'web', level: 'info', message: 'web vital', time: now,
            metadata: JSON.stringify({ 'performance.metric': 'LCP', 'performance.value': value, 'page.pathname': '/home' }),
        });
        await db.insertInto('logs').values([row(testProject.id, 1000), row(testProject.id, 3000), row(other.project.id, 9000)] as any).execute();

        const to = new Date(now.getTime() + 60_000);
        const from = new Date(now.getTime() - 60 * 60 * 1000);
        const res = await get(
            `/api/v1/web-vitals/summary?projectId=${testProject.id}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        );
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.payload);
        expect(body.sampleCount).toBe(2);
        const lcp = body.metrics.find((m: any) => m.name === 'LCP');
        expect(lcp.p75).toBe(2500);
        expect(lcp.rating).toBe('good');
        expect(body.routes[0]).toMatchObject({ route: '/home', samples: 2 });
    });
});
