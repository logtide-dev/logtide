/**
 * Error group triage routes
 *
 * PATCH (status, assignee, ignore options), bulk actions, batch trends,
 * event paging and the by-trace lookup. Registered as an encapsulated child
 * plugin of exceptionsRoutes, so it inherits the session auth hook.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ERROR_GROUP_BULK_ACTIONS,
  ERROR_GROUP_EVENT_DIRECTIONS,
  ERROR_GROUP_STATUSES,
} from '@logtide/shared';
import { db } from '../../database/index.js';
import { checkOrganizationMembership } from './route-helpers.js';
import {
  ErrorGroupTriageService,
  ErrorGroupValidationError,
  MAX_BULK_IDS,
  MAX_EVENTS_LIMIT,
  MAX_TREND_BUCKETS,
} from './triage-service.js';

const triageService = new ErrorGroupTriageService(db);

const MAX_TREND_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

const NOT_MEMBER = { error: 'You are not a member of this organization' };

function handleError(error: any, reply: FastifyReply, label: string) {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'Validation error', details: error.errors });
  }
  if (error instanceof ErrorGroupValidationError) {
    return reply.status(400).send({ error: error.message });
  }
  console.error(`Failed to ${label}:`, error);
  return reply.status(500).send({
    error: `Failed to ${label}`,
    details: error?.message,
  });
}

const patchBodySchema = z.object({
  organizationId: uuid,
  status: z.enum(ERROR_GROUP_STATUSES).optional(),
  assignedTo: uuid.nullable().optional(),
  ignoredUntil: isoDate.nullable().optional(),
  ignoreUntilCount: z.number().int().nullable().optional(),
});

const bulkBodySchema = z.object({
  organizationId: uuid,
  ids: z.array(uuid).min(1).max(MAX_BULK_IDS),
  action: z.enum(ERROR_GROUP_BULK_ACTIONS),
  assignedTo: uuid.nullable().optional(),
  ignoredUntil: isoDate.nullable().optional(),
  ignoreUntilCount: z.number().int().nullable().optional(),
});

const trendsQuerySchema = z.object({
  organizationId: uuid,
  ids: z
    .string()
    .transform((v) => v.split(',').map((x) => x.trim()))
    .pipe(z.array(uuid).min(1).max(100)),
  from: isoDate,
  to: isoDate,
  buckets: z.coerce.number().int().min(1).max(MAX_TREND_BUCKETS).optional(),
});

const eventsQuerySchema = z.object({
  organizationId: uuid,
  cursor: uuid.optional(),
  direction: z.enum(ERROR_GROUP_EVENT_DIRECTIONS).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_EVENTS_LIMIT).optional(),
});

const byTraceQuerySchema = z.object({
  organizationId: uuid,
  projectId: uuid,
});

export async function triageRoutes(fastify: FastifyInstance) {
  /**
   * PATCH /api/v1/error-groups/:id
   * Update status, assignee and ignore options in one call.
   */
  fastify.patch(
    '/api/v1/error-groups/:id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      try {
        const { id } = z.object({ id: uuid }).parse(request.params);
        const body = patchBodySchema.parse(request.body);

        const { organizationId, ...fields } = body;
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        );
        if (Object.keys(patch).length === 0) {
          return reply.status(400).send({ error: 'At least one field to update is required' });
        }

        if (!(await checkOrganizationMembership(request.user.id, organizationId))) {
          return reply.status(403).send(NOT_MEMBER);
        }

        const group = await triageService.updateErrorGroup(id, organizationId, patch, request.user.id);
        if (!group) {
          return reply.status(404).send({ error: 'Error group not found' });
        }
        return reply.send(group);
      } catch (error: any) {
        return handleError(error, reply, 'update error group');
      }
    }
  );

  /**
   * POST /api/v1/error-groups/bulk
   * Resolve, reopen, ignore or assign up to 100 groups at once.
   */
  fastify.post(
    '/api/v1/error-groups/bulk',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      try {
        const body = bulkBodySchema.parse(request.body);

        if (!(await checkOrganizationMembership(request.user.id, body.organizationId))) {
          return reply.status(403).send(NOT_MEMBER);
        }

        const result = await triageService.bulkUpdateErrorGroups({
          organizationId: body.organizationId,
          ids: body.ids,
          action: body.action,
          assignedTo: body.assignedTo,
          ignoredUntil: body.ignoredUntil,
          ignoreUntilCount: body.ignoreUntilCount,
          actorUserId: request.user.id,
        });
        return reply.send(result);
      } catch (error: any) {
        return handleError(error, reply, 'update error groups');
      }
    }
  );

  /**
   * GET /api/v1/error-groups/trends
   * Sparkline counts for many groups in one call.
   */
  fastify.get(
    '/api/v1/error-groups/trends',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      try {
        const query = trendsQuerySchema.parse(request.query);
        const from = new Date(query.from);
        const to = new Date(query.to);
        if (to.getTime() <= from.getTime()) {
          return reply.status(400).send({ error: '"to" must be after "from"' });
        }
        if (to.getTime() - from.getTime() > MAX_TREND_RANGE_MS) {
          return reply.status(400).send({ error: 'Range must be at most 90 days' });
        }

        if (!(await checkOrganizationMembership(request.user.id, query.organizationId))) {
          return reply.status(403).send(NOT_MEMBER);
        }

        const result = await triageService.getTrends({
          organizationId: query.organizationId,
          ids: query.ids,
          from,
          to,
          buckets: query.buckets,
        });
        return reply.send(result);
      } catch (error: any) {
        return handleError(error, reply, 'get error group trends');
      }
    }
  );

  /**
   * GET /api/v1/error-groups/by-trace/:traceId
   * Error groups behind the error logs of a trace (consumed by the trace viewer).
   */
  fastify.get(
    '/api/v1/error-groups/by-trace/:traceId',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      try {
        const { traceId } = z
          .object({ traceId: z.string().min(1).max(128) })
          .parse(request.params);
        const query = byTraceQuerySchema.parse(request.query);

        if (!(await checkOrganizationMembership(request.user.id, query.organizationId))) {
          return reply.status(403).send(NOT_MEMBER);
        }

        const groups = await triageService.getErrorGroupsByTrace({
          organizationId: query.organizationId,
          projectId: query.projectId,
          traceId,
        });
        if (!groups) {
          return reply.status(404).send({ error: 'Project not found' });
        }
        return reply.send({ groups });
      } catch (error: any) {
        return handleError(error, reply, 'get error groups by trace');
      }
    }
  );

  /**
   * GET /api/v1/error-groups/:id/events
   * Page through the individual events of a group, newest first.
   */
  fastify.get(
    '/api/v1/error-groups/:id/events',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      try {
        const { id } = z.object({ id: uuid }).parse(request.params);
        const query = eventsQuerySchema.parse(request.query);

        if (!(await checkOrganizationMembership(request.user.id, query.organizationId))) {
          return reply.status(403).send(NOT_MEMBER);
        }

        const result = await triageService.getEvents({
          groupId: id,
          organizationId: query.organizationId,
          cursor: query.cursor,
          direction: query.direction,
          limit: query.limit,
        });
        if (!result) {
          return reply.status(404).send({ error: 'Error group not found' });
        }
        return reply.send(result);
      } catch (error: any) {
        return handleError(error, reply, 'get error group events');
      }
    }
  );
}
