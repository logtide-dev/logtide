import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { truncateAllTables, createTestLog } from '../helpers/index.js';
import { createIsolatedTenants } from './helpers.js';
import { db } from '../../database/index.js';

const FROM = '2000-01-01T00:00:00.000Z';
const TO = '2100-01-01T00:00:00.000Z';

describe('Tenant isolation - API key auth boundary', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  // ---------------------------------------------------------------------------
  // Ingestion side: logs land in the right project
  // ---------------------------------------------------------------------------
  it('logs ingested via A1 key land in A1 project only', async () => {
    const t = await createIsolatedTenants();
    const a1Id = t.orgA.projects[0].id;
    const a1Key = t.orgA.projects[0].apiKey.key;

    const res = await request(app.server)
      .post('/api/v1/ingest')
      .set('x-api-key', a1Key)
      .send({
        logs: [
          {
            time: new Date().toISOString(),
            service: 'test-svc',
            level: 'info',
            message: 'ingest-isolation-check',
          },
        ],
      })
      .expect(200);

    expect(res.body.received).toBe(1);

    // The log must be under a1 project
    const row = await db
      .selectFrom('logs')
      .select(['project_id', 'message'])
      .where('message', '=', 'ingest-isolation-check')
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row!.project_id).toBe(a1Id);

    // B1 project must have zero logs
    const b1Id = t.orgB.projects[0].id;
    const countB = await db
      .selectFrom('logs')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('project_id', '=', b1Id)
      .executeTakeFirstOrThrow();
    expect(Number(countB.n)).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // A1 key cannot query B1 project
  // ---------------------------------------------------------------------------
  it('A1 api key is rejected when querying B1 project', async () => {
    const t = await createIsolatedTenants();
    const a1Key = t.orgA.projects[0].apiKey.key;
    const b1Id = t.orgB.projects[0].id;

    await createTestLog({ projectId: b1Id, message: 'b1-secret', time: new Date() });

    const res = await request(app.server)
      .get('/api/v1/logs')
      .query({ projectId: b1Id, from: FROM, to: TO })
      .set('x-api-key', a1Key);

    if (res.status === 200) {
      // If 200, must not expose b1-secret
      const messages: string[] = res.body.logs.map((l: any) => l.message);
      expect(messages).not.toContain('b1-secret');
    } else {
      expect([401, 403]).toContain(res.status);
    }
  });

  // ---------------------------------------------------------------------------
  // A1 key cannot query A2 project (same org, different project)
  // ---------------------------------------------------------------------------
  it('A1 api key cannot read A2 project logs (same org, different project key)', async () => {
    const t = await createIsolatedTenants();
    const a1Key = t.orgA.projects[0].apiKey.key;
    const a2Id = t.orgA.projects[1].id;

    await createTestLog({ projectId: a2Id, message: 'a2-secret', time: new Date() });

    const res = await request(app.server)
      .get('/api/v1/logs')
      .query({ projectId: a2Id, from: FROM, to: TO })
      .set('x-api-key', a1Key);

    if (res.status === 200) {
      const messages: string[] = res.body.logs.map((l: any) => l.message);
      expect(messages).not.toContain('a2-secret');
    } else {
      expect([401, 403]).toContain(res.status);
    }
  });

  // ---------------------------------------------------------------------------
  // B1 key correctly reads its own ingested log
  // ---------------------------------------------------------------------------
  it('B1 key can read its own ingested log', async () => {
    const t = await createIsolatedTenants();
    const b1Id = t.orgB.projects[0].id;
    const b1Key = t.orgB.projects[0].apiKey.key;

    await request(app.server)
      .post('/api/v1/ingest')
      .set('x-api-key', b1Key)
      .send({
        logs: [
          {
            time: new Date().toISOString(),
            service: 'b1-svc',
            level: 'info',
            message: 'b1-own-log',
          },
        ],
      })
      .expect(200);

    const res = await request(app.server)
      .get('/api/v1/logs')
      .query({ projectId: b1Id, from: FROM, to: TO })
      .set('x-api-key', b1Key)
      .expect(200);

    const messages: string[] = res.body.logs.map((l: any) => l.message);
    expect(messages).toContain('b1-own-log');
  });

  // ---------------------------------------------------------------------------
  // Stats endpoint: A key cannot get stats for B project
  // ---------------------------------------------------------------------------
  it('A1 api key cannot get stats for B1 project', async () => {
    const t = await createIsolatedTenants();
    const a1Id = t.orgA.projects[0].id;
    const a1Key = t.orgA.projects[0].apiKey.key;
    const b1Id = t.orgB.projects[0].id;
    // Different volumes and levels, so the stats tell the projects apart.
    for (let i = 0; i < 2; i++) await createTestLog({ projectId: a1Id, level: 'info', message: `a1-${i}` });
    for (let i = 0; i < 5; i++) await createTestLog({ projectId: b1Id, level: 'error', message: `b1-${i}` });

    const res = await request(app.server)
      .get('/api/v1/stats')
      .query({ projectId: b1Id, from: FROM, to: TO })
      .set('x-api-key', a1Key)
      .expect(200);

    // The route takes the project from the api key and ignores projectId:
    // A1's stats, nothing of B1.
    expect(res.body.total).toBe(2);
    expect(res.body.by_level).toEqual({ info: 2 });
  });
});
