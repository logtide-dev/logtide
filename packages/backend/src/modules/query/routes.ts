import type { FastifyPluginAsync } from 'fastify';
import { queryService } from './service.js';
import type { LogLevel } from '@logward/shared';
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

const queryRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/logs - Search and filter logs
  fastify.get('/api/v1/logs', {
    schema: {
      description: 'Search and filter logs',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          projectId: {
            anyOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ]
          },
          service: {
            anyOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ]
          },
          level: {
            anyOf: [
              { type: 'string', enum: ['debug', 'info', 'warn', 'error', 'critical'] },
              {
                type: 'array',
                items: { type: 'string', enum: ['debug', 'info', 'warn', 'error', 'critical'] }
              }
            ]
          },
          traceId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          q: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 1000, default: 100 },
          offset: { type: 'number', minimum: 0, default: 0 },
          cursor: { type: 'string' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { service, level, traceId, from, to, q, limit, offset, cursor, projectId: queryProjectId } = request.query as {
        service?: string | string[];
        level?: LogLevel | LogLevel[];
        traceId?: string;
        from?: string;
        to?: string;
        q?: string;
        limit?: number;
        offset?: number;
        cursor?: string;
        projectId?: string | string[];
      };

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
      const projectId = queryProjectId || request.projectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const hasAccess = await verifyProjectAccess(
          Array.isArray(projectId) ? projectId[0] : projectId,
          request.user.id
        );

        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Access denied - you do not have access to this project',
          });
        }

        // If multiple projects requested, verify access to all
        if (Array.isArray(projectId)) {
          for (const pid of projectId) {
            const access = await verifyProjectAccess(pid, request.user.id);
            if (!access) {
              return reply.code(403).send({
                error: `Access denied - you do not have access to project ${pid}`,
              });
            }
          }
        }
      }

      return queryService.queryLogs({
        projectId,
        service,
        level,
        traceId,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        q,
        limit: limit || 100,
        offset: offset || 0,
        cursor,
      });
    },
  });

  // GET /api/v1/logs/trace/:traceId - Get logs by trace ID
  fastify.get('/api/v1/logs/trace/:traceId', {
    schema: {
      description: 'Get logs by trace ID',
      tags: ['query'],
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

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
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

      const logs = await queryService.getLogsByTraceId(projectId, traceId);
      return { logs };
    },
  });

  // GET /api/v1/logs/context - Get log context (logs before and after)
  fastify.get('/api/v1/logs/context', {
    schema: {
      description: 'Get log context (logs before and after a specific time)',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          time: { type: 'string', format: 'date-time' },
          before: { type: 'number', minimum: 1, maximum: 50, default: 10 },
          after: { type: 'number', minimum: 1, maximum: 50, default: 10 },
        },
        required: ['time'],
      },
    },
    handler: async (request: any, reply) => {
      const { time, before, after, projectId: queryProjectId } = request.query as {
        time: string;
        before?: number;
        after?: number;
        projectId?: string;
      };

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
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

      const context = await queryService.getLogContext({
        projectId,
        time: new Date(time),
        before: before || 10,
        after: after || 10,
      });

      return context;
    },
  });

  // GET /api/v1/logs/:logId - Get a single log by ID
  fastify.get('/api/v1/logs/:logId', {
    schema: {
      description: 'Get a single log entry by ID',
      tags: ['query'],
      params: {
        type: 'object',
        properties: {
          logId: { type: 'string', format: 'uuid' },
        },
        required: ['logId'],
      },
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { logId } = request.params as { logId: string };
      const { projectId: queryProjectId } = request.query as { projectId?: string };

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
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

      const log = await queryService.getLogById(logId, projectId);

      if (!log) {
        return reply.code(404).send({
          error: 'Log not found',
        });
      }

      return { log };
    },
  });

  // GET /api/v1/logs/aggregated - Get aggregated statistics
  fastify.get('/api/v1/logs/aggregated', {
    schema: {
      description: 'Get aggregated statistics with time buckets',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          service: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          interval: { type: 'string', enum: ['1m', '5m', '1h', '1d'], default: '1h' },
        },
        required: ['from', 'to'],
      },
    },
    handler: async (request: any, reply) => {
      const { service, from, to, interval, projectId: queryProjectId } = request.query as {
        projectId?: string;
        service?: string;
        from: string;
        to: string;
        interval: '1m' | '5m' | '1h' | '1d';
      };

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
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

      return queryService.getAggregatedStats({
        projectId,
        service,
        from: new Date(from),
        to: new Date(to),
        interval: interval || '1h',
      });
    },
  });

  // GET /api/v1/logs/top-services - Get top services by log count
  fastify.get('/api/v1/logs/top-services', {
    schema: {
      description: 'Get top services by log count',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 50, default: 5 },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { limit, from, to, projectId: queryProjectId } = request.query as {
        projectId?: string;
        limit?: number;
        from?: string;
        to?: string;
      };

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
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

      const services = await queryService.getTopServices(
        projectId,
        limit || 5,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined
      );

      return { services };
    },
  });

  // GET /api/v1/logs/stream - Live tail logs with Server-Sent Events
  fastify.get('/api/v1/logs/stream', {
    schema: {
      description: 'Live tail logs via Server-Sent Events',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          level: { type: 'string', enum: ['debug', 'info', 'warn', 'error', 'critical'] },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { service, level, projectId: queryProjectId } = request.query as {
        service?: string;
        level?: LogLevel;
        projectId?: string;
      };

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
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

      // Set CORS headers (required when using reply.raw, bypasses Fastify CORS plugin)
      const origin = request.headers.origin || 'http://localhost:3000';
      reply.raw.setHeader('Access-Control-Allow-Origin', origin);
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');

      // Set headers for SSE
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      // Track last timestamp to avoid duplicates
      let lastTimestamp = new Date();

      // Send initial connection message
      reply.raw.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date() })}\n\n`);

      // Poll for new logs every second
      const intervalId = setInterval(async () => {
        try {
          const newLogs = await queryService.queryLogs({
            projectId,
            service,
            level,
            from: lastTimestamp,
            to: new Date(),
            limit: 100,
            offset: 0,
          });

          if (newLogs.logs.length > 0) {
            // Update last timestamp
            const latestLog = newLogs.logs[newLogs.logs.length - 1];
            lastTimestamp = new Date(latestLog.time);

            // Send each log as separate event
            for (const log of newLogs.logs) {
              reply.raw.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
            }
          }

          // Send heartbeat to keep connection alive
          reply.raw.write(`: heartbeat\n\n`);
        } catch (error) {
          console.error('Error in SSE stream:', error);
          clearInterval(intervalId);
          reply.raw.end();
        }
      }, 1000);

      // Clean up on client disconnect
      request.raw.on('close', () => {
        clearInterval(intervalId);
        console.log('SSE client disconnected');
      });
    },
  });

  // GET /api/v1/logs/top-errors - Get top error messages
  fastify.get('/api/v1/logs/top-errors', {
    schema: {
      description: 'Get top error messages',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 50, default: 10 },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { limit, from, to, projectId: queryProjectId } = request.query as {
        projectId?: string;
        limit?: number;
        from?: string;
        to?: string;
      };

      // Get projectId from query params (for session auth) or from auth plugin (for API key auth)
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

      const errors = await queryService.getTopErrors(
        projectId,
        limit || 10,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined
      );

      return { errors };
    },
  });
};

export default queryRoutes;
