import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// $lib/config pulls in $app/environment; mock it with the stream ticket helper.
vi.mock('$lib/config', () => ({
  getApiBaseUrl: () => '/api/v1',
  getApiUrl: () => '',
}));
vi.mock('$lib/utils/auth', () => ({
  getAuthToken: () => null,
}));
vi.mock('./stream-tickets', () => ({
  requestStreamTicket: async () => 'tkt',
}));

import { logsAPI, LogQueryError } from './logs';

type FakeResponse = { ok: boolean; status: number; statusText?: string; json: () => Promise<unknown> };

let calls: string[] = [];
let nextResponse: FakeResponse;

function respond(body: unknown, init: Partial<FakeResponse> = {}) {
  nextResponse = { ok: true, status: 200, statusText: 'OK', json: async () => body, ...init };
}

function lastUrl(): URL {
  expect(calls.length).toBeGreaterThan(0);
  return new URL(calls[calls.length - 1], 'http://localhost');
}

beforeEach(() => {
  calls = [];
  respond({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return nextResponse;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const scope = { projectId: ['p1', 'p2'], from: '2026-10-21T09:00:00.000Z', to: '2026-10-21T10:00:00.000Z' };

describe('logsAPI.getLogs', () => {
  it('sends q, cursor and repeated projectId and no searchMode by default', async () => {
    respond({ logs: [], total: 0, hasMore: false });
    await logsAPI.getLogs({ projectId: ['p1', 'p2'], q: 'level:error timeout', cursor: 'c1', limit: 50 });
    const url = lastUrl();
    expect(url.pathname).toBe('/api/v1/logs');
    expect(url.searchParams.getAll('projectId')).toEqual(['p1', 'p2']);
    expect(url.searchParams.get('q')).toBe('level:error timeout');
    expect(url.searchParams.get('cursor')).toBe('c1');
    expect(url.searchParams.has('searchMode')).toBe(false);
  });

  it('throws LogQueryError with the position on a 400 parse error', async () => {
    respond({ error: 'Unexpected ")"', position: 7 }, { ok: false, status: 400, statusText: 'Bad Request' });
    const p = logsAPI.getLogs({ projectId: 'p1', q: 'level:a)' });
    await expect(p).rejects.toMatchObject({ name: 'LogQueryError', message: 'Unexpected ")"', position: 7 });
    await expect(logsAPI.getLogs({ projectId: 'p1', q: 'x' })).rejects.toBeInstanceOf(LogQueryError);
  });

  it('keeps a plain Error for other failures', async () => {
    respond({ error: 'boom' }, { ok: false, status: 500, statusText: 'Internal Server Error' });
    const err = await logsAPI.getLogs({ projectId: 'p1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LogQueryError);
    expect((err as Error).message).toBe('Failed to fetch logs: Internal Server Error');
  });

  it('keeps a plain Error for a 400 without a position', async () => {
    respond({ error: 'Invalid projectId' }, { ok: false, status: 400, statusText: 'Bad Request' });
    const err = await logsAPI.getLogs({ projectId: 'p1' }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(LogQueryError);
    expect((err as Error).message).toBe('Failed to fetch logs: Bad Request');
  });
});

describe('logsAPI.getHistogram', () => {
  it('sends bucketSeconds and the scope', async () => {
    const body = {
      buckets: [{ time: '2026-10-21T09:00:00.000Z', total: 3, byLevel: { error: 1, info: 2 } }],
      bucketSeconds: 60,
      total: 3,
      from: scope.from,
      to: scope.to,
    };
    respond(body);
    const res = await logsAPI.getHistogram({ ...scope, q: 'timeout', bucketSeconds: 60 });
    const url = lastUrl();
    expect(url.pathname.endsWith('/logs/histogram')).toBe(true);
    expect(url.searchParams.get('bucketSeconds')).toBe('60');
    expect(url.searchParams.getAll('projectId')).toEqual(['p1', 'p2']);
    expect(url.searchParams.get('q')).toBe('timeout');
    expect(url.searchParams.get('from')).toBe(scope.from);
    expect(url.searchParams.get('to')).toBe(scope.to);
    expect(res.total).toBe(3);
    expect(res.from).toBe(scope.from);
    expect(res.to).toBe(scope.to);
    expect(res.buckets).toEqual(body.buckets);
  });

  it('omits an empty q', async () => {
    respond({ buckets: [], bucketSeconds: 60, total: 0, from: scope.from, to: scope.to });
    await logsAPI.getHistogram({ ...scope, q: '', bucketSeconds: 60 });
    expect(lastUrl().searchParams.has('q')).toBe(false);
  });

  it('maps a 400 to LogQueryError', async () => {
    respond({ error: 'Unclosed quote', position: 3 }, { ok: false, status: 400 });
    await expect(logsAPI.getHistogram({ ...scope, q: 'a "b', bucketSeconds: 60 })).rejects.toMatchObject({
      name: 'LogQueryError',
      position: 3,
    });
  });
});

describe('logsAPI.getFacets', () => {
  it('joins fields with commas and unwraps facets', async () => {
    const facets = [{ field: 'level', values: [{ value: 'error', count: 2 }], otherCount: 0 }];
    respond({ facets });
    const res = await logsAPI.getFacets({ ...scope, fields: ['level', 'service', 'host', 'user.id'], limit: 10 });
    const url = lastUrl();
    expect(url.pathname.endsWith('/logs/facets')).toBe(true);
    expect(url.searchParams.get('fields')).toBe('level,service,host,user.id');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.getAll('projectId')).toEqual(['p1', 'p2']);
    expect(res).toEqual(facets);
  });

  it('maps a 400 to LogQueryError', async () => {
    respond({ error: 'Bad', position: 0 }, { ok: false, status: 400 });
    await expect(logsAPI.getFacets({ ...scope, fields: ['level'] })).rejects.toBeInstanceOf(LogQueryError);
  });
});

describe('logsAPI.getFields', () => {
  it('unwraps the fields array', async () => {
    const fields = [{ key: 'user.id', occurrences: 12 }];
    respond({ fields });
    const res = await logsAPI.getFields({ projectId: 'p1', from: scope.from, to: scope.to, sampleSize: 500 });
    const url = lastUrl();
    expect(url.pathname.endsWith('/logs/fields')).toBe(true);
    expect(url.searchParams.getAll('projectId')).toEqual(['p1']);
    expect(url.searchParams.get('sampleSize')).toBe('500');
    expect(res).toEqual(fields);
  });
});

describe('logsAPI.getLogContext', () => {
  it('sends sizes, toggles and the reference log id', async () => {
    const body = { before: [], current: null, after: [], applied: { service: 'api', hostname: null } };
    respond(body);
    const res = await logsAPI.getLogContext({
      projectId: 'p1',
      time: '2026-10-21T10:42:13.123Z',
      logId: 'log-1',
      before: 25,
      after: 50,
      sameService: true,
      sameHost: false,
    });
    const url = lastUrl();
    expect(url.pathname.endsWith('/logs/context')).toBe(true);
    expect(url.searchParams.get('projectId')).toBe('p1');
    expect(url.searchParams.get('time')).toBe('2026-10-21T10:42:13.123Z');
    expect(url.searchParams.get('logId')).toBe('log-1');
    expect(url.searchParams.get('before')).toBe('25');
    expect(url.searchParams.get('after')).toBe('50');
    expect(url.searchParams.get('sameService')).toBe('true');
    expect(url.searchParams.has('sameHost')).toBe(false);
    expect(url.searchParams.has('service')).toBe(false);
    expect(url.searchParams.has('hostname')).toBe(false);
    expect(res.applied).toEqual({ service: 'api', hostname: null });
  });
});

describe('logsAPI.createLogsWebSocket', () => {
  let socketUrls: string[] = [];

  beforeEach(() => {
    socketUrls = [];
    class CapturingWebSocket {
      constructor(url: string) {
        socketUrls.push(url);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', CapturingWebSocket);
  });

  it('appends q to the socket url', async () => {
    await logsAPI.createLogsWebSocket({ projectId: 'p1', q: 'level:error' });
    expect(socketUrls).toHaveLength(1);
    expect(socketUrls[0]).toContain('/api/v1/logs/ws?');
    expect(socketUrls[0]).toContain('q=level%3Aerror');
    expect(socketUrls[0]).toContain('ticket=tkt');
  });

  it('keeps the legacy filters', async () => {
    await logsAPI.createLogsWebSocket({ projectId: 'p1', service: 'caddy' });
    const url = new URL(socketUrls[0]);
    expect(url.searchParams.get('projectId')).toBe('p1');
    expect(url.searchParams.get('service')).toBe('caddy');
    expect(url.searchParams.has('q')).toBe(false);
  });
});
