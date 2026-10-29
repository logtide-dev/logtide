/**
 * Extension HTTP surface against the REAL app (same builder server.ts uses,
 * full plugin stack incl. the global auth plugin). A bare Fastify app would
 * hide exactly the bugs this suite is for.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../database/index.js';
import { reservoirReady } from '../../database/reservoir.js';
import { build } from '../../server.js';
import { initExtensions } from '../../extensions/runtime.js';
import { createTestSession } from '../helpers/auth.js';
import { createTestUser, createTestOrganization } from '../helpers/factories.js';
import httpFixture from '../fixtures/extensions/http-fixture.js';

const uniqueEmail = (tag: string) => `ext-${tag}-${crypto.randomUUID()}@example.com`;

describe('extension http surface', () => {
  let app: FastifyInstance;
  let plain: FastifyInstance;

  beforeAll(async () => {
    await reservoirReady;
    const extensions = await initExtensions([httpFixture], 'server');
    app = await build({ logger: false, extensions });
    await app.ready();
    plain = await build({ logger: false });
    await plain.ready();
  });

  afterAll(async () => {
    await app.close();
    await plain.close();
  });

  let ownerToken: string;
  let memberToken: string;
  let outsiderToken: string;
  let ownerId: string;
  let orgId: string;

  beforeEach(async () => {
    const owner = await createTestUser({ email: uniqueEmail('owner') });
    const member = await createTestUser({ email: uniqueEmail('member') });
    const outsider = await createTestUser({ email: uniqueEmail('outsider') });
    const org = await createTestOrganization({ ownerId: owner.id, slug: `ext-${crypto.randomUUID()}` });
    await db
      .insertInto('organization_members')
      .values({ user_id: member.id, organization_id: org.id, role: 'member' })
      .execute();
    ownerId = owner.id;
    orgId = org.id;
    ownerToken = (await createTestSession(owner.id)).token;
    memberToken = (await createTestSession(member.id)).token;
    outsiderToken = (await createTestSession(outsider.id)).token;
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  describe('requireSession', () => {
    it('401 without a session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/ext/fixture/me' });
      expect(res.statusCode).toBe(401);
    });

    it('200 with the user id when the session is valid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ext/fixture/me',
        headers: bearer(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ userId: ownerId });
    });
  });

  describe('requireOrgRole', () => {
    const roleUrl = (id: string) => `/api/v1/ext/fixture/orgs/${id}/role`;

    it('owner gets 200 and request.extOrg', async () => {
      const res = await app.inject({ method: 'GET', url: roleUrl(orgId), headers: bearer(ownerToken) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ role: 'owner', orgId });
    });

    it('member gets 403 forbidden', async () => {
      const res = await app.inject({ method: 'GET', url: roleUrl(orgId), headers: bearer(memberToken) });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    });

    it('non member gets 404 not_found', async () => {
      const res = await app.inject({ method: 'GET', url: roleUrl(orgId), headers: bearer(outsiderToken) });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    });

    it('malformed orgId gets 404 not_found', async () => {
      const res = await app.inject({ method: 'GET', url: roleUrl('not-a-uuid'), headers: bearer(ownerToken) });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    });

    it('unknown org UUID gets 404 not_found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: roleUrl(crypto.randomUUID()),
        headers: bearer(ownerToken),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    });

    it('401 without a session', async () => {
      const res = await app.inject({ method: 'GET', url: roleUrl(orgId) });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('public route with a raw-buffer JSON parser', () => {
    it('POST without credentials reaches the handler with a Buffer body', async () => {
      const payload = JSON.stringify({ id: 'evt_1', type: 'test' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ext/fixture/hook',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ isBuffer: true, raw: payload });
    });

    it('core JSON routes still parse bodies', async () => {
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: uniqueEmail('nobody'), password: 'wrong-password' },
      });
      // A Buffer body would fail schema validation with 400.
      expect(wrong.statusCode).toBe(401);

      const email = uniqueEmail('login');
      await createTestUser({ email, password: 'password123' });
      const ok = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'password123' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().user.email).toBe(email);
    });
  });

  describe('public config', () => {
    it('exposes extensions in /api/v1/auth/config', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/config' });
      expect(res.statusCode).toBe(200);
      expect(res.json().extensions).toEqual({ fixture: { enabled: true } });
    });

    it('has no extensions key when built without extensions', async () => {
      const res = await plain.inject({ method: 'GET', url: '/api/v1/auth/config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('extensions');
    });
  });
});
