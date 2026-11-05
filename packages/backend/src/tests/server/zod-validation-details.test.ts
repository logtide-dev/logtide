import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { db } from '../../database/index.js';
import { createTestContext } from '../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

const SOME_ID = '00000000-0000-4000-8000-000000000001';
// Passes the route's JSON schema uuid format but not the zod check behind it
const URN_ID = `urn:uuid:${SOME_ID}`;

describe('route level zod validation errors', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    userId = ctx.user.id;
    orgId = ctx.organization.id;
    token = await createTestSession(userId);
  });

  function send(method: string, url: string, payload?: object) {
    return app.inject({
      method: method as 'GET',
      url,
      headers: { Authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
  }

  it.each([
    ['GET', '/api/v1/digests/config', 'organizationId'],
    ['DELETE', '/api/v1/digests/config', 'organizationId'],
    ['DELETE', `/api/v1/digests/recipients/${SOME_ID}`, 'organizationId'],
    ['POST', `/api/v1/digests/recipients/${SOME_ID}/resubscribe`, 'organizationId'],
    ['GET', '/api/v1/error-groups/not-an-id/duplicates', 'id'],
    ['GET', '/api/v1/usage/capabilities', 'organizationId'],
    ['GET', `/api/v1/sourcemaps?organizationId=${URN_ID}&projectId=${SOME_ID}`, 'organizationId'],
    ['DELETE', `/api/v1/sourcemaps/1.0.0?organizationId=${URN_ID}&projectId=${SOME_ID}`, 'organizationId'],
    ['PATCH', `/api/v1/projects/not-an-id/receivers/${SOME_ID}`, 'projectId'],
  ])('%s %s lists the failing field in details', async (method, url, field) => {
    const res = await send(method, url, method === 'PATCH' ? {} : undefined);

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: [field] })])
    );
  });

  it('GET /api/v1/usage/breakdown lists the missing range in details', async () => {
    const res = await send('GET', `/api/v1/usage/breakdown?organizationId=${orgId}`);

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['from'] })])
    );
  });

  it('POST /api/v1/notification-channels/test lists the failing field in details', async () => {
    const res = await send('POST', '/api/v1/notification-channels/test', {});

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['organizationId'] })])
    );
  });

  it('PUT /api/v1/monitors/:id/channels reports a bad channel id', async () => {
    const res = await send('PUT', `/api/v1/monitors/${SOME_ID}/channels?organizationId=${orgId}`, {
      channelIds: ['not-an-id'],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual(expect.any(String));
  });

  it('PUT /api/v1/projects/:id tells a bad id apart from a bad body', async () => {
    const badId = await send('PUT', '/api/v1/projects/not-an-id', { name: 'x' });
    expect(badId.statusCode).toBe(400);
    expect(badId.json().error).toBe('Invalid project ID format');

    const badBody = await send('PUT', `/api/v1/projects/${SOME_ID}`, { name: '' });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json().details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['name'] })])
    );
  });

  it('PUT /api/v1/admin/organizations/:id/entitlements lists the failing field in details', async () => {
    await db.updateTable('users').set({ is_admin: true }).where('id', '=', userId).execute();

    const res = await send('PUT', `/api/v1/admin/organizations/${orgId}/entitlements`, {
      entitlements: [],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['entitlements'] })])
    );
  });
});
