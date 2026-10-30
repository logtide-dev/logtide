import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { createTestContext } from '../helpers/index.js';
import { seedLogs } from '../modules/query/seed.js';

// SSE live tail (GET /api/v1/logs/stream) with the log query language, on the
// real app listening on a random port.

type SseEvent = { type: string; data?: { id?: string; message?: string } } & Record<string, unknown>;

interface SseConnection {
  status: number;
  events: SseEvent[];
  waitFor(pred: (e: SseEvent) => boolean, timeoutMs: number): Promise<SseEvent | undefined>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openStream(baseUrl: string, path: string, apiKey: string): Promise<SseConnection> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
    signal: controller.signal,
  });
  const events: SseEvent[] = [];
  let pump: Promise<void> = Promise.resolve();

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx = buffer.indexOf('\n\n');
          while (idx !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
            }
            idx = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // aborted by close()
      }
    })();
  }

  return {
    status: res.status,
    events,
    async waitFor(pred, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = events.find(pred);
        if (found) return found;
        await sleep(50);
      }
      return events.find(pred);
    },
    async close() {
      controller.abort();
      await pump;
    },
  };
}

describe('SSE live tail with q', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let apiKey: string;
  let projectId: string;

  beforeAll(async () => {
    app = await build();
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    apiKey = ctx.apiKey.plainKey;
    projectId = ctx.project.id;
  });

  it('returns 400 with position before streaming for an invalid q', async () => {
    const res = await request(app.server)
      .get('/api/v1/logs/stream')
      .query({ projectId, q: '(timeout' })
      .set('x-api-key', apiKey)
      .timeout(5000);

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
    expect(typeof res.body.error).toBe('string');
    expect(Number.isInteger(res.body.position)).toBe(true);
  });

  it('rejects what GET /api/v1/logs rejects with the same text and position', async () => {
    const q = 'service:*api*';
    const rest = await request(app.server)
      .get('/api/v1/logs')
      .query({ projectId, q })
      .set('x-api-key', apiKey);
    const sse = await request(app.server)
      .get('/api/v1/logs/stream')
      .query({ projectId, q })
      .set('x-api-key', apiKey)
      .timeout(5000);

    expect(rest.status).toBe(400);
    expect(sse.status).toBe(400);
    expect(sse.body).toEqual({ error: rest.body.error, position: rest.body.position });
  });

  it('rejects a q over 2,000 characters with position 2000', async () => {
    const res = await request(app.server)
      .get('/api/v1/logs/stream')
      .query({ projectId, q: 'a'.repeat(2001) })
      .set('x-api-key', apiKey)
      .timeout(5000);

    expect(res.status).toBe(400);
    expect(res.body.position).toBe(2000);
  });

  it('streams only logs matching q', async () => {
    const qs = new URLSearchParams({ projectId, q: 'region:eu' });
    const conn = await openStream(baseUrl, `/api/v1/logs/stream?${qs.toString()}`, apiKey);
    try {
      expect(conn.status).toBe(200);
      const connected = await conn.waitFor((e) => e.type === 'connected', 5000);
      expect(connected).toBeDefined();

      const now = new Date();
      const [eu, us] = await seedLogs(projectId, [
        { message: 'eu checkout started', metadata: { region: 'eu' }, time: now },
        { message: 'us checkout started', metadata: { region: 'us' }, time: now },
      ]);

      const first = await conn.waitFor((e) => e.type === 'log', 5000);
      expect(first?.data?.id).toBe(eu.id);

      await sleep(2500);
      const ids = conn.events.filter((e) => e.type === 'log').map((e) => e.data?.id);
      expect(ids).toContain(eu.id);
      expect(ids).not.toContain(us.id);
    } finally {
      await conn.close();
    }
  });

  it('applies substring mode on the stream', async () => {
    const qs = new URLSearchParams({ projectId, q: 'refused by', searchMode: 'substring' });
    const conn = await openStream(baseUrl, `/api/v1/logs/stream?${qs.toString()}`, apiKey);
    try {
      expect(conn.status).toBe(200);
      await conn.waitFor((e) => e.type === 'connected', 5000);

      const now = new Date();
      const [hit, miss] = await seedLogs(projectId, [
        { message: 'connection refused by upstream', time: now },
        { message: 'by the way, refused', time: now },
      ]);

      const first = await conn.waitFor((e) => e.type === 'log', 5000);
      expect(first?.data?.id).toBe(hit.id);

      await sleep(2500);
      const ids = conn.events.filter((e) => e.type === 'log').map((e) => e.data?.id);
      expect(ids).not.toContain(miss.id);
    } finally {
      await conn.close();
    }
  });
});
