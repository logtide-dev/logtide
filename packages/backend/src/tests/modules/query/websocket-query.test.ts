import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { notificationManager, type LogNotificationEvent } from '../../../modules/streaming/index.js';
import { createTestContext, createTestSession } from '../../helpers/index.js';
import { seedLogs } from './seed.js';

// Live tail over WebSocket with the log query language, on the real app.

interface Connection {
  ws: any;
  messages: any[];
  closed: Promise<{ code: number; reason: string }>;
  next(timeoutMs?: number): Promise<any>;
}

/** Opens the socket and records every message from the first one on. */
async function connect(app: FastifyInstance, path: string): Promise<Connection> {
  const ws = await (app as any).injectWS(path);
  const messages: any[] = [];
  const waiters: ((msg: any) => void)[] = [];
  let read = 0;
  ws.on('message', (data: Buffer | string) => {
    const msg = JSON.parse(data.toString());
    messages.push(msg);
    const waiter = waiters.shift();
    if (waiter) {
      read++;
      waiter(msg);
    }
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('close timed out')), 5000);
    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(t);
      resolve({ code, reason: reason.toString() });
    });
  });
  // Avoid unhandled rejections for sockets the test terminates itself.
  closed.catch(() => {});
  return {
    ws,
    messages,
    closed,
    next(timeoutMs = 3000) {
      if (read < messages.length) return Promise.resolve(messages[read++]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('message timed out')), timeoutMs);
        waiters.push((msg) => {
          clearTimeout(t);
          resolve(msg);
        });
      });
    },
  };
}

function subscriberFor(projectId: string): any {
  const subscribers = Array.from((notificationManager as any).subscribers.values()) as any[];
  return subscribers.find((s) => s.projectId === projectId);
}

async function notify(projectId: string, logIds: string[]): Promise<void> {
  const sub = subscriberFor(projectId);
  expect(sub).toBeDefined();
  const event: LogNotificationEvent = { projectId, logIds, timestamp: new Date().toISOString() };
  await sub.onNotification(event);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WebSocket live tail with q', () => {
  let app: FastifyInstance;
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    projectId = ctx.project.id;
    token = (await createTestSession(ctx.user.id)).token;
  });

  const wsPath = (params: Record<string, string>) => {
    const qs = new URLSearchParams({ projectId, token, ...params });
    return `/api/v1/logs/ws?${qs.toString()}`;
  };

  it('delivers only logs matching q', async () => {
    const [match, other] = await seedLogs(projectId, [
      { message: 'user login timeout', metadata: { region: 'eu' } },
      { message: 'user login timeout', metadata: { region: 'us' } },
    ]);
    const conn = await connect(app, wsPath({ q: 'region:eu timeout' }));
    expect((await conn.next()).type).toBe('connected');

    await notify(projectId, [match.id, other.id]);
    const msg = await conn.next();
    expect(msg.type).toBe('logs');
    expect(msg.logs.map((log: any) => log.id)).toEqual([match.id]);
    conn.ws.terminate();
  });

  it('sends nothing when no log matches q', async () => {
    const [other] = await seedLogs(projectId, [{ message: 'user login ok', metadata: { region: 'eu' } }]);
    const conn = await connect(app, wsPath({ q: 'region:eu timeout' }));
    expect((await conn.next()).type).toBe('connected');

    await notify(projectId, [other.id]);
    await sleep(300);
    expect(conn.messages).toHaveLength(1);
    conn.ws.terminate();
  });

  it('applies substring mode', async () => {
    const seeded = await seedLogs(projectId, [
      { message: 'connection refused by upstream' },
      { message: 'cache refused write' },
      { message: 'refused, by the way' },
    ]);
    const conn = await connect(app, wsPath({ q: 'refused by', searchMode: 'substring' }));
    expect((await conn.next()).type).toBe('connected');

    await notify(projectId, seeded.map((log) => log.id));
    const msg = await conn.next();
    expect(msg.logs.map((log: any) => log.message)).toEqual(['connection refused by upstream']);
    conn.ws.terminate();
  });

  it('combines legacy lists with q', async () => {
    const seeded = await seedLogs(projectId, [
      { message: 'timeout one', service: 'api' },
      { message: 'timeout two', service: 'worker' },
      { message: 'ok three', service: 'api' },
    ]);
    const conn = await connect(app, wsPath({ q: 'timeout', service: 'api' }));
    expect((await conn.next()).type).toBe('connected');

    await notify(projectId, seeded.map((log) => log.id));
    const msg = await conn.next();
    expect(msg.logs.map((log: any) => log.message)).toEqual(['timeout one']);
    conn.ws.terminate();
  });

  it('reports an invalid q and closes with 1008', async () => {
    const before = notificationManager.getStatus().subscriberCount;
    const conn = await connect(app, wsPath({ q: '(timeout' }));
    const msg = await conn.next();
    expect(msg.type).toBe('error');
    expect(typeof msg.error).toBe('string');
    expect(Number.isInteger(msg.position)).toBe(true);

    const { code, reason } = await conn.closed;
    expect(code).toBe(1008);
    expect(reason).toBe('Invalid query');
    expect(conn.messages.some((m) => m.type === 'connected')).toBe(false);
    expect(subscriberFor(projectId)).toBeUndefined();
    expect(notificationManager.getStatus().subscriberCount).toBe(before);
  });

  it('rejects what the REST API rejects with the same text', async () => {
    for (const q of ['service:*api*', 'level:loud', 'a'.repeat(2001)]) {
      const rest = await request(app.server)
        .get('/api/v1/logs')
        .query({ projectId, q })
        .set('Authorization', `Bearer ${token}`);
      expect(rest.status).toBe(400);

      const conn = await connect(app, wsPath({ q }));
      const msg = await conn.next();
      expect(msg).toEqual({ type: 'error', error: rest.body.error, position: rest.body.position });
      expect((await conn.closed).code).toBe(1008);
    }
  });

  it('rejects an unknown searchMode instead of streaming unfiltered', async () => {
    const conn = await connect(app, wsPath({ q: 'timeout', searchMode: 'regex' }));
    const msg = await conn.next();
    expect(msg.type).toBe('error');
    expect((await conn.closed).code).toBe(1008);
  });

  it('closes with 1008 for a foreign project even with q', async () => {
    const other = await createTestContext();
    const path = `/api/v1/logs/ws?${new URLSearchParams({ projectId: other.project.id, token, q: 'timeout' })}`;
    const conn = await connect(app, path);
    const { code, reason } = await conn.closed;
    expect(code).toBe(1008);
    expect(reason).toBe('Access denied for the requested project');
    expect(conn.messages).toEqual([]);
    expect(subscriberFor(other.project.id)).toBeUndefined();
  });

  it('delivers hostname, spanId and sessionId on each log', async () => {
    const sessionId = '6f1c2b0e-4d8a-4c3e-9b7a-2e5d1f0a9c11';
    const [log] = await seedLogs(projectId, [
      {
        message: 'checkout timeout',
        metadata: { hostname: 'web-1' },
        traceId: 't-ws',
        spanId: '00f067aa0ba902b7',
        sessionId,
      },
    ]);
    const conn = await connect(app, wsPath({ q: 'host:web-1' }));
    expect((await conn.next()).type).toBe('connected');

    await notify(projectId, [log.id]);
    const msg = await conn.next();
    expect(msg.logs).toHaveLength(1);
    expect(msg.logs[0]).toMatchObject({
      id: log.id,
      projectId,
      hostname: 'web-1',
      traceId: 't-ws',
      spanId: '00f067aa0ba902b7',
      sessionId,
    });
    conn.ws.terminate();
  });
});
