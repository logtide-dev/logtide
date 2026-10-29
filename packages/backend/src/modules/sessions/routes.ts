import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { sessionsService } from './service.js';
import { verifyProjectAccess } from '../auth/verify-project-access.js';
import { auditLogService } from '../audit-log/service.js';

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

export async function sessionsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // GET /api/v1/sessions - List sessions for a project (cursor pagination)
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          hasErrors: { type: 'string', enum: ['true', 'false'] },
          service: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
          cursor: { type: 'string', maxLength: 512 },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { projectId, from, to, hasErrors, service, limit = 25, cursor } = request.query;

      if (!await verifyProjectAccess(projectId, request.user.id)) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const toDate = to ? new Date(to) : new Date();
      const fromDate = from ? new Date(from) : new Date(toDate.getTime() - DEFAULT_RANGE_MS);
      if (fromDate.getTime() > toDate.getTime()) {
        return reply.code(400).send({ error: 'from must be before to' });
      }

      let result;
      try {
        result = await sessionsService.listSessions({
          projectId,
          from: fromDate,
          to: toDate,
          hasErrors: hasErrors === 'true' ? true : hasErrors === 'false' ? false : undefined,
          service,
          limit: Number(limit),
          cursor,
        });
      } catch (error) {
        if (error instanceof RangeError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }

      void auditLogService.record({
        action: 'data.sessions_listed',
        target: { type: 'project', id: projectId },
        metadata: { from, to, hasErrors, service },
        organizationId: null,
      }, { buffered: true });

      return result;
    },
  });

  // GET /api/v1/sessions/:sessionId/events - Get all events for a session
  fastify.get('/:sessionId/events', {
    schema: {
      params: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 1000 },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { sessionId } = request.params;
      const { projectId, limit = 1000 } = request.query;

      if (!await verifyProjectAccess(projectId, request.user.id)) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const result = await sessionsService.getSessionEvents({
        projectId,
        sessionId,
        limit: Number(limit),
      });

      if (result.events.length === 0) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      void auditLogService.record({
        action: 'data.session_events_viewed',
        target: { type: 'session', id: sessionId },
        metadata: { projectId, limit },
        organizationId: null,
      }, { buffered: true });

      return result;
    },
  });
}
