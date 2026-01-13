import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { retentionRoutes } from '../../../modules/retention/routes.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';
import crypto from 'crypto';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .insertInto('sessions')
    .values({
      user_id: userId,
      token,
      expires_at: expiresAt,
    })
    .execute();

  return { token, expiresAt };
}

async function setUserAsAdmin(userId: string) {
  await db
    .updateTable('users')
    .set({ is_admin: true })
    .where('id', '=', userId)
    .execute();
}

describe('Retention Routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  let adminToken: string;
  let testUser: any;
  let adminUser: any;
  let testOrganization: any;
  let testProject: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(retentionRoutes, { prefix: '/api/v1/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Create test context
    const context = await createTestContext();
    testUser = context.user;
    testOrganization = context.organization;
    testProject = context.project;

    // Create non-admin session
    const session = await createTestSession(testUser.id);
    authToken = session.token;

    // Create admin user
    adminUser = await createTestUser({ email: `admin-${Date.now()}@test.com` });
    await setUserAsAdmin(adminUser.id);
    const adminSession = await createTestSession(adminUser.id);
    adminToken = adminSession.token;
  });

  describe('PUT /api/v1/admin/organizations/:id/retention', () => {
    it('should update retention days as admin', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          retentionDays: 60,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.retentionDays).toBe(60);
      expect(body.success).toBe(true);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        payload: {
          retentionDays: 60,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          retentionDays: 60,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 400 for invalid retention days', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          retentionDays: 500,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for non-integer retention days', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          retentionDays: 30.5,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent organization', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          retentionDays: 60,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should accept minimum retention of 1 day', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          retentionDays: 1,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.retentionDays).toBe(1);
    });

    it('should accept maximum retention of 365 days', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          retentionDays: 365,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.retentionDays).toBe(365);
    });
  });

  describe('GET /api/v1/admin/organizations/:id/retention', () => {
    it('should get retention status as admin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.organizationId).toBe(testOrganization.id);
      expect(body.retentionDays).toBeDefined();
      expect(typeof body.totalLogs).toBe('number');
      expect(typeof body.logsToDelete).toBe('number');
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${testOrganization.id}/retention`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent organization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/retention`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/admin/retention/execute', () => {
    it('should execute retention cleanup as admin', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/retention/execute`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.message).toBe('Retention cleanup executed successfully');
      expect(body.totalOrganizations).toBeDefined();
      expect(body.successfulOrganizations).toBeDefined();
      expect(body.failedOrganizations).toBeDefined();
      expect(body.totalLogsDeleted).toBeDefined();
      expect(body.results).toBeDefined();
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/retention/execute`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/retention/execute`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return results for all organizations', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/retention/execute`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBe(body.totalOrganizations);
    });
  });
});
