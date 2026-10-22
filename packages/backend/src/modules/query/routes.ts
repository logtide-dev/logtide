import type { FastifyPluginAsync } from 'fastify';
import { queryService } from './service.js';
import type { LogLevel } from '@logtide/shared';
import { db } from '../../database/index.js';
import { LogQueryError } from './build-log-filter.js';
import {
  LOG_FILTER_QUERYSTRING_PROPERTIES,
  readLogFilterRequest,
  resolveAccessibleProjects,
} from './filter-params.js';
import { requireFullAccess, resolveQueryProjectId } from '../auth/guards.js';
import { auditLogService } from '../audit-log/service.js';


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
          ...LOG_FILTER_QUERYSTRING_PROPERTIES,
          limit: { type: 'number', minimum: 1, maximum: 1000, default: 100 },
          offset: { type: 'number', minimum: 0, default: 0 },
          cursor: { type: 'string' },
        },
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const query = request.query as Record<string, unknown> & {
        limit?: number;
        offset?: number;
        cursor?: string;
        projectId?: string | string[];
      };

      const read = readLogFilterRequest(query);
      if (!read.ok) return reply.code(400).send(read.body);

      // Resolve projectId enforcing API-key tenant boundary and membership
      const projectId = await resolveAccessibleProjects(request, reply, query.projectId);
      if (projectId === null) return;

      let logs;
      try {
        logs = await queryService.queryLogs({
          ...read.value,
          projectId,
          limit: query.limit || 100,
          offset: query.offset || 0,
          cursor: query.cursor,
        });
      } catch (err) {
        if (err instanceof LogQueryError) {
          return reply.code(400).send({ error: err.message, position: err.position });
        }
        throw err;
      }

      const { q, service, level, traceId, sessionId, searchMode } = read.value;
      void auditLogService.record({
        action: 'data.logs_searched',
        target: { type: 'project', id: Array.isArray(projectId) ? projectId.join(',') : projectId },
        metadata: { q, service, level, traceId, sessionId, searchMode },
        organizationId: null,
      }, { buffered: true });

      return logs;
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
      if (!await requireFullAccess(request, reply)) return;

      const { traceId } = request.params as { traceId: string };
      const { projectId: queryProjectId } = request.query as { projectId?: string };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId as string | undefined;

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

      void auditLogService.record({
        action: 'data.trace_viewed',
        target: { type: 'trace', id: traceId },
        metadata: { projectId },
        organizationId: null,
      }, { buffered: true });

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
      if (!await requireFullAccess(request, reply)) return;

      const { time, before, after, projectId: queryProjectId } = request.query as {
        time: string;
        before?: number;
        after?: number;
        projectId?: string;
      };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId as string | undefined;

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

      void auditLogService.record({
        action: 'data.log_context_viewed',
        target: { type: 'project', id: projectId },
        metadata: { time, before, after },
        organizationId: null,
      }, { buffered: true });

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
      if (!await requireFullAccess(request, reply)) return;

      const { logId } = request.params as { logId: string };
      const { projectId: queryProjectId } = request.query as { projectId?: string };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId as string | undefined;

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

      void auditLogService.record({
        action: 'data.log_viewed',
        target: { type: 'log', id: logId },
        metadata: { projectId, service: log.service, level: log.level },
        organizationId: null,
      }, { buffered: true });

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
      if (!await requireFullAccess(request, reply)) return;

      const { service, from, to, interval, projectId: queryProjectId } = request.query as {
        projectId?: string;
        service?: string;
        from: string;
        to: string;
        interval: '1m' | '5m' | '1h' | '1d';
      };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId as string | undefined;

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

      const stats = await queryService.getAggregatedStats({
        projectId,
        service,
        from: new Date(from),
        to: new Date(to),
        interval: interval || '1h',
      });

      void auditLogService.record({
        action: 'data.stats_viewed',
        target: { type: 'project', id: projectId },
        metadata: { service, from, to, interval },
        organizationId: null,
      }, { buffered: true });

      return stats;
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
      if (!await requireFullAccess(request, reply)) return;

      const { limit, from, to, projectId: queryProjectId } = request.query as {
        projectId?: string;
        limit?: number;
        from?: string;
        to?: string;
      };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId as string | undefined;

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

      void auditLogService.record({
        action: 'data.top_services_viewed',
        target: { type: 'project', id: projectId },
        metadata: { limit, from, to },
        organizationId: null,
      }, { buffered: true });

      return { services };
    },
  });

  // GET /api/v1/logs/services - Get all distinct services
  fastify.get('/api/v1/logs/services', {
    schema: {
      description: 'Get all distinct services for filter dropdowns',
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
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { from, to, projectId: queryProjectId } = request.query as {
        projectId?: string | string[];
        from?: string;
        to?: string;
      };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const projectIds = Array.isArray(projectId) ? projectId : [projectId];
        for (const pid of projectIds) {
          const hasAccess = await verifyProjectAccess(pid, request.user.id);
          if (!hasAccess) {
            return reply.code(403).send({
              error: `Access denied - you do not have access to project ${pid}`,
            });
          }
        }
      }

      // Validate date parameters
      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (from) {
        fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          return reply.code(400).send({
            error: 'Invalid date format for "from" parameter',
          });
        }
      }

      if (to) {
        toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          return reply.code(400).send({
            error: 'Invalid date format for "to" parameter',
          });
        }
      }

      const services = await queryService.getDistinctServices(
        projectId,
        fromDate,
        toDate
      );

      void auditLogService.record({
        action: 'data.services_listed',
        target: { type: 'project', id: Array.isArray(projectId) ? projectId.join(',') : projectId },
        metadata: { from, to },
        organizationId: null,
      }, { buffered: true });

      return { services };
    },
  });

  // GET /api/v1/logs/hostnames - Get all distinct hostnames
  fastify.get('/api/v1/logs/hostnames', {
    schema: {
      description: 'Get all distinct hostnames for filter dropdowns',
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
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { from, to, projectId: queryProjectId } = request.query as {
        projectId?: string | string[];
        from?: string;
        to?: string;
      };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId;

      if (!projectId) {
        return reply.code(400).send({
          error: 'Project context missing - provide projectId query parameter',
        });
      }

      if (request.user?.id) {
        const projectIds = Array.isArray(projectId) ? projectId : [projectId];
        for (const pid of projectIds) {
          const hasAccess = await verifyProjectAccess(pid, request.user.id);
          if (!hasAccess) {
            return reply.code(403).send({
              error: `Access denied - you do not have access to project ${pid}`,
            });
          }
        }
      }

      // Validate date parameters
      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (from) {
        fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          return reply.code(400).send({
            error: 'Invalid date format for "from" parameter',
          });
        }
      }

      if (to) {
        toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          return reply.code(400).send({
            error: 'Invalid date format for "to" parameter',
          });
        }
      }

      const hostnames = await queryService.getDistinctHostnames(
        projectId,
        fromDate,
        toDate
      );

      void auditLogService.record({
        action: 'data.hostnames_listed',
        target: { type: 'project', id: Array.isArray(projectId) ? projectId.join(',') : projectId },
        metadata: { from, to },
        organizationId: null,
      }, { buffered: true });

      return { hostnames };
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
      if (!await requireFullAccess(request, reply)) return;

      const { service, level, projectId: queryProjectId } = request.query as {
        service?: string;
        level?: LogLevel;
        projectId?: string;
      };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId as string | undefined;

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

      void auditLogService.record({
        action: 'data.logs_streamed',
        target: { type: 'project', id: projectId },
        metadata: { service, level },
        organizationId: null,
      }, { buffered: true });

      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'false');

      // Set headers for SSE
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      // Track last timestamp and sent IDs to avoid duplicates
      let lastTimestamp = new Date();
      let sentIds = new Set<string>();

      // Send initial connection message
      reply.raw.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date() })}\n\n`);

      // Poll for new logs every second
      let polling = false;
      const intervalId = setInterval(async () => {
        // Re-entrancy guard: skip this tick if the previous poll is still running
        // (a slow query must not overlap and corrupt lastTimestamp/sentIds).
        if (polling) return;
        polling = true;
        try {
          const newLogs = await queryService.queryLogs({
            projectId,
            service,
            level,
            from: lastTimestamp,
            to: new Date(),
            limit: 100,
            offset: 0,
            // Live tail must see fresh data; the 60s query cache would stall it.
            skipCache: true,
          });

          if (newLogs.logs.length > 0) {
            // Filter out already-sent logs
            const unseenLogs = newLogs.logs.filter((log: any) => !sentIds.has(log.id));

            if (unseenLogs.length > 0) {
              // Update last timestamp from the max time across all fetched logs.
              // queryLogs returns DESC-sorted by default, but compute max
              // defensively so this doesn't silently break if the sort changes.
              let maxTimeMs = lastTimestamp.getTime();
              for (const log of newLogs.logs) {
                const t = new Date(log.time).getTime();
                if (t > maxTimeMs) maxTimeMs = t;
              }
              lastTimestamp = new Date(maxTimeMs);

              // Rebuild sentIds with only logs at the latest timestamp to bound memory
              sentIds = new Set<string>();
              for (const log of newLogs.logs) {
                if (new Date(log.time).getTime() === maxTimeMs) {
                  sentIds.add(log.id);
                }
              }

              // Send each new log as separate event
              for (const log of unseenLogs) {
                reply.raw.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
              }
            }
          }

          // Send heartbeat to keep connection alive
          reply.raw.write(`: heartbeat\n\n`);
        } catch (error) {
          console.error('Error in SSE stream:', error);
          clearInterval(intervalId);
          reply.raw.end();
        } finally {
          polling = false;
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
      if (!await requireFullAccess(request, reply)) return;

      const { limit, from, to, projectId: queryProjectId } = request.query as {
        projectId?: string;
        limit?: number;
        from?: string;
        to?: string;
      };

      // Resolve projectId enforcing API-key tenant boundary
      const resolvedProjectId = await resolveQueryProjectId(request, reply, queryProjectId);
      if (resolvedProjectId === null) return; // 403 already sent
      const projectId = resolvedProjectId as string | undefined;

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

      void auditLogService.record({
        action: 'data.top_errors_viewed',
        target: { type: 'project', id: projectId },
        metadata: { limit, from, to },
        organizationId: null,
      }, { buffered: true });

      return { errors };
    },
  });
};

export default queryRoutes;
