import type { FastifyPluginAsync } from 'fastify';
import { tracesService } from './service.js';
import { db } from '../../database/index.js';

async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
  const result = await db
    .selectFrom('projects')
    .innerJoin('organization_members', 'projects.organization_id', 'organization_members.organization_id')
    .select(['projects.id'])
    .where('projects.id', '=', projectId)
    .where('organization_members.user_id', '=', userId)
    .executeTakeFirst();

  return !!result;
}

const tracesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/traces', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          service: { type: 'string' },
          error: { type: 'boolean' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'number', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { projectId: queryProjectId, service, error, from, to, limit, offset } = request.query as {
        projectId?: string;
        service?: string;
        error?: boolean;
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
      };

      const projectId = queryProjectId || request.projectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const hasAccess = await verifyProjectAccess(projectId, request.user.id);
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Access denied - you do not have access to this project',
          });
        }
      }

      const result = await tracesService.listTraces({
        projectId,
        service,
        error,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: limit || 50,
        offset: offset || 0,
      });

      return result;
    },
  });

  fastify.get('/api/v1/traces/:traceId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          traceId: { type: 'string' },
        },
        required: ['traceId'],
      },
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { traceId } = request.params as { traceId: string };
      const { projectId: queryProjectId } = request.query as { projectId?: string };

      const projectId = queryProjectId || request.projectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const hasAccess = await verifyProjectAccess(projectId, request.user.id);
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Access denied - you do not have access to this project',
          });
        }
      }

      const trace = await tracesService.getTrace(traceId, projectId);

      if (!trace) {
        return reply.code(404).send({
          error: 'Trace not found',
        });
      }

      return trace;
    },
  });

  fastify.get('/api/v1/traces/:traceId/spans', {
    schema: {
      params: {
        type: 'object',
        properties: {
          traceId: { type: 'string' },
        },
        required: ['traceId'],
      },
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { traceId } = request.params as { traceId: string };
      const { projectId: queryProjectId } = request.query as { projectId?: string };

      const projectId = queryProjectId || request.projectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const hasAccess = await verifyProjectAccess(projectId, request.user.id);
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Access denied - you do not have access to this project',
          });
        }
      }

      const spans = await tracesService.getTraceSpans(traceId, projectId);

      return { spans };
    },
  });

  fastify.get('/api/v1/traces/services', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { projectId: queryProjectId } = request.query as { projectId?: string };

      const projectId = queryProjectId || request.projectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const hasAccess = await verifyProjectAccess(projectId, request.user.id);
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Access denied - you do not have access to this project',
          });
        }
      }

      const services = await tracesService.getServices(projectId);

      return { services };
    },
  });

  fastify.get('/api/v1/traces/stats', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { projectId: queryProjectId, from, to } = request.query as {
        projectId?: string;
        from?: string;
        to?: string;
      };

      const projectId = queryProjectId || request.projectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const hasAccess = await verifyProjectAccess(projectId, request.user.id);
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Access denied - you do not have access to this project',
          });
        }
      }

      const stats = await tracesService.getStats(
        projectId,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined
      );

      return stats;
    },
  });
};

export default tracesRoutes;
