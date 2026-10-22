import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { StoredLogRecord } from '@logtide/reservoir';
import { build } from '../../server.js';
import { hooks } from '../../hooks/index.js';
import { createTestContext } from '../helpers/index.js';
import { seedLogs } from '../modules/query/seed.js';

type Params = Record<string, string | string[]>;

describe('Log search API (query language)', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let sessionId: string;
  let rows: Record<'A' | 'B' | 'C' | 'D' | 'E', StoredLogRecord>;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    apiKey = ctx.apiKey.plainKey;
    projectId = ctx.project.id;
    sessionId = crypto.randomUUID();

    const base = Date.now() - 10 * 60 * 1000;
    const at = (minutes: number) => new Date(base + minutes * 60 * 1000);
    const [A, B, C, D, E] = await seedLogs(projectId, [
      { service: 'api', level: 'info', message: 'user login timeout', metadata: { region: 'eu', hostname: 'web-1' }, time: at(1) },
      { service: 'api', level: 'error', message: 'connection refused by upstream', metadata: { region: 'us', hostname: 'web-2' }, time: at(2) },
      { service: 'worker', level: 'debug', message: 'debug tick', metadata: {}, time: at(3) },
      {
        service: 'worker',
        level: 'warn',
        message: 'cache refused write',
        metadata: { region: 'eu' },
        traceId: 't-1',
        sessionId,
        spanId: '00f067aa0ba902b7',
        time: at(4),
      },
      { service: 'api', level: 'critical', message: 'ECONNREFUSED 127.0.0.1:5432', metadata: { hostname: 'web-1' }, time: at(5) },
    ]);
    rows = { A, B, C, D, E };
  });

  function search(params: Params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
    }
    return request(app.server).get(`/api/v1/logs?${qs.toString()}`).set('x-api-key', apiKey);
  }

  async function names(params: Params): Promise<string[]> {
    const res = await search(params);
    expect(res.status).toBe(200);
    const byId = new Map(Object.entries(rows).map(([name, row]) => [row.id, name]));
    return (res.body.logs as { id: string }[]).map((log) => byId.get(log.id) ?? `unknown:${log.id}`).sort();
  }

  it('1 matches a word case-insensitively', async () => {
    expect(await names({ q: 'TIMEOUT' })).toEqual(['A']);
  });

  it('2 matches a quoted phrase', async () => {
    expect(await names({ q: '"connection refused"' })).toEqual(['B']);
  });

  it('3 excludes a word', async () => {
    expect(await names({ q: 'refused -cache' })).toEqual(['B']);
  });

  it('4 ORs free-text words', async () => {
    expect(await names({ q: 'timeout OR tick' })).toEqual(['A', 'C']);
  });

  it('5 filters on service and level built-ins', async () => {
    expect(await names({ q: 'service:worker level:warn' })).toEqual(['D']);
    expect(await names({ q: '-service:worker' })).toEqual(['A', 'B', 'E']);
    expect(await names({ q: 'level:(error OR critical)' })).toEqual(['B', 'E']);
  });

  it('6 filters on host and keeps hostless logs on exclusion', async () => {
    expect(await names({ q: 'host:web-1' })).toEqual(['A', 'E']);
    expect(await names({ q: '-host:web-1' })).toEqual(['B', 'C', 'D']);
  });

  it('7 filters on metadata keys with every operator', async () => {
    expect(await names({ q: 'region:eu' })).toEqual(['A', 'D']);
    expect(await names({ q: '-region:eu' })).toEqual(['B', 'C', 'E']);
    expect(await names({ q: 'region:*' })).toEqual(['A', 'B', 'D']);
    expect(await names({ q: '-region:*' })).toEqual(['C', 'E']);
    expect(await names({ q: 'region:*u*' })).toEqual(['A', 'B', 'D']);
  });

  it('8 filters on trace, session and span and returns them in the payload', async () => {
    expect(await names({ q: 'trace:t-1' })).toEqual(['D']);
    expect(await names({ q: `session:${sessionId}` })).toEqual(['D']);
    expect(await names({ q: 'span:00f067aa0ba902b7' })).toEqual(['D']);

    const res = await search({});
    expect(res.status).toBe(200);
    const byId = new Map((res.body.logs as Record<string, unknown>[]).map((log) => [log.id, log]));
    const d = byId.get(rows.D.id)!;
    expect(d.spanId).toBe('00f067aa0ba902b7');
    expect(d.sessionId).toBe(sessionId);
    expect(d.traceId).toBe('t-1');
    expect(byId.get(rows.A.id)!.hostname).toBe('web-1');
    expect(byId.get(rows.E.id)!.hostname).toBe('web-1');
    expect(byId.get(rows.B.id)!.hostname).toBe('web-2');
    expect(byId.get(rows.C.id)!.hostname).toBeUndefined();

    const one = await request(app.server).get(`/api/v1/logs/${rows.A.id}`).set('x-api-key', apiKey);
    expect(one.status).toBe(200);
    expect(one.body.log.hostname).toBe('web-1');
    const dOne = await request(app.server).get(`/api/v1/logs/${rows.D.id}`).set('x-api-key', apiKey);
    expect(dOne.body.log.spanId).toBe('00f067aa0ba902b7');
    expect(dOne.body.log.sessionId).toBe(sessionId);
  });

  it('9 intersects legacy params with q', async () => {
    expect(await names({ service: 'api', q: 'level:error' })).toEqual(['B']);
    expect(await names({ level: ['error', 'critical'], q: 'level:error' })).toEqual(['B']);
  });

  it('10 returns 400 with a position for a syntax error', async () => {
    const res = await search({ q: '(timeout' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(Number.isInteger(res.body.position)).toBe(true);
  });

  it('11 returns the position of an unknown level', async () => {
    const res = await search({ q: 'timeout level:loud' });
    expect(res.status).toBe(400);
    expect(res.body.position).toBe(8);
    expect(res.body.error).toMatch(/Unknown level/);
  });

  it('12 matches nothing on contradictions and rejects unsupported built-in operators', async () => {
    const res = await search({ service: 'api', q: 'service:worker' });
    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual([]);

    const bad = await search({ q: 'service:*api*' });
    expect(bad.status).toBe(400);
    expect(Number.isInteger(bad.body.position)).toBe(true);
  });

  it('13 keeps substring mode as one phrase', async () => {
    expect(await names({ searchMode: 'substring', q: '127.0.0.1:5432' })).toEqual(['E']);
    expect(await names({ searchMode: 'substring', q: 'level:error' })).toEqual([]);
  });

  it('14 treats colon tokens as free text', async () => {
    expect(await names({ q: '"127.0.0.1:5432"' })).toEqual(['E']);
    expect(await names({ q: '127.0.0.1:5432' })).toEqual(['E']);
  });

  it('15 treats a blank q as no query', async () => {
    expect(await names({ q: '  ' })).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('16 rejects a q longer than 2,000 characters', async () => {
    const res = await search({ q: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Queries can be at most 2,000 characters');
    expect(res.body.position).toBe(2000);
  });

  describe('GET /api/v1/logs/count', () => {
    afterEach(() => {
      hooks.clear();
    });

    function count(params: Params) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
      }
      return request(app.server).get(`/api/v1/logs/count?${qs.toString()}`).set('x-api-key', apiKey);
    }

    it('counts logs matching q', async () => {
      const res = await count({ q: 'region:eu' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 2 });
    });

    it('counts every log without q', async () => {
      const res = await count({});
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
    });

    it('count agrees with the search result', async () => {
      const [counted, searched] = await Promise.all([count({ q: 'refused' }), search({ q: 'refused' })]);
      expect(counted.status).toBe(200);
      expect(searched.status).toBe(200);
      expect(counted.body.count).toBe(searched.body.logs.length);
      expect(counted.body.count).toBe(2);
    });

    it('applies legacy params and contradictions', async () => {
      expect((await count({ service: 'api', q: 'level:error' })).body.count).toBe(1);
      expect((await count({ service: 'api', q: 'service:worker' })).body.count).toBe(0);
    });

    it('returns 400 with position for an invalid q', async () => {
      const res = await count({ q: 'timeout level:loud' });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
      expect(res.body.position).toBe(8);
    });

    it('beforeQuery hooks narrow the count', async () => {
      hooks.register('beforeQuery', (ctx) => {
        ctx.params.service = 'worker';
      });
      const res = await count({});
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });

    it('returns 400 for a malformed metadata_filters param', async () => {
      const res = await count({ metadata_filters: 'not-json' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('metadata_filters must be valid JSON');
    });

    it('returns 400 when from is after to', async () => {
      const res = await count({ from: '2026-10-21T12:00:00.000Z', to: '2026-10-21T11:00:00.000Z' });
      expect(res.status).toBe(400);
    });
  });

  describe('export paging', () => {
    it('pages through q results by cursor', async () => {
      const base = Date.now() - 30 * 60 * 1000;
      await seedLogs(projectId, [
        ...Array.from({ length: 7 }, (_, i) => ({
          message: `exportrun batch item ${i}`,
          time: new Date(base + i * 1000),
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          message: `unrelated item ${i}`,
          time: new Date(base + (i + 10) * 1000),
        })),
      ]);

      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const params: Params = { q: 'exportrun', limit: '3' };
        if (cursor) params.cursor = cursor;
        const res = await search(params);
        expect(res.status).toBe(200);
        for (const log of res.body.logs as { id: string; message: string }[]) {
          expect(log.message).toContain('exportrun');
          seen.add(log.id);
        }
        if (!res.body.hasMore) break;
        cursor = res.body.nextCursor;
        expect(typeof cursor).toBe('string');
      }
      expect(seen.size).toBe(7);
    });
  });
});
