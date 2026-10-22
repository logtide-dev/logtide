import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeSessionCursor, encodeSessionCursor } from '@logtide/reservoir';
import { sessionsService } from '../../../modules/sessions/service.js';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { createTestContext } from '../../helpers/factories.js';

type EngineSession = {
    sessionId: string;
    service: string;
    firstEvent: Date;
    lastEvent: Date;
    eventCount: number;
    errorCount: number;
};

const FROM = new Date('2025-01-01T00:00:00Z');
const TO = new Date('2025-01-02T00:00:00Z');

function makeSession(i: number, errorCount = 0, service = 'web'): EngineSession {
    // Strictly decreasing lastEvent so index order equals engine order.
    const last = new Date(TO.getTime() - i * 60_000);
    return {
        sessionId: `s-${String(i).padStart(4, '0')}`,
        service,
        firstEvent: new Date(last.getTime() - 30_000),
        lastEvent: last,
        eventCount: 3,
        errorCount,
    };
}

/** Fake engine with the reservoir listSessions contract (cursor on lastEvent desc). */
function installEngine(all: EngineSession[]) {
    return vi.spyOn(reservoir, 'listSessions').mockImplementation(async (params: any) => {
        let start = 0;
        if (params.cursor) {
            const { sessionId } = decodeSessionCursor(params.cursor);
            start = all.findIndex((s) => s.sessionId === sessionId) + 1;
        }
        const filtered = all.filter((s) => !params.service || s.service === params.service);
        const slice = filtered.slice(start, start + Math.min(params.limit, 200));
        const hasMore = start + slice.length < filtered.length;
        const tail = slice[slice.length - 1];
        return {
            sessions: slice,
            ...(hasMore && tail ? { nextCursor: encodeSessionCursor(tail.lastEvent, tail.sessionId) } : {}),
        };
    });
}

