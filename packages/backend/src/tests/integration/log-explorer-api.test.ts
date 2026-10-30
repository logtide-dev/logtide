import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { hooks } from '../../hooks/index.js';
import { createTestContext, createTestProject, createTestSession } from '../helpers/index.js';
import { seedLogs } from '../modules/query/seed.js';

type Params = Record<string, string | string[]>;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('Logs explorer API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let organizationId: string;
  let userId: string;

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
    organizationId = ctx.organization.id;
    userId = ctx.user.id;
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

  describe('GET /api/v1/logs/facets', () => {
    beforeEach(async () => {
      await seedLogs(projectId, [
        { message: 'one', service: 'api', level: 'info', metadata: { region: 'eu', hostname: 'web-1' } },
        { message: 'two', service: 'api', level: 'error', metadata: { region: 'eu', hostname: 'web-2' } },
        { message: 'three', service: 'api', level: 'info', metadata: { region: 'us', hostname: 'web-1' } },
        { message: 'four', service: 'worker', level: 'warn', metadata: {} },
        { message: 'five', service: 'worker', level: 'info' },
      ]);
    });

    const facets = (params: Params) => get('/api/v1/logs/facets', params);
    type Facet = { field: string; values: { value: string; count: number }[]; otherCount: number };
    const byField = (body: { facets: Facet[] }, field: string) => body.facets.find((f) => f.field === field)!;

    it('answers 400, not 500, when the default window ends up reversed', async () => {
      const res = await facets({ fields: 'service', to: '2020-01-01T00:00:00Z' });
      expect(res.status).toBe(400);
      const fields = await get('/api/v1/logs/fields', { to: '2020-01-01T00:00:00Z' });
      expect(fields.status).toBe(400);
    });

    it('counts top values per field', async () => {
      const res = await facets({ fields: 'service,level,region' });
      expect(res.status).toBe(200);
      expect(res.body.facets.map((f: Facet) => f.field)).toEqual(['service', 'level', 'region']);
      expect(byField(res.body, 'service').values).toEqual([
        { value: 'api', count: 3 },
        { value: 'worker', count: 2 },
      ]);
      expect(byField(res.body, 'service').otherCount).toBe(0);
      expect(byField(res.body, 'level').values).toEqual([
        { value: 'info', count: 3 },
        { value: 'error', count: 1 },
        { value: 'warn', count: 1 },
      ]);
      const region = byField(res.body, 'region').values;
      expect(region).toContainEqual({ value: 'eu', count: 2 });
      expect(region).toContainEqual({ value: 'us', count: 1 });
      expect(region).toHaveLength(2);
    });

    it('defaults to level, service and host', async () => {
      const res = await facets({});
      expect(res.status).toBe(200);
      expect(res.body.facets.map((f: Facet) => f.field)).toEqual(['level', 'service', 'host']);
      expect(byField(res.body, 'host').values).toEqual([
        { value: 'web-1', count: 2 },
        { value: 'web-2', count: 1 },
      ]);
    });

    it('reports otherCount beyond the limit', async () => {
      const res = await facets({ fields: 'service', limit: '1' });
      expect(res.status).toBe(200);
      expect(res.body.facets).toEqual([{ field: 'service', values: [{ value: 'api', count: 3 }], otherCount: 2 }]);
    });

    it('applies q', async () => {
      const res = await facets({ q: 'region:eu', fields: 'service' });
      expect(res.status).toBe(200);
      expect(res.body.facets).toEqual([{ field: 'service', values: [{ value: 'api', count: 2 }], otherCount: 0 }]);
    });

    it('echoes keys in request order', async () => {
      const res = await facets({ fields: 'region,host' });
      expect(res.status).toBe(200);
      expect(res.body.facets.map((f: Facet) => f.field)).toEqual(['region', 'host']);
      const hostname = await facets({ fields: 'hostname' });
      expect(hostname.body.facets.map((f: Facet) => f.field)).toEqual(['hostname']);
    });

    it('returns 400 for 13 fields', async () => {
      const res = await facets({ fields: Array.from({ length: 13 }, (_, i) => `k${i}`).join(',') });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('At most 12 facet fields are allowed');
    });

    it('returns 400 for a limit outside 1 to 50', async () => {
      expect((await facets({ fields: 'service', limit: '0' })).status).toBe(400);
      expect((await facets({ fields: 'service', limit: '51' })).status).toBe(400);
    });

    it('returns 400 with position for an invalid q', async () => {
      const res = await facets({ q: 'timeout level:loud' });
      expect(res.status).toBe(400);
      expect(res.body.position).toBe(8);
    });

    it('beforeQuery hooks narrow facet counts', async () => {
      hooks.register('beforeQuery', (ctx) => {
        ctx.params.service = 'worker';
      });
      const res = await facets({ fields: 'service,level' });
      expect(res.status).toBe(200);
      expect(byField(res.body, 'service').values).toEqual([{ value: 'worker', count: 2 }]);
      expect(byField(res.body, 'level').values).toEqual([
        { value: 'info', count: 1 },
        { value: 'warn', count: 1 },
      ]);
    });
  });

  describe('GET /api/v1/logs/fields', () => {
    type Field = { key: string; occurrences: number };
    const fields = (params: Params) => get('/api/v1/logs/fields', params);

    it('lists top-level and nested metadata keys', async () => {
      await seedLogs(projectId, [
        { message: 'a', metadata: { region: 'eu', user: { id: 1, name: 'ann' }, hostname: 'web-1' } },
        { message: 'b', metadata: { region: 'us', user: { id: 2 } } },
      ]);
      const res = await fields({});
      expect(res.status).toBe(200);
      const list = res.body.fields as Field[];
      const keys = list.map((f) => f.key);
      expect(keys).toContain('region');
      expect(keys).toContain('user.id');
      expect(keys).toContain('user.name');
      expect(keys).not.toContain('hostname');
      expect(list.find((f) => f.key === 'region')!.occurrences).toBe(2);
      expect(list.find((f) => f.key === 'user.name')!.occurrences).toBe(1);
      expect(res.body).not.toHaveProperty('keys');
    });

    it('drops built-in names and sorts by occurrences then key', async () => {
      await seedLogs(projectId, [
        { message: 'a', metadata: { zone: 'z1', alpha: 1, level: 'x', service: 'y', trace_id: 't', span: 's', session_id: 'q' } },
        { message: 'b', metadata: { zone: 'z2', beta: 2 } },
      ]);
      const res = await fields({});
      expect(res.status).toBe(200);
      expect(res.body.fields).toEqual([
        { key: 'zone', occurrences: 2 },
        { key: 'alpha', occurrences: 1 },
        { key: 'beta', occurrences: 1 },
      ]);
    });

    it('merges keys across projects', async () => {
      const second = await createTestProject({ organizationId, userId });
      await seedLogs(projectId, [
        { message: 'a', metadata: { region: 'eu', only_first: true } },
        { message: 'b', metadata: { region: 'us' } },
      ]);
      await seedLogs(second.id, [{ message: 'c', metadata: { region: 'eu', only_second: true } }]);
      const session = await createTestSession(userId);

      const res = await request(app.server)
        .get('/api/v1/logs/fields')
        .query({ projectId: [projectId, second.id] })
        .set('Authorization', `Bearer ${session.token}`);
      expect(res.status).toBe(200);
      const list = res.body.fields as Field[];
      expect(list.find((f) => f.key === 'region')!.occurrences).toBe(3);
      expect(list.map((f) => f.key)).toEqual(expect.arrayContaining(['only_first', 'only_second']));
    });

    it('honours the time range', async () => {
      const old = new Date(Date.now() - 3 * HOUR);
      await seedLogs(projectId, [
        { message: 'old', time: old, metadata: { legacy_key: 1 } },
        { message: 'new', metadata: { fresh_key: 1 } },
      ]);
      const res = await fields({
        from: new Date(old.getTime() - MINUTE).toISOString(),
        to: new Date(old.getTime() + MINUTE).toISOString(),
      });
      expect(res.status).toBe(200);
      expect((res.body.fields as Field[]).map((f) => f.key)).toEqual(['legacy_key']);
    });

    it('advertises a 60 per minute rate limit', async () => {
      const res = await fields({});
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('60');
    });

    it('returns 400 for sampleSize 10', async () => {
      expect((await fields({ sampleSize: '10' })).status).toBe(400);
      expect((await fields({ sampleSize: '5001' })).status).toBe(400);
      expect((await fields({ sampleSize: '100' })).status).toBe(200);
    });

    it('beforeQuery hooks narrow the project set', async () => {
      const second = await createTestProject({ organizationId, userId });
      await seedLogs(projectId, [{ message: 'a', metadata: { only_first: 1 } }]);
      await seedLogs(second.id, [{ message: 'b', metadata: { only_second: 1 } }]);
      const session = await createTestSession(userId);
      hooks.register('beforeQuery', (ctx) => {
        ctx.params.projectId = projectId;
      });

      const res = await request(app.server)
        .get('/api/v1/logs/fields')
        .query({ projectId: [projectId, second.id] })
        .set('Authorization', `Bearer ${session.token}`);
      expect(res.status).toBe(200);
      expect(res.body.fields).toEqual([{ key: 'only_first', occurrences: 1 }]);
    });
  });

  describe('GET /api/v1/logs/context', () => {
    const SECOND = 1000;
    let anchorTime: Date;

    beforeEach(() => {
      anchorTime = new Date(Math.floor((Date.now() - 3 * HOUR) / MINUTE) * MINUTE);
    });

    const at = (offsetSeconds: number) => new Date(anchorTime.getTime() + offsetSeconds * SECOND);
    const context = (params: Params) => get('/api/v1/logs/context', params);
    type Row = { id: string; message: string; service: string; hostname?: string; sessionId?: string; spanId?: string };

    it('returns up to 100 logs on each side', async () => {
      const rows = [];
      for (let i = 110; i >= 1; i--) rows.push({ message: `before ${i}`, time: at(-i) });
      rows.push({ message: 'anchor', time: at(0) });
      for (let i = 1; i <= 110; i++) rows.push({ message: `after ${i}`, time: at(i) });
      const seeded = await seedLogs(projectId, rows);
      const anchor = seeded[110];

      const res = await context({ time: anchorTime.toISOString(), logId: anchor.id, before: '100', after: '100' });
      expect(res.status).toBe(200);
      expect(res.body.before).toHaveLength(100);
      expect(res.body.after).toHaveLength(100);
      expect(res.body.before[0].message).toBe('before 100');
      expect(res.body.before[99].message).toBe('before 1');
      expect(res.body.after[0].message).toBe('after 1');
      expect(res.body.after[99].message).toBe('after 100');
      expect(res.body.current.id).toBe(anchor.id);

      expect((await context({ time: anchorTime.toISOString(), before: '101' })).status).toBe(400);
      expect((await context({ time: anchorTime.toISOString(), after: '101' })).status).toBe(400);
      expect((await context({ time: anchorTime.toISOString(), before: '-1' })).status).toBe(400);
    });

    it('before=0 returns no earlier logs', async () => {
      const rows = [];
      for (let i = 12; i >= 1; i--) rows.push({ message: `before ${i}`, time: at(-i) });
      rows.push({ message: 'anchor', time: at(0) });
      for (let i = 1; i <= 12; i++) rows.push({ message: `after ${i}`, time: at(i) });
      await seedLogs(projectId, rows);

      const res = await context({ time: anchorTime.toISOString(), before: '0' });
      expect(res.status).toBe(200);
      expect(res.body.before).toEqual([]);
      expect(res.body.after).toHaveLength(10);
      expect(res.body.current.message).toBe('anchor');

      const noAfter = await context({ time: anchorTime.toISOString(), after: '0' });
      expect(noAfter.body.after).toEqual([]);
      expect(noAfter.body.before).toHaveLength(10);
      expect(noAfter.body.applied).toEqual({ service: null, hostname: null });
    });

    it('sameService keeps only the anchor service', async () => {
      const rows = [];
      for (let i = 1; i <= 6; i++) {
        rows.push({ message: `before ${i}`, service: i % 2 ? 'api' : 'worker', time: at(-i) });
        rows.push({ message: `after ${i}`, service: i % 2 ? 'worker' : 'api', time: at(i) });
      }
      rows.push({ message: 'anchor', service: 'api', time: at(0) });
      await seedLogs(projectId, rows);

      const res = await context({ time: anchorTime.toISOString(), sameService: 'true' });
      expect(res.status).toBe(200);
      const all = [...res.body.before, ...res.body.after] as Row[];
      expect(res.body.before).toHaveLength(3);
      expect(res.body.after).toHaveLength(3);
      expect(all.every((row) => row.service === 'api')).toBe(true);
      expect(res.body.applied).toEqual({ service: 'api', hostname: null });

      const unfiltered = await context({ time: anchorTime.toISOString() });
      expect(unfiltered.body.before).toHaveLength(6);
      expect(unfiltered.body.applied).toEqual({ service: null, hostname: null });
    });

    it('sameHost keeps only the anchor host', async () => {
      const rows = [];
      for (let i = 1; i <= 6; i++) {
        rows.push({ message: `before ${i}`, time: at(-i), metadata: { hostname: i % 2 ? 'web-1' : 'web-2' } });
        rows.push({ message: `after ${i}`, time: at(i), metadata: i % 3 === 0 ? {} : { hostname: i % 2 ? 'web-2' : 'web-1' } });
      }
      rows.push({ message: 'anchor', time: at(0), metadata: { hostname: 'web-1' } });
      await seedLogs(projectId, rows);

      const res = await context({ time: anchorTime.toISOString(), sameHost: 'true' });
      expect(res.status).toBe(200);
      const all = [...res.body.before, ...res.body.after] as Row[];
      expect(all.every((row) => row.hostname === 'web-1')).toBe(true);
      // before: i = 1, 3, 5 are web-1; after: i = 2, 4 are web-1 (6 has no host)
      expect(res.body.before).toHaveLength(3);
      expect(res.body.after).toHaveLength(2);
      expect(res.body.applied).toEqual({ service: null, hostname: 'web-1' });
    });

    it('sameHost is not applied when the anchor has no host', async () => {
      await seedLogs(projectId, [
        { message: 'b2', time: at(-2), metadata: { hostname: 'web-1' } },
        { message: 'b1', time: at(-1), metadata: { hostname: 'web-2' } },
        { message: 'anchor', time: at(0), metadata: { hostname: '' } },
        { message: 'a1', time: at(1), metadata: { hostname: 'web-3' } },
      ]);

      const res = await context({ time: anchorTime.toISOString(), sameHost: 'true', sameService: 'true' });
      expect(res.status).toBe(200);
      expect(res.body.applied).toEqual({ service: 'api', hostname: null });
      const hosts = new Set([...res.body.before, ...res.body.after].map((row: Row) => row.hostname));
      expect(hosts).toEqual(new Set(['web-1', 'web-2', 'web-3']));
    });

    it('logId anchors the context', async () => {
      const seeded = await seedLogs(projectId, [
        { message: 'api before', service: 'api', time: at(-2) },
        { message: 'worker before', service: 'worker', time: at(-1) },
        { message: 'api twin', service: 'api', time: at(0) },
        { message: 'worker twin', service: 'worker', time: at(0) },
        { message: 'api after', service: 'api', time: at(1) },
        { message: 'worker after', service: 'worker', time: at(2) },
      ]);
      const worker = seeded[3];

      const res = await context({ time: anchorTime.toISOString(), logId: worker.id, sameService: 'true' });
      expect(res.status).toBe(200);
      expect(res.body.current.id).toBe(worker.id);
      expect(res.body.before.map((row: Row) => row.message)).toEqual(['worker before']);
      expect(res.body.after.map((row: Row) => row.message)).toEqual(['worker after']);
      expect(res.body.applied).toEqual({ service: 'worker', hostname: null });
    });

    it('returns 404 for an unknown logId', async () => {
      await seedLogs(projectId, [{ message: 'anchor', time: at(0) }]);
      const res = await context({ time: anchorTime.toISOString(), logId: '00000000-0000-4000-8000-000000000000' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Log not found');

      const notUuid = await context({ time: anchorTime.toISOString(), logId: 'nope' });
      expect(notUuid.status).toBe(400);
    });

    it('rows carry hostname, sessionId and spanId', async () => {
      const sessionId = '6f1c2b0e-4d8a-4c3e-9b7a-2e5d1f0a9c11';
      await seedLogs(projectId, [
        { message: 'before', time: at(-1), metadata: { hostname: 'web-1' }, sessionId, spanId: '00f067aa0ba902b7', traceId: 't-ctx' },
        { message: 'anchor', time: at(0), metadata: { hostname: 'web-2' } },
        { message: 'after', time: at(1), metadata: { hostname: 'web-3' }, sessionId, spanId: '00f067aa0ba902b8' },
      ]);

      const res = await context({ time: anchorTime.toISOString() });
      expect(res.status).toBe(200);
      expect(res.body.before[0]).toMatchObject({ hostname: 'web-1', sessionId, spanId: '00f067aa0ba902b7', traceId: 't-ctx' });
      expect(res.body.current).toMatchObject({ hostname: 'web-2', message: 'anchor' });
      expect(res.body.after[0]).toMatchObject({ hostname: 'web-3', sessionId, spanId: '00f067aa0ba902b8' });
    });

    it('ignores client-sent service and hostname', async () => {
      await seedLogs(projectId, [
        { message: 'other before', service: 'other', time: at(-2), metadata: { hostname: 'web-9' } },
        { message: 'api before', service: 'api', time: at(-1), metadata: { hostname: 'web-1' } },
        { message: 'anchor', service: 'api', time: at(0), metadata: { hostname: 'web-1' } },
        { message: 'other after', service: 'other', time: at(1), metadata: { hostname: 'web-9' } },
      ]);

      const res = await context({
        time: anchorTime.toISOString(),
        sameService: 'true',
        service: 'other',
        hostname: 'web-9',
      });
      expect(res.status).toBe(200);
      expect(res.body.applied).toEqual({ service: 'api', hostname: null });
      expect(res.body.before.map((row: Row) => row.message)).toEqual(['api before']);
      expect(res.body.after).toEqual([]);
    });
  });
});
