import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { config, configSchema } from '../../../config/index.js';
import { organizationsRoutes } from '../../../modules/organizations/routes.js';
import { createTestUser } from '../../helpers/factories.js';

const cfg = config as { MAX_ORGANIZATIONS_PER_USER?: number };
const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_KEY_SECRET: 'x'.repeat(32),
};

async function session(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 86_400_000) })
    .execute();
  return token;
}

async function ownOrg(userId: string, n: number) {
  const org = await db
    .insertInto('organizations')
    .values({ name: `Org ${n}`, slug: `lim-${n}-${crypto.randomBytes(3).toString('hex')}`, owner_id: userId })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.insertInto('organization_members').values({ organization_id: org.id, user_id: userId, role: 'owner' }).execute();
  return org;
}

describe('MAX_ORGANIZATIONS_PER_USER env validation', () => {
  const parse = (extra: Record<string, string>) => configSchema.safeParse({ ...base, ...extra });

  it('is unlimited when unset or empty', () => {
    const a = parse({});
    expect(a.success && a.data.MAX_ORGANIZATIONS_PER_USER).toBeUndefined();
    const b = parse({ MAX_ORGANIZATIONS_PER_USER: '' });
    expect(b.success && b.data.MAX_ORGANIZATIONS_PER_USER).toBeUndefined();
  });

  it('accepts a positive integer', () => {
    const r = parse({ MAX_ORGANIZATIONS_PER_USER: '3' });
    expect(r.success && r.data.MAX_ORGANIZATIONS_PER_USER).toBe(3);
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects %s', (v) => {
    expect(parse({ MAX_ORGANIZATIONS_PER_USER: v }).success).toBe(false);
  });
});

describe('POST /api/v1/organizations per-user cap', () => {
  let app: FastifyInstance;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(organizationsRoutes, { prefix: '/api/v1/organizations' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();
    const user = await createTestUser({ email: `cap-${Date.now()}@example.com` });
    userId = user.id;
    token = await session(userId);
  });

  afterEach(() => {
    delete cfg.MAX_ORGANIZATIONS_PER_USER;
  });

  const create = (name: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name },
    });

  it('returns 403 organization_limit_reached when the user owns the cap', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 2;
    await ownOrg(userId, 1);
    await ownOrg(userId, 2);

    const res = await create('Third org');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('organization_limit_reached');
    const count = await db.selectFrom('organizations').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
    expect(Number(count.c)).toBe(2);
  });

  it('creates the organization when under the cap', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 2;
    await ownOrg(userId, 1);

    const res = await create('Second org');
    expect(res.statusCode).toBe(201);
  });

  it('creates the organization when the env is unset', async () => {
    await ownOrg(userId, 1);
    await ownOrg(userId, 2);
    await ownOrg(userId, 3);

    const res = await create('Fourth org');
    expect(res.statusCode).toBe(201);
  });

  it('does not count organizations where the user is only a member or admin', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 1;
    const other = await createTestUser({ email: `other-${Date.now()}@example.com` });
    const o1 = await ownOrg(other.id, 1);
    await db.insertInto('organization_members').values({ organization_id: o1.id, user_id: userId, role: 'member' }).execute();
    const o2 = await ownOrg(other.id, 2);
    await db.insertInto('organization_members').values({ organization_id: o2.id, user_id: userId, role: 'admin' }).execute();

    const res = await create('My first org');
    expect(res.statusCode).toBe(201);
  });
});