describe('SessionsService', () => {
    let testProject: any;

    beforeEach(async () => {
        const ctx = await createTestContext();
        testProject = ctx.project;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function insertSessionLog(overrides: {
        projectId: string;
        sessionId: string;
        service?: string;
        level?: string;
        message?: string;
        time?: Date;
        metadata?: Record<string, unknown>;
        traceId?: string;
    }) {
        return db
            .insertInto('logs')
            .values({
                project_id: overrides.projectId,
                service: overrides.service ?? 'web',
                level: (overrides.level ?? 'info') as any,
                message: overrides.message ?? 'Page loaded',
                time: overrides.time ?? new Date(),
                session_id: overrides.sessionId,
                metadata: overrides.metadata ?? null,
                trace_id: overrides.traceId ?? null,
            } as any)
            .returningAll()
            .executeTakeFirstOrThrow();
    }

    // =========================================================================
    // listSessions()
    // =========================================================================

    describe('listSessions()', () => {
        it('listSessions goes through reservoir.listSessions on every engine', async () => {
            const spy = installEngine([makeSession(0), makeSession(1)]);
            const selectSpy = vi.spyOn(db, 'selectFrom');

            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, limit: 25,
            });

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0]).toMatchObject({ projectId: testProject.id, from: FROM, to: TO, limit: 25 });
            expect(selectSpy.mock.calls.some(([table]) => String(table).startsWith('logs'))).toBe(false);
            expect(result.sessions.map((s) => s.sessionId)).toEqual(['s-0000', 's-0001']);
            expect(result.sessions[0].durationMs).toBe(30_000);
            expect(typeof result.sessions[0].firstEvent).toBe('string');
        });

        it('no total or sampled in the response', async () => {
            installEngine([makeSession(0)]);
            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, limit: 25,
            });
            expect(result).not.toHaveProperty('total');
            expect(result).not.toHaveProperty('sampled');
            expect(result).not.toHaveProperty('nextCursor');
        });

        it('passes the engine cursor through', async () => {
            installEngine(Array.from({ length: 5 }, (_, i) => makeSession(i)));
            const page1 = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, limit: 2,
            });
            expect(page1.sessions.map((s) => s.sessionId)).toEqual(['s-0000', 's-0001']);
            expect(page1.nextCursor).toBeDefined();

            const page2 = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, limit: 2, cursor: page1.nextCursor,
            });
            expect(page2.sessions.map((s) => s.sessionId)).toEqual(['s-0002', 's-0003']);
        });

        it('hasErrors filters on errorCount > 0 and pages through the cursor', async () => {
            // 450 sessions, only every 100th has errors: needs several engine pages.
            const all = Array.from({ length: 450 }, (_, i) => makeSession(i, i % 100 === 0 ? 2 : 0));
            const spy = installEngine(all);

            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, hasErrors: true, limit: 3,
            });

            expect(result.sessions.map((s) => s.sessionId)).toEqual(['s-0000', 's-0100', 's-0200']);
            expect(result.sessions.every((s) => s.errorCount > 0)).toBe(true);
            expect(spy.mock.calls.length).toBeGreaterThan(1);
            expect(spy.mock.calls.every(([p]: any[]) => p.limit === 200)).toBe(true);
            // More error sessions exist (s-0300): cursor is that of the last returned row.
            expect(result.nextCursor).toBe(encodeSessionCursor(all[200].lastEvent, 's-0200'));

            const next = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, hasErrors: true, limit: 3, cursor: result.nextCursor,
            });
            expect(next.sessions.map((s) => s.sessionId)).toEqual(['s-0300', 's-0400']);
            expect(next.nextCursor).toBeUndefined();
        });

        it('hasErrors=false keeps only sessions without errors', async () => {
            installEngine([makeSession(0, 1), makeSession(1, 0), makeSession(2, 3), makeSession(3, 0)]);
            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, hasErrors: false, limit: 10,
            });
            expect(result.sessions.map((s) => s.sessionId)).toEqual(['s-0001', 's-0003']);
            expect(result.nextCursor).toBeUndefined();
        });

        it('stops after 10 pages and resumes from the last scanned row', async () => {
            const all = Array.from({ length: 2500 }, (_, i) => makeSession(i, 0));
            const spy = installEngine(all);
            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, hasErrors: true, limit: 5,
            });
            expect(spy).toHaveBeenCalledTimes(10);
            expect(result.sessions).toEqual([]);
            expect(result.nextCursor).toBe(encodeSessionCursor(all[1999].lastEvent, 's-1999'));
        });

        it('forwards the service filter to the engine', async () => {
            const spy = installEngine([makeSession(0, 0, 'web'), makeSession(1, 0, 'api')]);
            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, service: 'api', limit: 25,
            });
            expect(spy.mock.calls[0][0]).toMatchObject({ service: 'api' });
            expect(result.sessions.map((s) => s.sessionId)).toEqual(['s-0001']);
        });

        it('includes browser os device entryUrl user from first event metadata', async () => {
            installEngine([makeSession(0)]);
            vi.spyOn(reservoir, 'query').mockResolvedValue({
                logs: [{
                    id: 'x', time: FROM, service: 'web', level: 'info', message: 'm',
                    metadata: {
                        browser: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36' },
                        page: { url: 'https://app.example.com/home' },
                        user: { id: 'u-42' },
                    },
                }],
                total: 1, hasMore: false, limit: 1, offset: 0,
            } as any);

            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, limit: 25,
            });

            expect(result.sessions[0]).toMatchObject({
                browser: 'Chrome', os: 'Windows', device: 'desktop',
                entryUrl: 'https://app.example.com/home', user: 'u-42',
            });
            expect((reservoir.query as any).mock.calls[0][0]).toMatchObject({
                projectId: testProject.id, sessionId: 's-0000', limit: 1, sortBy: 'time', sortOrder: 'asc',
            });
        });

        it('reads flat metadata keys and falls back through the key order', async () => {
            installEngine([makeSession(0)]);
            vi.spyOn(reservoir, 'query').mockResolvedValue({
                logs: [{
                    id: 'x', time: FROM, service: 'web', level: 'info', message: 'm',
                    metadata: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', 'page.pathname': '/pricing', userId: 'abc' },
                }],
                total: 1, hasMore: false, limit: 1, offset: 0,
            } as any);
            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, limit: 25,
            });
            expect(result.sessions[0]).toMatchObject({ browser: 'Safari', os: 'macOS', entryUrl: '/pricing', user: 'abc' });
        });

        it('omits entry fields when metadata absent or the lookup fails', async () => {
            installEngine([makeSession(0), makeSession(1)]);
            const querySpy = vi.spyOn(reservoir, 'query')
                .mockResolvedValueOnce({ logs: [{ id: 'x', time: FROM, service: 'web', level: 'info', message: 'm' }], total: 1, hasMore: false, limit: 1, offset: 0 } as any)
                .mockRejectedValueOnce(new Error('boom'));

            const result = await sessionsService.listSessions({
                projectId: testProject.id, from: FROM, to: TO, limit: 25,
            });

            expect(querySpy).toHaveBeenCalledTimes(2);
            for (const s of result.sessions) {
                expect(s.browser).toBeUndefined();
                expect(s.os).toBeUndefined();
                expect(s.device).toBeUndefined();
                expect(s.entryUrl).toBeUndefined();
                expect(s.user).toBeUndefined();
            }
        });

        it('limits entry lookups to 5 concurrent queries', async () => {
            installEngine(Array.from({ length: 12 }, (_, i) => makeSession(i)));
            let active = 0;
            let peak = 0;
            vi.spyOn(reservoir, 'query').mockImplementation(async () => {
                active++;
                peak = Math.max(peak, active);
                await new Promise((r) => setTimeout(r, 5));
                active--;
                return { logs: [], total: 0, hasMore: false, limit: 1, offset: 0 } as any;
            });
            await sessionsService.listSessions({ projectId: testProject.id, from: FROM, to: TO, limit: 25 });
            expect(peak).toBeLessThanOrEqual(5);
            expect(peak).toBeGreaterThan(1);
        });
    });

    // =========================================================================
    // getSessionEvents()
    // =========================================================================

    describe('getSessionEvents()', () => {
        it('returns empty result when no events exist for session', async () => {
            const result = await sessionsService.getSessionEvents({
                projectId: testProject.id,
                sessionId: 'nonexistent-session',
            });
            expect(result).toEqual({ events: [], window: null, truncated: false });
        });

        it('returns events for the given session in chronological order with a window', async () => {
            const t1 = new Date('2025-01-01T10:00:00Z');
            const t2 = new Date('2025-01-01T10:01:00Z');
            await insertSessionLog({ projectId: testProject.id, sessionId: 'sess-abc', message: 'Second', time: t2 });
            await insertSessionLog({ projectId: testProject.id, sessionId: 'sess-abc', message: 'First', time: t1 });
            await insertSessionLog({ projectId: testProject.id, sessionId: 'sess-other', message: 'Other', time: t1 });

            const result = await sessionsService.getSessionEvents({
                projectId: testProject.id,
                sessionId: 'sess-abc',
            });

            expect(result.events.map((e) => e.message)).toEqual(['First', 'Second']);
            expect(result.window).toEqual({ from: t1.toISOString(), to: t2.toISOString() });
            expect(result.truncated).toBe(false);
        });

        it('getSessionEvents returns window and truncated=true at limit', async () => {
            for (let i = 0; i < 4; i++) {
                await insertSessionLog({
                    projectId: testProject.id, sessionId: 'sess-limit', message: `e${i}`,
                    time: new Date(Date.UTC(2025, 0, 1, 10, i)),
                });
            }
            const result = await sessionsService.getSessionEvents({
                projectId: testProject.id, sessionId: 'sess-limit', limit: 3,
            });
            expect(result.events.length).toBe(3);
            expect(result.truncated).toBe(true);
            expect(result.window).toEqual({
                from: new Date(Date.UTC(2025, 0, 1, 10, 0)).toISOString(),
                to: new Date(Date.UTC(2025, 0, 1, 10, 2)).toISOString(),
            });

            const all = await sessionsService.getSessionEvents({
                projectId: testProject.id, sessionId: 'sess-limit', limit: 4,
            });
            expect(all.truncated).toBe(false);
        });

        it('maps event fields to the SessionEvent shape', async () => {
            await insertSessionLog({
                projectId: testProject.id,
                sessionId: 'sess-shape',
                service: 'frontend',
                level: 'warn',
                message: 'Slow render',
            });
            const { events } = await sessionsService.getSessionEvents({
                projectId: testProject.id,
                sessionId: 'sess-shape',
            });
            expect(events.length).toBe(1);
            expect(events[0].service).toBe('frontend');
            expect(events[0].level).toBe('warn');
            expect(events[0].message).toBe('Slow render');
            expect(events[0].id).toBeDefined();
            expect(events[0].errorGroupId).toBeUndefined();
        });

        it('getSessionEvents returns errorGroupId for error events with an exception row', async () => {
            const ctx = await createTestContext();
            const orgId = ctx.organization.id;
            const projectId = ctx.project.id;
            const errLog = await insertSessionLog({ projectId, sessionId: 'sess-err', level: 'error', message: 'boom' });
            const plainErr = await insertSessionLog({ projectId, sessionId: 'sess-err', level: 'error', message: 'no exception' });
            await insertSessionLog({ projectId, sessionId: 'sess-err', level: 'info', message: 'fine' });

            await db.insertInto('exceptions').values({
                organization_id: orgId,
                project_id: projectId,
                log_id: errLog.id,
                exception_type: 'TypeError',
                exception_message: 'x is undefined',
                language: 'javascript',
                fingerprint: 'fp-session-test',
                raw_stack_trace: 'TypeError: x is undefined\n    at a (a.js:1:1)',
                frame_count: 1,
                service: 'web',
            } as any).execute();

            const group = await db
                .selectFrom('error_groups')
                .select('id')
                .where('organization_id', '=', orgId)
                .where('fingerprint', '=', 'fp-session-test')
                .executeTakeFirstOrThrow();

            const { events } = await sessionsService.getSessionEvents({ projectId, sessionId: 'sess-err' });
            const withGroup = events.find((e) => e.id === errLog.id);
            expect(withGroup?.errorGroupId).toBe(group.id);
            expect(events.find((e) => e.id === plainErr.id)?.errorGroupId).toBeUndefined();
            expect(events.filter((e) => e.errorGroupId).length).toBe(1);
        });

        it('does not link an error group of another project', async () => {
            const other = await createTestContext();
            const log = await insertSessionLog({ projectId: testProject.id, sessionId: 'sess-iso', level: 'error' });
            // Exception row claims the same log id but belongs to another organization.
            await db.insertInto('exceptions').values({
                organization_id: other.organization.id,
                project_id: other.project.id,
                log_id: log.id,
                exception_type: 'Error',
                exception_message: 'm',
                language: 'javascript',
                fingerprint: 'fp-foreign',
                raw_stack_trace: 'Error: m\n    at a (a.js:1:1)',
                frame_count: 1,
                service: 'web',
            } as any).execute();

            const { events } = await sessionsService.getSessionEvents({ projectId: testProject.id, sessionId: 'sess-iso' });
            expect(events[0].errorGroupId).toBeUndefined();
        });
    });

    // =========================================================================
    // hasRecentSessions()
    // =========================================================================

    describe('hasRecentSessions()', () => {
        it('hasRecentSessions false for project without sessions', async () => {
            const spy = vi.spyOn(reservoir, 'hasSessions').mockResolvedValue(false);
            expect(await sessionsService.hasRecentSessions(testProject.id)).toBe(false);
            const args = spy.mock.calls[0][0] as any;
            expect(args.projectId).toBe(testProject.id);
            expect(args.to.getTime() - args.from.getTime()).toBe(24 * 60 * 60 * 1000);
        });

        it('returns true when the engine reports sessions', async () => {
            vi.spyOn(reservoir, 'hasSessions').mockResolvedValue(true);
            expect(await sessionsService.hasRecentSessions(testProject.id)).toBe(true);
        });
    });
});
