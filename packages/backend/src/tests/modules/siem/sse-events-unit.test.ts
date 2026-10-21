import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDetectionEvents: vi.fn(),
    listUpdatedSince: vi.fn(),
    getItem: vi.fn(),
    getUserOrganizations: vi.fn(),
    getUserById: vi.fn(),
    validateSession: vi.fn(),
    getAuthMode: vi.fn(),
    getDefaultUser: vi.fn(),
    consumeTicket: vi.fn(),
}));

vi.mock('../../../database/index.js', () => ({ db: {} }));

vi.mock('../../../modules/siem/service.js', () => ({
    SiemService: vi.fn(function () {
        return { getDetectionEvents: mocks.getDetectionEvents };
    }),
}));

vi.mock('../../../modules/incidents/service.js', () => ({
    incidentsService: { listUpdatedSince: mocks.listUpdatedSince, getItem: mocks.getItem },
}));

vi.mock('../../../modules/organizations/service.js', () => ({
    OrganizationsService: vi.fn(function () {
        return { getUserOrganizations: mocks.getUserOrganizations };
    }),
}));

vi.mock('../../../modules/users/service.js', () => ({
    UsersService: vi.fn(function () {
        return { getUserById: mocks.getUserById, validateSession: mocks.validateSession };
    }),
}));

vi.mock('../../../modules/settings/service.js', () => ({
    settingsService: { getAuthMode: mocks.getAuthMode },
}));

vi.mock('../../../modules/bootstrap/service.js', () => ({
    bootstrapService: { getDefaultUser: mocks.getDefaultUser },
}));

vi.mock('../../../modules/streaming/stream-ticket-service.js', () => ({
    streamTicketService: { consumeTicket: mocks.consumeTicket },
}));

import { registerSiemSseRoutes, INCIDENT_STREAM_OVERLAP_MS } from '../../../modules/siem/sse-events.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const INCIDENT_ID = '33333333-3333-4333-8333-333333333333';
const USER = { id: 'user-1' };

type Handler = (request: any, reply: any) => Promise<unknown>;

async function captureHandler(): Promise<{ handler: Handler; path: string; opts: any }> {
    let captured: { handler: Handler; path: string; opts: any } | undefined;
    const fakeFastify = {
        get: (path: string, opts: any, handler: Handler) => {
            captured = { handler, path, opts };
        },
    };
    await registerSiemSseRoutes(fakeFastify as any);
    if (!captured) throw new Error('route not registered');
    return captured;
}

function makeRequest(query: Record<string, string>, headers: Record<string, string> = {}) {
    const listeners: Record<string, () => void> = {};
    return {
        query,
        headers,
        raw: {
            on: vi.fn((event: string, cb: () => void) => {
                listeners[event] = cb;
            }),
        },
        listeners,
    };
}

function makeReply() {
    const reply: any = {
        statusCode: 200,
        payload: undefined as unknown,
        writes: [] as string[],
        headers: {} as Record<string, string>,
        hijack: vi.fn(),
    };
    reply.status = vi.fn((code: number) => {
        reply.statusCode = code;
        return reply;
    });
    reply.send = vi.fn((payload: unknown) => {
        reply.payload = payload;
        return reply;
    });
    reply.raw = {
        setHeader: vi.fn((k: string, v: string) => {
            reply.headers[k] = v;
        }),
        write: vi.fn((chunk: string) => {
            reply.writes.push(chunk);
        }),
    };
    return reply;
}

function events(reply: any): any[] {
    return reply.writes
        .filter((w: string) => w.startsWith('data: '))
        .map((w: string) => JSON.parse(w.slice(6).trim()));
}

function incidentEvents(reply: any): any[] {
    return events(reply).filter((e) => e.type.startsWith('incident_'));
}

/** A list item as the incidents service returns it (every row carries updatedAt). */
function item(id: string, createdAt: string, updatedAt: string) {
    return { id, createdAt, updatedAt, source: 'alert', status: 'open' };
}

