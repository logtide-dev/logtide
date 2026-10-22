import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { hooks } from '../../hooks/index.js';
import { createTestContext } from '../helpers/index.js';
import { seedLogs } from '../modules/query/seed.js';

type Params = Record<string, string | string[]>;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('Logs explorer API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    hooks.clear();
    const ctx = await createTestContext();
    apiKey = ctx.apiKey.plainKey;
    projectId = ctx.project.id;
  });

  afterEach(() => {
    hooks.clear();
  });

  function get(path: string, params: Params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
    }
    return request(app.server).get(`${path}?${qs.toString()}`).set('x-api-key', apiKey);
  }

  describe('GET /api/v1/logs/histogram', () => {
    let from: Date;
    let to: Date;

    beforeEach(async () => {
      from = new Date(Math.floor((Date.now() - 2 * HOUR) / MINUTE) * MINUTE);
      to = new Date(from.getTime() + HOUR);
      await seedLogs(projectId, [
        { message: 'first info', level: 'info', service: 'svc-a', time: new Date(from.getTime() + 5 * MINUTE) },
        { message: 'second info', level: 'info', service: 'svc-b', time: new Date(from.getTime() + 5 * MINUTE + 1000) },
        { message: 'an error', level: 'error', service: 'svc-a', time: new Date(from.getTime() + 30 * MINUTE) },
      ]);
    });

    const histogram = (params: Params) => get('/api/v1/logs/histogram', params);

    it('returns level-stacked zero-filled buckets for one hour', async () => {
      const res = await histogram({ from: from.toISOString(), to: to.toISOString() });
      expect(res.status).toBe(200);
      expect(res.body.bucketSeconds).toBe(60);
      expect(res.body.total).toBe(3);
      expect(res.body.from).toBe(from.toISOString());
      expect(res.body.to).toBe(to.toISOString());
      const buckets = res.body.buckets as { time: string; total: number; byLevel: Record<string, number> }[];
      expect(buckets.length).toBeGreaterThanOrEqual(60);
      expect(buckets.length).toBeLessThanOrEqual(61);

      const at5 = new Date(from.getTime() + 5 * MINUTE).toISOString();
      const at30 = new Date(from.getTime() + 30 * MINUTE).toISOString();
      for (const bucket of buckets) {
        if (bucket.time === at5) {
          expect(bucket.total).toBe(2);
          expect(bucket.byLevel.info).toBe(2);
        } else if (bucket.time === at30) {
          expect(bucket.total).toBe(1);
          expect(bucket.byLevel.error).toBe(1);
        } else {
          expect(bucket.total).toBe(0);
        }
      }
      expect(buckets.some((b) => b.time === at5)).toBe(true);
      expect(buckets.some((b) => b.time === at30)).toBe(true);
    });

    it('applies q', async () => {
      const res = await histogram({ from: from.toISOString(), to: to.toISOString(), q: 'level:error' });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    });

    it('uses the default 24 h window', async () => {
      const res = await histogram({});
      expect(res.status).toBe(200);
      expect(res.body.bucketSeconds).toBe(1800);
      expect(res.body.total).toBe(3);
      const span = new Date(res.body.to).getTime() - new Date(res.body.from).getTime();
      expect(span).toBeGreaterThanOrEqual(24 * HOUR - 1000);
      expect(span).toBeLessThanOrEqual(24 * HOUR + 1000);
    });

    it('honours an explicit bucketSeconds', async () => {
      const res = await histogram({ from: from.toISOString(), to: to.toISOString(), bucketSeconds: '300' });
      expect(res.status).toBe(200);
      expect(res.body.bucketSeconds).toBe(300);
      expect([12, 13]).toContain(res.body.buckets.length);
      expect(res.body.total).toBe(3);

      const longRange = await histogram({
        from: new Date(to.getTime() - 30 * 24 * HOUR).toISOString(),
        to: to.toISOString(),
        bucketSeconds: '1',
      });
      expect(longRange.status).toBe(400);
      expect(longRange.body.error).toBe('Bucket size is too small for this range');

      const zero = await histogram({ from: from.toISOString(), to: to.toISOString(), bucketSeconds: '0' });
      expect(zero.status).toBe(400);
      const tooBig = await histogram({ from: from.toISOString(), to: to.toISOString(), bucketSeconds: '604801' });
      expect(tooBig.status).toBe(400);
    });

    it('returns 400 when to is not after from', async () => {
      const same = await histogram({ from: from.toISOString(), to: from.toISOString() });
      expect(same.status).toBe(400);
      expect(same.body.error).toBe('"to" must be after "from"');
      const reversed = await histogram({ from: to.toISOString(), to: from.toISOString() });
      expect(reversed.status).toBe(400);
    });

    it('returns 400 with position for an invalid q', async () => {
      const res = await histogram({ from: from.toISOString(), to: to.toISOString(), q: 'timeout level:loud' });
      expect(res.status).toBe(400);
      expect(res.body.position).toBe(8);
      expect(typeof res.body.error).toBe('string');
    });

    it('beforeQuery hooks narrow the histogram', async () => {
      hooks.register('beforeQuery', (ctx) => {
        ctx.params.service = 'svc-a';
      });
      const res = await histogram({ from: from.toISOString(), to: to.toISOString() });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
    });

    it('returns empty buckets for a contradiction', async () => {
      const res = await histogram({ from: from.toISOString(), to: to.toISOString(), service: 'svc-a', q: 'service:svc-b' });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.buckets.length).toBeGreaterThanOrEqual(60);
    });
  });
});
