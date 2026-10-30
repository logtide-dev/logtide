import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import type { StoredLogRecord } from '@logtide/reservoir';
import { build } from '../../server.js';
import { db } from '../../database/index.js';
import { truncateAllTables, createTestSession } from '../helpers/index.js';
import { seedLogs } from '../modules/query/seed.js';
import { createIsolatedTenants, type IsolatedTenants } from './helpers.js';

// Tenant isolation for every log explorer endpoint (search with q, count,
// histogram, facets, fields, context) and for saved searches. Logs are seeded
// through the reservoir so the file runs on any storage engine.

const ENDPOINTS: Array<[string, string, Record<string, string>]> = [
  ['search with q', '/api/v1/logs', { q: 'secret:*' }],
  ['count', '/api/v1/logs/count', {}],
  ['histogram', '/api/v1/logs/histogram', {}],
  ['facets', '/api/v1/logs/facets', { fields: 'secret' }],
  ['fields', '/api/v1/logs/fields', {}],
];

describe('Tenant isolation - log explorer API', () => {
  let app: FastifyInstance;
  let t: IsolatedTenants;
  let a1: string;
  let b1: string;
  let b1Key: string;
  let bToken: string;
  let aToken: string;
  let aLogs: StoredLogRecord[];
  let bLogs: StoredLogRecord[];
  let window: { from: string; to: string };

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    t = await createIsolatedTenants();
    a1 = t.orgA.projects[0].id;
    b1 = t.orgB.projects[0].id;
    b1Key = t.orgB.projects[0].apiKey.key;
    aToken = (await createTestSession(t.orgA.ownerUserId)).token;
    bToken = (await createTestSession(t.orgB.ownerUserId)).token;

    const time = new Date(Date.now() - 60 * 1000);
    aLogs = await seedLogs(a1, [
      { message: 'A1 secret event', metadata: { secret: 'a', a_only_marker: 'x' }, time },
      { message: 'A1 second event', metadata: { secret: 'a' }, time },
    ]);
    bLogs = await seedLogs(b1, [{ message: 'B1 secret event', metadata: { secret: 'b' }, time }]);
    window = {
      from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() + 60 * 1000).toISOString(),
    };
  });

  it.each(ENDPOINTS)('org B session user gets 403 for an org A project (%s)', async (_label, path, params) => {
    const res = await request(app.server)
      .get(path)
      .query({ ...params, ...window, projectId: a1 })
      .set('Authorization', `Bearer ${bToken}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('A1 secret');
  });

  it.each(ENDPOINTS)('org B api key gets 403 for an org A project (%s)', async (_label, path, params) => {
    const res = await request(app.server)
      .get(path)
      .query({ ...params, ...window, projectId: a1 })
      .set('x-api-key', b1Key);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('A1 secret');
  });

  it('org B api key without projectId sees only B1 data', async () => {
    const get = (path: string, params: Record<string, string> = {}) =>
      request(app.server).get(path).query({ ...params, ...window }).set('x-api-key', b1Key);

    const search = await get('/api/v1/logs', { q: 'secret:*' });
    expect(search.status).toBe(200);
    expect(search.body.logs.map((l: { id: string }) => l.id)).toEqual([bLogs[0].id]);

    const count = await get('/api/v1/logs/count');
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(1);

    const histogram = await get('/api/v1/logs/histogram');
    expect(histogram.status).toBe(200);
    expect(histogram.body.total).toBe(1);

    const facets = await get('/api/v1/logs/facets', { fields: 'secret' });
    expect(facets.status).toBe(200);
    expect(facets.body.facets).toHaveLength(1);
    expect(facets.body.facets[0].values).toEqual([{ value: 'b', count: 1 }]);
    expect(facets.body.facets[0].otherCount).toBe(0);

    const fields = await get('/api/v1/logs/fields');
    expect(fields.status).toBe(200);
    const keys = fields.body.fields.map((f: { key: string }) => f.key);
    expect(keys).toContain('secret');
    expect(keys).not.toContain('a_only_marker');
    expect(fields.body.fields.find((f: { key: string }) => f.key === 'secret').occurrences).toBe(1);
  });

  it('org B session user with its own project sees only B1 data', async () => {
    const count = await request(app.server)
      .get('/api/v1/logs/count')
      .query({ ...window, projectId: b1, q: 'secret:*' })
      .set('Authorization', `Bearer ${bToken}`);
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(1);

    const mixed = await request(app.server)
      .get('/api/v1/logs/count')
      .query({ ...window, projectId: [b1, a1] })
      .set('Authorization', `Bearer ${bToken}`);
    expect(mixed.status).toBe(403);
  });

  it('context with an org A logId while scoped to B1 is 404', async () => {
    const params = { projectId: b1, time: aLogs[0].time.toISOString(), logId: aLogs[0].id };

    const byKey = await request(app.server).get('/api/v1/logs/context').query(params).set('x-api-key', b1Key);
    expect(byKey.status).toBe(404);
    expect(byKey.body.error).toBe('Log not found');

    const bySession = await request(app.server)
      .get('/api/v1/logs/context')
      .query(params)
      .set('Authorization', `Bearer ${bToken}`);
    expect(bySession.status).toBe(404);
    expect(JSON.stringify(bySession.body)).not.toContain('A1 secret');
  });

  describe('saved searches', () => {
    const state = { q: 'secret:*', projectIds: [] as string[] };

    async function createSearch(token: string, organizationId: string, name: string, visibility = 'organization') {
      const res = await request(app.server)
        .post('/api/v1/saved-searches')
        .set('Authorization', `Bearer ${token}`)
        .send({ organizationId, name, visibility, state });
      expect(res.status).toBe(201);
      return res.body.savedSearch as { id: string };
    }

    it('org B user cannot list org A saved searches', async () => {
      await createSearch(aToken, t.orgA.id, 'A shared');

      const res = await request(app.server)
        .get('/api/v1/saved-searches')
        .query({ organizationId: t.orgA.id })
        .set('Authorization', `Bearer ${bToken}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('A shared');
    });

    it('org B user cannot PATCH or DELETE an org A saved search', async () => {
      const search = await createSearch(aToken, t.orgA.id, 'A shared');
      const call = (method: 'patch' | 'delete', organizationId: string) => {
        const req = request(app.server)
          [method](`/api/v1/saved-searches/${search.id}`)
          .query({ organizationId })
          .set('Authorization', `Bearer ${bToken}`);
        return method === 'patch' ? req.send({ name: 'Taken over' }) : req;
      };

      expect((await call('patch', t.orgB.id)).status).toBe(404);
      expect((await call('delete', t.orgB.id)).status).toBe(404);
      expect((await call('patch', t.orgA.id)).status).toBe(403);
      expect((await call('delete', t.orgA.id)).status).toBe(403);

      const row = await db
        .selectFrom('saved_searches')
        .select('name')
        .where('id', '=', search.id)
        .where('organization_id', '=', t.orgA.id)
        .executeTakeFirstOrThrow();
      expect(row.name).toBe('A shared');
    });

    it('org B user cannot create a saved search in org A or with org A projects', async () => {
      const inA = await request(app.server)
        .post('/api/v1/saved-searches')
        .set('Authorization', `Bearer ${bToken}`)
        .send({ organizationId: t.orgA.id, name: 'Intruder', state });
      expect(inA.status).toBe(403);

      const withA = await request(app.server)
        .post('/api/v1/saved-searches')
        .set('Authorization', `Bearer ${bToken}`)
        .send({ organizationId: t.orgB.id, name: 'Borrowed', state: { ...state, projectIds: [a1] } });
      expect(withA.status).toBe(400);
      expect(withA.body.error).toBe('Some projects do not belong to this organization');
    });

    it("saved search list never returns another org's rows", async () => {
      await createSearch(aToken, t.orgA.id, 'A shared');
      await createSearch(aToken, t.orgA.id, 'A private', 'private');
      const bShared = await createSearch(bToken, t.orgB.id, 'B shared');

      const res = await request(app.server)
        .get('/api/v1/saved-searches')
        .query({ organizationId: t.orgB.id })
        .set('Authorization', `Bearer ${bToken}`);

      expect(res.status).toBe(200);
      expect(res.body.savedSearches.map((s: { id: string }) => s.id)).toEqual([bShared.id]);
      for (const s of res.body.savedSearches) expect(s.organizationId).toBe(t.orgB.id);
    });
  });
});
