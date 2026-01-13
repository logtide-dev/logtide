import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { exceptionsRoutes } from '../../../modules/exceptions/routes.js';
import { createTestContext, createTestUser, createTestLog } from '../../helpers/factories.js';
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

async function createTestException(params: {
  organizationId: string;
  projectId: string;
  logId: string;
  exceptionType?: string;
  exceptionMessage?: string;
  language?: string;
  fingerprint?: string;
}) {
  const exception = await db
    .insertInto('exceptions')
    .values({
      organization_id: params.organizationId,
      project_id: params.projectId,
      log_id: params.logId,
      exception_type: params.exceptionType || 'Error',
      exception_message: params.exceptionMessage || 'Test error',
      language: params.language || 'nodejs',
      fingerprint: params.fingerprint || `fp-${Date.now()}`,
      raw_stack_trace: 'Error: Test\n    at test (/app/test.js:1:1)',
      frame_count: 1,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto('stack_frames')
    .values({
      exception_id: exception.id,
      frame_index: 0,
      file_path: '/app/test.js',
      function_name: 'test',
      line_number: 1,
      column_number: 1,
      is_app_code: true,
    })
    .execute();

  return exception;
}

async function createTestErrorGroup(params: {
  organizationId: string;
  projectId: string;
  fingerprint?: string;
  exceptionType?: string;
  exceptionMessage?: string;
  status?: 'open' | 'resolved' | 'ignored';
  occurrenceCount?: number;
}) {
  const errorGroup = await db
    .insertInto('error_groups')
    .values({
      organization_id: params.organizationId,
      project_id: params.projectId,
      fingerprint: params.fingerprint || `fp-${Date.now()}`,
      exception_type: params.exceptionType || 'Error',
      exception_message: params.exceptionMessage || 'Test error',
      language: 'nodejs',
      occurrence_count: params.occurrenceCount || 1,
      first_seen: new Date(),
      last_seen: new Date(),
      status: params.status || 'open',
      sample_log_id: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return errorGroup;
}

describe('Exceptions Routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  let testUser: any;
  let testOrganization: any;
  let testProject: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(exceptionsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const context = await createTestContext();
    testUser = context.user;
    testOrganization = context.organization;
    testProject = context.project;

    const session = await createTestSession(testUser.id);
    authToken = session.token;
  });

  describe('GET /api/v1/exceptions/by-log/:logId', () => {
    it('should return exception by log ID', async () => {
      const log = await createTestLog({ projectId: testProject.id, level: 'error' });
      await createTestException({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        logId: log.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/exceptions/by-log/${log.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.exception).toBeDefined();
      expect(body.frames).toBeDefined();
    });

    it('should return 401 without auth token', async () => {
      const log = await createTestLog({ projectId: testProject.id });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/exceptions/by-log/${log.id}`,
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-member organization', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      const otherSession = await createTestSession(otherUser.id);
      const log = await createTestLog({ projectId: testProject.id });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/exceptions/by-log/${log.id}`,
        headers: {
          Authorization: `Bearer ${otherSession.token}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 when no exception found', async () => {
      const log = await createTestLog({ projectId: testProject.id });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/exceptions/by-log/${log.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/exceptions/:id', () => {
    it('should return exception by ID', async () => {
      const log = await createTestLog({ projectId: testProject.id, level: 'error' });
      const exception = await createTestException({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        logId: log.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/exceptions/${exception.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.exception.id).toBe(exception.id);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/exceptions/00000000-0000-0000-0000-000000000000`,
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent exception', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/exceptions/00000000-0000-0000-0000-000000000000`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/error-groups', () => {
    it('should return error groups for organization', async () => {
      await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.groups).toBeDefined();
      expect(Array.isArray(body.groups)).toBe(true);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-member organization', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        headers: {
          Authorization: `Bearer ${otherSession.token}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should filter by project', async () => {
      await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          projectId: testProject.id,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should filter by status', async () => {
      await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        status: 'resolved',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          status: 'resolved',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should filter by language', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          language: 'python',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should support search', async () => {
      await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        exceptionType: 'DatabaseError',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          search: 'Database',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should support pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          limit: '10',
          offset: '0',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/error-groups/top', () => {
    it('should return top error groups', async () => {
      await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        occurrenceCount: 100,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups/top',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.groups).toBeDefined();
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups/top',
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should support limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/error-groups/top',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          limit: '3',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/error-groups/:id', () => {
    it('should return error group by ID', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(errorGroup.id);
    });

    it('should return 401 without auth token', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}`,
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent group', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/00000000-0000-0000-0000-000000000000`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 for wrong organization', async () => {
      const otherContext = await createTestContext();
      const errorGroup = await createTestErrorGroup({
        organizationId: otherContext.organization.id,
        projectId: otherContext.project.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      // Returns 403 because the group belongs to a different organization
      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /api/v1/error-groups/:id/status', () => {
    it('should update error group status to resolved', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        status: 'open',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/error-groups/${errorGroup.id}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          organizationId: testOrganization.id,
          status: 'resolved',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('resolved');
    });

    it('should update error group status to ignored', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        status: 'open',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/error-groups/${errorGroup.id}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          organizationId: testOrganization.id,
          status: 'ignored',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('ignored');
    });

    it('should reopen error group', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
        status: 'resolved',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/error-groups/${errorGroup.id}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          organizationId: testOrganization.id,
          status: 'open',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('open');
    });

    it('should return 401 without auth token', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/error-groups/${errorGroup.id}/status`,
        payload: {
          organizationId: testOrganization.id,
          status: 'resolved',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent group', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/error-groups/00000000-0000-0000-0000-000000000000/status`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          organizationId: testOrganization.id,
          status: 'resolved',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 for non-member organization', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      const otherSession = await createTestSession(otherUser.id);
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/error-groups/${errorGroup.id}/status`,
        headers: {
          Authorization: `Bearer ${otherSession.token}`,
        },
        payload: {
          organizationId: testOrganization.id,
          status: 'resolved',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/error-groups/:id/trend', () => {
    it('should return error group trend data', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}/trend`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.trend).toBeDefined();
      expect(Array.isArray(body.trend)).toBe(true);
    });

    it('should return 401 without auth token', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}/trend`,
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent group', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/00000000-0000-0000-0000-000000000000/trend`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should support interval parameter', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}/trend`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          interval: '1h',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should support days parameter', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}/trend`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          days: '14',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/error-groups/:id/logs', () => {
    it('should return logs for error group', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}/logs`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.logs).toBeDefined();
      expect(Array.isArray(body.logs)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('should return 401 without auth token', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}/logs`,
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent group', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/00000000-0000-0000-0000-000000000000/logs`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should support pagination', async () => {
      const errorGroup = await createTestErrorGroup({
        organizationId: testOrganization.id,
        projectId: testProject.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/${errorGroup.id}/logs`,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        query: {
          organizationId: testOrganization.id,
          limit: '5',
          offset: '0',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