describe('SIEM SSE route (unit)', () => {
    let handler: Handler;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.getAuthMode.mockResolvedValue('standard');
        mocks.validateSession.mockResolvedValue(USER);
        mocks.getUserOrganizations.mockResolvedValue([{ id: ORG_ID }]);
        mocks.getDetectionEvents.mockResolvedValue([]);
        mocks.listUpdatedSince.mockResolvedValue([]);
        mocks.getItem.mockResolvedValue(null);
        handler = (await captureHandler()).handler;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('registers the GET route with a rate limit', async () => {
        const { path, opts } = await captureHandler();
        expect(path).toBe('/api/v1/siem/events');
        expect(opts.config.rateLimit.max).toBe(10);
        expect(opts.schema.querystring.properties.source).toEqual({ type: 'array', items: { type: 'string' } });
    });

    describe('authentication', () => {
        it('returns 400 with validation details for an invalid organizationId', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: 'nope', token: 't' }), reply);
            expect(reply.statusCode).toBe(400);
            expect(reply.payload.error).toBe('Validation error');
        });

        it('returns 400 for an unknown source', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, source: 'alert,bogus', token: 't' }), reply);
            expect(reply.statusCode).toBe(400);
            expect(reply.payload.error).toBe('Validation error');
        });

        it('returns 500 when an unexpected error happens during setup', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            mocks.getAuthMode.mockRejectedValue(new Error('settings down'));
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);
            expect(reply.statusCode).toBe(500);
            expect(reply.payload).toEqual({
                error: 'Failed to establish SSE connection',
                details: 'settings down',
            });
        });

        it('returns 503 in auth-free mode when no default user exists', async () => {
            mocks.getAuthMode.mockResolvedValue('none');
            mocks.getDefaultUser.mockResolvedValue(null);
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID }), reply);
            expect(reply.statusCode).toBe(503);
            expect(mocks.validateSession).not.toHaveBeenCalled();
        });

        it('uses the default user in auth-free mode', async () => {
            vi.useFakeTimers();
            mocks.getAuthMode.mockResolvedValue('none');
            mocks.getDefaultUser.mockResolvedValue({ id: 'default-user' });
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID }), reply);
            expect(mocks.getUserOrganizations).toHaveBeenCalledWith('default-user');
            expect(reply.hijack).toHaveBeenCalled();
        });

        it('accepts a valid stream ticket', async () => {
            vi.useFakeTimers();
            mocks.consumeTicket.mockResolvedValue('user-1');
            mocks.getUserById.mockResolvedValue(USER);
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, ticket: 'tk' }), reply);
            expect(mocks.consumeTicket).toHaveBeenCalledWith('tk');
            expect(mocks.getUserById).toHaveBeenCalledWith('user-1');
            expect(mocks.validateSession).not.toHaveBeenCalled();
            expect(reply.hijack).toHaveBeenCalled();
        });

        it('returns 401 for an expired ticket without looking up a user', async () => {
            mocks.consumeTicket.mockResolvedValue(null);
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, ticket: 'tk' }), reply);
            expect(reply.statusCode).toBe(401);
            expect(reply.payload.error).toBe('Invalid or expired stream ticket');
            expect(mocks.getUserById).not.toHaveBeenCalled();
        });

        it('returns 401 when the ticket user no longer exists', async () => {
            mocks.consumeTicket.mockResolvedValue('ghost');
            mocks.getUserById.mockResolvedValue(null);
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, ticket: 'tk' }), reply);
            expect(reply.statusCode).toBe(401);
        });

        it('returns 401 for an invalid legacy token', async () => {
            mocks.validateSession.mockResolvedValue(null);
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 'bad' }), reply);
            expect(reply.statusCode).toBe(401);
            expect(reply.payload.error).toBe('Invalid or expired session token');
        });

        it('returns 401 when neither ticket nor token is provided', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID }), reply);
            expect(reply.statusCode).toBe(401);
            expect(reply.payload.error).toBe('A stream ticket or session token is required');
        });

        it('returns 403 when the user is not a member of the organization', async () => {
            mocks.getUserOrganizations.mockResolvedValue([{ id: 'other-org' }]);
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);
            expect(reply.statusCode).toBe(403);
        });
    });

    describe('stream', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
            vi.spyOn(console, 'log').mockImplementation(() => {});
        });

        it('sets SSE headers, echoes the request origin and sends a connected message', async () => {
            const reply = makeReply();
            await handler(
                makeRequest({ organizationId: ORG_ID, token: 't' }, { origin: 'https://app.example.com' }),
                reply,
            );
            expect(reply.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
            expect(reply.headers['Content-Type']).toBe('text/event-stream');
            expect(events(reply)[0].type).toBe('connected');
            expect(reply.hijack).toHaveBeenCalled();
        });

        it('falls back to the localhost origin when no origin header is sent', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);
            expect(reply.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
        });

        it('emits detections, advances the cursor and sends a heartbeat', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, projectId: PROJECT_ID, token: 't' }), reply);

            mocks.getDetectionEvents.mockResolvedValueOnce([
                { id: 'd2', time: '2026-10-01T12:00:05.000Z' },
                { id: 'd1', time: '2026-10-01T12:00:03.000Z' },
            ]);
            await vi.advanceTimersByTimeAsync(2000);

            const sent = events(reply).filter((e) => e.type === 'detection_created');
            expect(sent.map((e) => e.data.id)).toEqual(['d2', 'd1']);
            expect(mocks.getDetectionEvents).toHaveBeenCalledWith({
                organizationId: ORG_ID,
                projectId: PROJECT_ID,
                startTime: new Date('2026-10-01T12:00:00.000Z'),
                limit: 50,
            });
            expect(reply.writes).toContain(': heartbeat\n\n');

            // An older detection must not move the cursor backwards
            mocks.getDetectionEvents.mockResolvedValueOnce([{ id: 'old', time: '2026-10-01T11:00:00.000Z' }]);
            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.getDetectionEvents.mock.calls[1][0].startTime).toEqual(
                new Date('2026-10-01T12:00:05.000Z'),
            );

            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.getDetectionEvents.mock.calls[2][0].startTime).toEqual(
                new Date('2026-10-01T12:00:05.000Z'),
            );
        });

        it('does not re-send the detection that sits at the cursor', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);

            const d1 = { id: 'd1', time: '2026-10-01T12:00:05.000Z' };
            mocks.getDetectionEvents.mockResolvedValueOnce([d1]);
            mocks.getDetectionEvents.mockResolvedValueOnce([d1]);
            // A second detection with the same timestamp is still new
            mocks.getDetectionEvents.mockResolvedValueOnce([{ id: 'd2', time: '2026-10-01T12:00:05.000Z' }, d1]);
            await vi.advanceTimersByTimeAsync(6000);

            const sent = events(reply).filter((e) => e.type === 'detection_created');
            expect(sent.map((e) => e.data.id)).toEqual(['d1', 'd2']);
            expect(mocks.getDetectionEvents.mock.calls.map((c) => c[0].startTime)).toEqual([
                new Date('2026-10-01T12:00:00.000Z'),
                new Date('2026-10-01T12:00:05.000Z'),
                new Date('2026-10-01T12:00:05.000Z'),
            ]);
        });

        it('polls every source with the overlap window', async () => {
            expect(INCIDENT_STREAM_OVERLAP_MS).toBe(5000);
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);

            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.listUpdatedSince).toHaveBeenCalledWith({
                organizationId: ORG_ID,
                projectId: undefined,
                sources: undefined,
                since: new Date('2026-10-01T11:59:55.000Z'),
                limit: 100,
            });
            expect(mocks.getDetectionEvents).toHaveBeenCalledTimes(1);
            expect(mocks.getItem).not.toHaveBeenCalled();
        });

        it('classifies incidents as created or updated and only emits changes', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, projectId: PROJECT_ID, token: 't' }), reply);

            mocks.listUpdatedSince.mockResolvedValueOnce([
                // untouched since before the connection window -> not emitted
                item('stale', '2026-10-01T09:00:00.000Z', '2026-10-01T11:00:00.000Z'),
                // created after the connection -> created
                item('new', '2026-10-01T12:00:10.000Z', '2026-10-01T12:00:10.000Z'),
                // created before, updated after -> updated
                item('upd', '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:20.000Z'),
            ]);
            await vi.advanceTimersByTimeAsync(2000);

            expect(incidentEvents(reply).map((e) => [e.type, e.data.id])).toEqual([
                ['incident_created', 'new'],
                ['incident_updated', 'upd'],
            ]);
            expect(mocks.listUpdatedSince.mock.calls[0][0].projectId).toBe(PROJECT_ID);

            // Same rows again inside the overlap: nothing re-emitted; a newer
            // change of an incident already announced is an update
            mocks.listUpdatedSince.mockResolvedValueOnce([
                item('new', '2026-10-01T12:00:10.000Z', '2026-10-01T12:00:10.000Z'),
                item('upd', '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:20.000Z'),
                item('new', '2026-10-01T12:00:10.000Z', '2026-10-01T12:00:22.000Z'),
            ]);
            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.listUpdatedSince.mock.calls[1][0].since).toEqual(new Date('2026-10-01T12:00:15.000Z'));
            expect(incidentEvents(reply).map((e) => [e.type, e.data.id])).toEqual([
                ['incident_created', 'new'],
                ['incident_updated', 'upd'],
                ['incident_updated', 'new'],
            ]);
        });

        it('delivers an update committed late inside the overlap window exactly once', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);

            const x = item('x', '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:20.000Z');
            const y = item('y', '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:17.000Z');
            mocks.listUpdatedSince.mockResolvedValueOnce([x]);
            await vi.advanceTimersByTimeAsync(2000);
            mocks.listUpdatedSince.mockResolvedValueOnce([y, x]);
            await vi.advanceTimersByTimeAsync(2000);
            mocks.listUpdatedSince.mockResolvedValueOnce([y, x]);
            await vi.advanceTimersByTimeAsync(2000);

            expect(mocks.listUpdatedSince.mock.calls[1][0].since).toEqual(new Date('2026-10-01T12:00:15.000Z'));
            expect(incidentEvents(reply).map((e) => e.data.id)).toEqual(['x', 'y']);
        });

        it('announces an incident created after connecting only once, even after its window passed', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);

            mocks.listUpdatedSince.mockResolvedValueOnce([
                item('n', '2026-10-01T12:00:10.000Z', '2026-10-01T12:00:10.000Z'),
            ]);
            await vi.advanceTimersByTimeAsync(2000);
            // Another incident moves the cursor well past n
            mocks.listUpdatedSince.mockResolvedValueOnce([
                item('z', '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:40.000Z'),
            ]);
            await vi.advanceTimersByTimeAsync(2000);
            mocks.listUpdatedSince.mockResolvedValueOnce([
                item('n', '2026-10-01T12:00:10.000Z', '2026-10-01T12:00:45.000Z'),
            ]);
            await vi.advanceTimersByTimeAsync(2000);

            expect(incidentEvents(reply).map((e) => [e.type, e.data.id])).toEqual([
                ['incident_created', 'n'],
                ['incident_updated', 'z'],
                ['incident_updated', 'n'],
            ]);
        });

        it('keeps making progress when a full page changes inside the overlap window', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);

            const burst = Array.from({ length: 100 }, (_, i) =>
                item(`b${i}`, '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:10.000Z'),
            );
            mocks.listUpdatedSince.mockResolvedValueOnce(burst);
            mocks.listUpdatedSince.mockResolvedValueOnce(burst);
            mocks.listUpdatedSince.mockResolvedValueOnce([
                item('after', '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:11.000Z'),
            ]);
            await vi.advanceTimersByTimeAsync(8000);

            const since = mocks.listUpdatedSince.mock.calls.map((c) => c[0].since);
            expect(since.slice(0, 4)).toEqual([
                new Date('2026-10-01T11:59:55.000Z'),
                // full page: continue after it instead of re-reading the overlap
                new Date('2026-10-01T12:00:10.000Z'),
                // full page with nothing newer than the window start: step past it
                new Date('2026-10-01T12:00:10.001Z'),
                // page no longer full: back to the overlap window
                new Date('2026-10-01T12:00:06.000Z'),
            ]);
            const ids = incidentEvents(reply).map((e) => e.data.id);
            expect(ids).toHaveLength(101);
            expect(ids[100]).toBe('after');
        });

        it('passes the source filter and skips detections without sigma', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, source: 'alert,monitor', token: 't' }), reply);
            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.listUpdatedSince.mock.calls[0][0].sources).toEqual(['alert', 'monitor']);
            expect(mocks.getDetectionEvents).not.toHaveBeenCalled();

            const withSigma = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, source: 'sigma', token: 't' }), withSigma);
            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.getDetectionEvents).toHaveBeenCalled();
            expect(mocks.listUpdatedSince.mock.calls.at(-1)![0].sources).toEqual(['sigma']);
        });

        it('watches a single incident through getItem', async () => {
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, incidentId: INCIDENT_ID, token: 't' }), reply);

            // Tick 1: incident not found
            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.getItem).toHaveBeenCalledWith(INCIDENT_ID, ORG_ID);
            expect(mocks.listUpdatedSince).not.toHaveBeenCalled();

            // Tick 2: updated after the cursor
            mocks.getItem.mockResolvedValueOnce(item(INCIDENT_ID, '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:30.000Z'));
            await vi.advanceTimersByTimeAsync(2000);

            // Tick 3: same timestamp -> no emit
            mocks.getItem.mockResolvedValueOnce(item(INCIDENT_ID, '2026-10-01T10:00:00.000Z', '2026-10-01T12:00:30.000Z'));
            await vi.advanceTimersByTimeAsync(2000);

            const updated = events(reply).filter((e) => e.type === 'incident_updated');
            expect(updated).toHaveLength(1);
            expect(updated[0].data.id).toBe(INCIDENT_ID);
        });

        it('logs polling errors without closing the stream', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const reply = makeReply();
            await handler(makeRequest({ organizationId: ORG_ID, token: 't' }), reply);

            mocks.getDetectionEvents.mockRejectedValueOnce(new Error('db gone'));
            await vi.advanceTimersByTimeAsync(2000);
            expect(errSpy).toHaveBeenCalledWith('Error in SIEM SSE stream:', expect.any(Error));

            await vi.advanceTimersByTimeAsync(2000);
            expect(reply.writes).toContain(': heartbeat\n\n');
        });

        it('stops polling when the client disconnects', async () => {
            const reply = makeReply();
            const request = makeRequest({ organizationId: ORG_ID, token: 't' });
            await handler(request, reply);

            await vi.advanceTimersByTimeAsync(2000);
            expect(mocks.getDetectionEvents).toHaveBeenCalledTimes(1);

            request.listeners.close();
            await vi.advanceTimersByTimeAsync(6000);
            expect(mocks.getDetectionEvents).toHaveBeenCalledTimes(1);
        });
    });
});
