import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { verifyProjectAccess } from '../auth/verify-project-access.js';
import { webVitalsService } from './service.js';

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

export async function webVitalsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // GET /api/v1/web-vitals/summary - p75 per metric and per route (session auth only)
  fastify.get('/summary', {
    schema: {
      querystring: {
        type: 'object',
        required: ['projectId', 'from', 'to'],
        properties: {
          projectId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request: any, reply) => {
      if (!request.user) {
        return reply.code(403).send({ error: 'Session authentication required' });
      }

      const { projectId, from, to } = request.query as { projectId: string; from: string; to: string };
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (fromDate.getTime() > toDate.getTime()) {
        return reply.code(400).send({ error: 'from must be before to' });
      }
      if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_MS) {
        return reply.code(400).send({ error: 'Range must be 31 days or less' });
      }

      if (!await verifyProjectAccess(projectId, request.user.id)) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      return webVitalsService.getSummary({ projectId, from: fromDate, to: toDate });
    },
  });
}
