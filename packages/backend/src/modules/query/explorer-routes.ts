// Logs explorer read endpoints (count, histogram, facets, fields). They share
// the filter params and the prepare path of GET /api/v1/logs, so the query
// language, legacy params, beforeQuery hooks and tenancy apply identically
// (fields takes only the projects and the window).

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { requireFullAccess } from '../auth/guards.js';
import { auditLogService } from '../audit-log/service.js';
import { LogQueryError } from './build-log-filter.js';
import {
  DISCOVER_DEFAULT_SAMPLE_SIZE,
  DISCOVER_MAX_SAMPLE_SIZE,
  FACETS_DEFAULT_LIMIT,
  FACETS_MAX_LIMIT,
} from '@logtide/reservoir';
import {
  ExplorerParamError,
  HISTOGRAM_MAX_BUCKET_SECONDS,
  parseFacetFields,
} from './explorer-params.js';
import {
  LOG_FILTER_QUERYSTRING_PROPERTIES,
  readLogFilterRequest,
  resolveAccessibleProjects,
} from './filter-params.js';
import { queryService, type LogQueryParams } from './service.js';

const EXPLORER_RATE_LIMIT = { max: 120, timeWindow: '1 minute' };
const FIELDS_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };
const FIELDS_MIN_SAMPLE_SIZE = 100;

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

  // GET /api/v1/logs/facets - top values per field (grammar keys)
  fastify.get('/api/v1/logs/facets', {
    config: { rateLimit: EXPLORER_RATE_LIMIT },
    schema: {
      description: 'Top values per field',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          ...LOG_FILTER_QUERYSTRING_PROPERTIES,
          fields: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: FACETS_MAX_LIMIT, default: FACETS_DEFAULT_LIMIT },
        },
      },
    },
    handler: async (request, reply) => {
      const read = await readLogRead(request, reply);
      if (!read) return;
      const { fields: rawFields, limit } = request.query as { fields?: string; limit?: number };
      const parsed = parseFacetFields(rawFields);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

      let result;
      try {
        result = await queryService.getFacets({
          ...read.params,
          fields: parsed.fields,
          limit: limit ?? FACETS_DEFAULT_LIMIT,
        });
      } catch (err) {
        return handleQueryError(reply, err);
      }

      recordStatsViewed(read.projectId, {
        kind: 'facets',
        q: read.params.q,
        fields: parsed.fields.map((f) => f.key),
      });
      return result;
    },
  });

  // GET /api/v1/logs/fields - metadata keys seen in recent logs
  fastify.get('/api/v1/logs/fields', {
    config: { rateLimit: FIELDS_RATE_LIMIT },
    schema: {
      description: 'Discover metadata fields',
      tags: ['query'],
      querystring: {
        type: 'object',
        properties: {
          projectId: LOG_FILTER_QUERYSTRING_PROPERTIES.projectId,
          from: LOG_FILTER_QUERYSTRING_PROPERTIES.from,
          to: LOG_FILTER_QUERYSTRING_PROPERTIES.to,
          sampleSize: {
            type: 'integer',
            minimum: FIELDS_MIN_SAMPLE_SIZE,
            maximum: DISCOVER_MAX_SAMPLE_SIZE,
            default: DISCOVER_DEFAULT_SAMPLE_SIZE,
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!(await requireFullAccess(request, reply))) return;
      const query = request.query as { projectId?: string | string[]; from?: string; to?: string; sampleSize?: number };
      // Only the window is read: this endpoint takes no filter params.
      const read = readLogFilterRequest({ from: query.from, to: query.to });
      if (!read.ok) return reply.code(400).send(read.body);
      const projectId = await resolveAccessibleProjects(request, reply, query.projectId);
      if (projectId === null) return;

      let result;
      try {
        result = await queryService.discoverFields({
          projectId,
          from: read.value.from,
          to: read.value.to,
          sampleSize: query.sampleSize ?? DISCOVER_DEFAULT_SAMPLE_SIZE,
        });
      } catch (err) {
        return handleQueryError(reply, err);
      }

      recordStatsViewed(projectId, { kind: 'fields' });
      return result;
    },
  });
};
