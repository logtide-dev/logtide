import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { receiversRoutes } from '../../../modules/receivers/routes.js';
import { contextPlugin } from '../../../context/index.js';
import { createTestContext } from '../../helpers/factories.js';
import { receiversService } from '../../../modules/receivers/service.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

describe('receivers management routes', () => {
  let app: FastifyInstance;
  let projectId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(receiversRoutes, { prefix: '/api/v1/projects' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('receiver_events').execute();
    await db.deleteFrom('receivers').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();
    const ctx = await createTestContext();
    projectId = ctx.project.id;
    userId = ctx.user.id;
    token = await createTestSession(userId);
  });

  it('creates a receiver and returns token and ingest path once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'ci', adapterType: 'github' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.token).toMatch(/^lr_[0-9a-f]{64}$/);
    expect(body.ingestPath).toBe(`/api/v1/receivers/${body.id}/${body.token}`);
  });

  it('rejects fieldMapping on non-generic adapters and validates mapping shape', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'x', adapterType: 'github', fieldMapping: { message: 'a' } },
    });
    expect(bad.statusCode).toBe(400);

    const badMapping = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'x', adapterType: 'generic', fieldMapping: { nope: 'a' } },
    });
    expect(badMapping.statusCode).toBe(400);
  });

  it('lists receivers without exposing token hashes', async () => {
    await receiversService.createReceiver({ projectId, name: 'a', adapterType: 'generic' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.receivers).toHaveLength(1);
    expect(res.body).not.toContain('token');
  });

  it('updates and deletes receivers', async () => {
    const { id } = await receiversService.createReceiver({ projectId, name: 'a', adapterType: 'generic' });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/receivers/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/receivers/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(204);
  });

  it('lists recent events', async () => {
    const { id } = await receiversService.createReceiver({ projectId, name: 'a', adapterType: 'generic' });
    await receiversService.recordEvent(id, { hello: 1 });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/receivers/${id}/events`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).events).toHaveLength(1);
  });

  it('denies access to projects of other users (404)', async () => {
    const other = await createTestContext();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${other.project.id}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
