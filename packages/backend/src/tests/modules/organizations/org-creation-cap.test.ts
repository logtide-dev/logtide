import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { reservoirReady } from '../../../database/reservoir.js';
import { config, configSchema } from '../../../config/index.js';
import { build } from '../../../server.js';
import { startOfUtcMonth } from '../../../capabilities/month.js';
import { createTestUser } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const cfg = config as { MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH?: number; MAX_ORGANIZATIONS_PER_USER?: number };
const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', API_KEY_SECRET: 'x'.repeat(32) };
const KEY = 'MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH';

describe('MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH env validation', () => {
  const parse = (extra: Record<string, string>) => configSchema.safeParse({ ...base, ...extra });

  it('is unlimited when unset or empty', () => {
    const a = parse({});
    expect(a.success && a.data[KEY]).toBeUndefined();
    const b = parse({ [KEY]: '' });
    expect(b.success && b.data[KEY]).toBeUndefined();
  });

  it('accepts a positive integer', () => {
    const r = parse({ [KEY]: '2' });
    expect(r.success && r.data[KEY]).toBe(2);
  });

  it.each(['0', '-1', '1.5', 'abc'])('boot fails on %s', (v) => {
    expect(parse({ [KEY]: v }).success).toBe(false);
  });
});

describe('POST /api/v1/organizations monthly creation cap', () => {
  let app: FastifyInstance;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_creation_log').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();
    const user = await createTestUser({ email: `cc-${Date.now()}@example.com` });
    userId = user.id;
    token = (await createTestSession(userId)).token;
  });

  afterEach(() => {
    delete cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH;
    delete cfg.MAX_ORGANIZATIONS_PER_USER;
  });

  const create = (name: string, tok = token) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { Authorization: `Bearer ${tok}` },
      payload: { name },
    });

  const logRows = (uid: string) =>
    db.selectFrom('organization_creation_log').selectAll().where('user_id', '=', uid).execute();

  it('is unlimited when unset and still writes a log row per creation', async () => {
    for (let i = 0; i < 4; i++) expect((await create(`Org ${i}`)).statusCode).toBe(201);
    const rows = await logRows(userId);
    expect(rows).toHaveLength(4);
    const orgs = await db.selectFrom('organizations').select('id').execute();
    expect(new Set(rows.map((r) => r.organization_id))).toEqual(new Set(orgs.map((o) => o.id)));
  });

  it('blocks the third creation in a month even after deleting the first two orgs', async () => {
    cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 2;
    const a = await create('A');
    const b = await create('B');
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    await db.deleteFrom('organizations').execute();

    const res = await create('C');
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('organization_creation_limit_reached');
    expect(typeof body.message).toBe('string');
    expect(await db.selectFrom('organizations').select('id').execute()).toHaveLength(0);
    expect(await logRows(userId)).toHaveLength(2);
  });

  it('does not count creations from a previous month', async () => {
    cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 1;
    const prev = new Date(startOfUtcMonth(new Date()).getTime() - 3_600_000);
    await db.insertInto('organization_creation_log').values({ user_id: userId, organization_id: null, created_at: prev }).execute();
    expect((await create('Fresh')).statusCode).toBe(201);
    expect((await create('Again')).statusCode).toBe(403);
  });

  it('does not count other users creations', async () => {
    cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 1;
    const other = await createTestUser({ email: `cc-other-${Date.now()}@example.com` });
    await db.insertInto('organization_creation_log').values({ user_id: other.id, organization_id: null }).execute();
    expect((await create('Mine')).statusCode).toBe(201);
  });

  it('checks MAX_ORGANIZATIONS_PER_USER first', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 1;
    cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 1;
    expect((await create('One')).statusCode).toBe(201);
    const res = await create('Two');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('organization_limit_reached');
  });

  it('exactly one of parallel POSTs at the boundary succeeds', async () => {
    cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 1;
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(`Race ${i}`)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 403)).toHaveLength(5);
    expect(await logRows(userId)).toHaveLength(1);
  });

  it('parallel POSTs cannot overshoot MAX_ORGANIZATIONS_PER_USER', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 2;
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(`Own ${i}`)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
  });
});
