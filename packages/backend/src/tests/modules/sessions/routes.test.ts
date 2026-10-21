import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { sessionsRoutes } from '../../../modules/sessions/routes.js';
import { createTestContext } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insertInto('sessions').values({ user_id: userId, token, expires_at: expiresAt }).execute();
    return { token };
}

async function insertSessionLog(overrides: {
    projectId: string;
    sessionId: string;
    service?: string;
    level?: string;
    message?: string;
}) {
    return db
        .insertInto('logs')
        .values({
            project_id: overrides.projectId,
            service: overrides.service ?? 'web',
            level: (overrides.level ?? 'info') as any,
            message: overrides.message ?? 'event',
            time: new Date(),
            session_id: overrides.sessionId,
        } as any)
        .execute();
}

function engineSession(sessionId: string, errorCount = 0) {
    return {
        sessionId,
        service: 'web',
        firstEvent: new Date('2025-01-01T10:00:00Z'),
        lastEvent: new Date('2025-01-01T10:05:00Z'),
        eventCount: 2,
        errorCount,
    };
}

describe('Sessions Routes', () => {
    let app: FastifyInstance;
    let testUser: any;
    let testProject: any;
    let authToken: string;

    beforeAll(async () => {
        app = Fastify();
        await app.register(sessionsRoutes, { prefix: '/api/v1/sessions' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    beforeEach(async () => {
        const ctx = await createTestContext();
        testUser = ctx.user;
        testProject = ctx.project;

        const session = await createTestSession(testUser.id);
        authToken = session.token;
    });

    const get = (url: string, token = authToken) =>
        app.inject({ method: 'GET', url, headers: { Authorization: `Bearer ${token}` } });

    // =========================================================================
    // GET /api/v1/sessions
    // =========================================================================

    describe('GET /api/v1/sessions', () => {
        it('returns 401 without auth token', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sessions?projectId=${testProject.id}`,
            });
            expect(res.statusCode).toBe(401);
        });

        it('returns 400 when projectId is missing', async () => {
            const res = await get('/api/v1/sessions');
            expect(res.statusCode).toBe(400);
        });

        it('returns 403 when user does not have access to the project', async () => {
            const otherCtx = await createTestContext();
            const spy = vi.spyOn(reservoir, 'listSessions').mockResolvedValue({ sessions: [] });

            const res = await get(`/api/v1/sessions?projectId=${otherCtx.project.id}`);
            expect(res.statusCode).toBe(403);
            expect(spy).not.toHaveBeenCalled();
        });

        it('returns 200 with empty sessions and no total', async () => {
            vi.spyOn(reservoir, 'listSessions').mockResolvedValue({ sessions: [] });

            const res = await get(`/api/v1/sessions?projectId=${testProject.id}`);

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.sessions).toEqual([]);
            expect(body).not.toHaveProperty('total');
            expect(body).not.toHaveProperty('nextCursor');
        });

        it('returns sessions and the cursor from the reservoir', async () => {
            const spy = vi.spyOn(reservoir, 'listSessions').mockResolvedValue({
                sessions: [engineSession('session-001', 1)],
                nextCursor: 'abc',
            });

            const res = await get(`/api/v1/sessions?projectId=${testProject.id}&limit=1&cursor=prev`);

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.sessions[0]).toMatchObject({
                sessionId: 'session-001', eventCount: 2, errorCount: 1, durationMs: 300000,
            });
            expect(body.nextCursor).toBe('abc');
            expect(spy.mock.calls[0][0]).toMatchObject({ projectId: testProject.id, limit: 1, cursor: 'prev' });
        });

        it('returns 400 when limit is above 50', async () => {
            const res = await get(`/api/v1/sessions?projectId=${testProject.id}&limit=51`);
            expect(res.statusCode).toBe(400);
        });

        it('returns 400 when from is after to', async () => {
            const res = await get(
                `/api/v1/sessions?projectId=${testProject.id}&from=2025-01-02T00:00:00.000Z&to=2025-01-01T00:00:00.000Z`,
            );
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.payload).error).toBe('from must be before to');
        });

        it('returns 400 for an invalid cursor', async () => {
            vi.spyOn(reservoir, 'listSessions').mockRejectedValue(new RangeError('Invalid sessions cursor'));
            const res = await get(`/api/v1/sessions?projectId=${testProject.id}&cursor=garbage`);
            expect(res.statusCode).toBe(400);
        });

        it('filters sessions by hasErrors=true on errorCount', async () => {
            vi.spyOn(reservoir, 'listSessions').mockResolvedValue({
                sessions: [engineSession('clean', 0), engineSession('broken', 2)],
            });

            const res = await get(`/api/v1/sessions?projectId=${testProject.id}&hasErrors=true`);

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.sessions.map((s: any) => s.sessionId)).toEqual(['broken']);
        });
    });

    // =========================================================================
    // GET /api/v1/sessions/:sessionId/events
    // =========================================================================

    describe('GET /api/v1/sessions/:sessionId/events', () => {
        it('returns 401 without auth token', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/sessions/sess-abc/events?projectId=${testProject.id}`,
            });
            expect(res.statusCode).toBe(401);
        });

        it('returns 400 when projectId is missing', async () => {
            const res = await get('/api/v1/sessions/sess-abc/events');
            expect(res.statusCode).toBe(400);
        });

        it('returns 403 when user does not have access to the project', async () => {
            const otherCtx = await createTestContext();
            const res = await get(`/api/v1/sessions/sess-abc/events?projectId=${otherCtx.project.id}`);
            expect(res.statusCode).toBe(403);
        });

        it('returns 404 for unknown session', async () => {
            const res = await get(`/api/v1/sessions/nonexistent/events?projectId=${testProject.id}`);

            expect(res.statusCode).toBe(404);
            expect(JSON.parse(res.payload)).toEqual({ error: 'Session not found' });
        });

        it('returns 404 when the session belongs to a project of the same user but another one', async () => {
            const otherCtx = await createTestContext();
            await insertSessionLog({ projectId: otherCtx.project.id, sessionId: 'foreign-sess' });

            const res = await get(`/api/v1/sessions/foreign-sess/events?projectId=${testProject.id}`);
            expect(res.statusCode).toBe(404);
        });

        it('returns 200 with events, window and truncated for an existing session', async () => {
            await insertSessionLog({ projectId: testProject.id, sessionId: 'sess-xyz', message: 'click' });
            await insertSessionLog({ projectId: testProject.id, sessionId: 'sess-xyz', message: 'scroll' });

            const res = await get(`/api/v1/sessions/sess-xyz/events?projectId=${testProject.id}`);

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.events.length).toBe(2);
            expect(body.truncated).toBe(false);
            expect(body.window.from).toBeDefined();
            expect(body.window.to).toBeDefined();
        });

        it('session id with slash and unicode (url-encoded) resolves', async () => {
            const sid = 'caffè/a b';
            await insertSessionLog({ projectId: testProject.id, sessionId: sid, message: 'odd id' });

            const res = await get(
                `/api/v1/sessions/${encodeURIComponent(sid)}/events?projectId=${testProject.id}`,
            );

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.events[0].message).toBe('odd id');
            expect(body.events[0].sessionId).toBe(sid);
        });

        it('respects the limit parameter and flags truncation', async () => {
            for (let i = 0; i < 10; i++) {
                await insertSessionLog({ projectId: testProject.id, sessionId: 'sess-limit', message: `event ${i}` });
            }

            const res = await get(`/api/v1/sessions/sess-limit/events?projectId=${testProject.id}&limit=3`);

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.events.length).toBe(3);
            expect(body.truncated).toBe(true);
        });
    });
});
