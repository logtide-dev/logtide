// Logs explorer read endpoints (count, histogram, facets, fields). They share
// the filter params and the prepare path of GET /api/v1/logs, so the query
// language, legacy params, beforeQuery hooks and tenancy apply identically.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { requireFullAccess } from '../auth/guards.js';
import { auditLogService } from '../audit-log/service.js';
import { LogQueryError } from './build-log-filter.js';
import { ExplorerParamError, HISTOGRAM_MAX_BUCKET_SECONDS } from './explorer-params.js';
import {
  LOG_FILTER_QUERYSTRING_PROPERTIES,
  readLogFilterRequest,
  resolveAccessibleProjects,
} from './filter-params.js';
import { queryService, type LogQueryParams } from './service.js';

const EXPLORER_RATE_LIMIT = { max: 120, timeWindow: '1 minute' };

interface LogReadRequest {
  params: LogQueryParams;
  projectId: string | string[];
}

/** Access checks plus the shared filter params; null when a reply was sent. */
async function readLogRead(request: FastifyRequest, reply: FastifyReply): Promise<LogReadRequest | null> {
  if (!(await requireFullAccess(request, reply))) return null;
  const query = request.query as Record<string, unknown>;
  const read = readLogFilterRequest(query);
  if (!read.ok) {
    reply.code(400).send(read.body);
    return null;
  }
  const projectId = await resolveAccessibleProjects(request, reply, query.projectId as string | string[] | undefined);
  if (projectId === null) return null;
  return { projectId, params: { ...read.value, projectId } };
}

/**
 * Sends the 400 body for a query error (`{ error, position }`) or an unusable
 * explorer param (`{ error }`); rethrows anything else (hook rejections,
 * capability errors, server errors reach the global error handler).
 */
function handleQueryError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof LogQueryError) {
    return reply.code(400).send({ error: err.message, position: err.position });
  }
  if (err instanceof ExplorerParamError) {
    return reply.code(400).send({ error: err.message });
  }
  throw err;
}

function recordStatsViewed(projectId: string | string[], metadata: Record<string, unknown>): void {
  void auditLogService.record({
    action: 'data.stats_viewed',
    target: { type: 'project', id: Array.isArray(projectId) ? projectId.join(',') : projectId },
    metadata,
    organizationId: null,
  }, { buffered: true });
}

export const logExplorerRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/logs/count - exact count of logs matching the filters
  fastify.get('/api/v1/logs/count', {
    config: { rateLimit: EXPLORER_RATE_LIMIT },
    schema: {
      description: 'Count logs matching a query',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: { ...LOG_FILTER_QUERYSTRING_PROPERTIES },
      },
    },
    handler: async (request, reply) => {
      const read = await readLogRead(request, reply);
      if (!read) return;

      let result;
      try {
        result = await queryService.countLogs(read.params);
      } catch (err) {
        return handleQueryError(reply, err);
      }

      recordStatsViewed(read.projectId, { kind: 'count', q: read.params.q });
      return result;
    },
  });

  // GET /api/v1/logs/histogram - log volume over time stacked by level
  fastify.get('/api/v1/logs/histogram', {
    config: { rateLimit: EXPLORER_RATE_LIMIT },
    schema: {
      description: 'Log volume histogram by level',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          ...LOG_FILTER_QUERYSTRING_PROPERTIES,
          bucketSeconds: { type: 'integer', minimum: 1, maximum: HISTOGRAM_MAX_BUCKET_SECONDS },
        },
      },
    },
    handler: async (request, reply) => {
      const read = await readLogRead(request, reply);
      if (!read) return;
      const { bucketSeconds } = request.query as { bucketSeconds?: number };

      let result;
      try {
        result = await queryService.getHistogram({ ...read.params, bucketSeconds });
      } catch (err) {
        return handleQueryError(reply, err);
      }

      recordStatsViewed(read.projectId, { kind: 'histogram', q: read.params.q });
      return result;
    },
  });
};
