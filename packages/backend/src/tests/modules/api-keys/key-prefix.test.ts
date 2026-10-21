import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { apiKeysRoutes } from '../../../modules/api-keys/routes.js';
import { apiKeysService, API_KEY_PREFIX_LENGTH } from '../../../modules/api-keys/service.js';
import { contextPlugin } from '../../../context/index.js';
import { createTestContext, createTestApiKey, createTestUser } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

describe('api key prefix', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(apiKeysRoutes, { prefix: '/api/v1/projects' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function create(token: string, projectId: string, name = 'Prefix key') {
    return app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/api-keys`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name, type: 'write' },
    });
  }

  it('creates a key and returns keyPrefix equal to the first 9 chars of apiKey', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);

    const res = await create(session.token, ctx.project.id);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(API_KEY_PREFIX_LENGTH).toBe(9);
    expect(body.keyPrefix).toBe(body.apiKey.slice(0, 9));
    expect(body.keyPrefix.startsWith('lp_')).toBe(true);
  });

  it('stores exactly 9 characters and never the full key', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);

    const body = (await create(session.token, ctx.project.id)).json();
    const row = await db
      .selectFrom('api_keys')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();

    expect(row.key_prefix).toHaveLength(9);
    expect(row.key_prefix).toBe(body.apiKey.slice(0, 9));
    expect(row.key_hash).toBe(crypto.createHash('sha256').update(body.apiKey).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(body.apiKey);
  });

  it('lists keyPrefix, null for a legacy key', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    const legacy = await createTestApiKey({ projectId: ctx.project.id, name: 'Legacy' });
    const created = (await create(session.token, ctx.project.id, 'New')).json();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${ctx.project.id}/api-keys`,
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(res.statusCode).toBe(200);
    const keys = res.json().apiKeys as Array<{ id: string; keyPrefix: string | null }>;
    expect(keys.find((k) => k.id === legacy.id)?.keyPrefix).toBeNull();
    expect(keys.find((k) => k.id === created.id)?.keyPrefix).toBe(created.keyPrefix);
  });

  it('a prefix cannot authenticate', async () => {
    const ctx = await createTestContext();
    const created = await apiKeysService.createApiKey({ projectId: ctx.project.id, name: 'k' });
    expect(created.keyPrefix).toBe(created.apiKey.slice(0, API_KEY_PREFIX_LENGTH));

    expect(await apiKeysService.verifyApiKey(created.keyPrefix)).toBeNull();
    expect(await apiKeysService.verifyApiKey(created.apiKey)).not.toBeNull();
  });

  it("another organization's user gets 404 when listing and no prefix leaks", async () => {
    const ctx = await createTestContext();
    await apiKeysService.createApiKey({ projectId: ctx.project.id, name: 'secret' });
    const outsider = await createTestUser({ email: `outsider-${Date.now()}@example.com` });
    const session = await createTestSession(outsider.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${ctx.project.id}/api-keys`,
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('keyPrefix');
    expect(res.body).not.toContain('lp_');
  });
});
