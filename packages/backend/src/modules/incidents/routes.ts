/**
 * REST surface of the incidents of every source. `/api/v1/incidents` is the
 * canonical base; `/api/v1/siem/incidents` registers the same handlers as an
 * alias (default sort `created_at`), see `siem/routes.ts`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  INCIDENT_BULK_ACTIONS,
  INCIDENT_BULK_MAX_IDS,
  INCIDENT_SORT_KEYS,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  SEVERITIES,
  type IncidentBulkResult,
  type IncidentDetailResponse,
  type IncidentSortKey,
} from '@logtide/shared';
import { db } from '../../database/index.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { auditLogService } from '../audit-log/service.js';
import type { AuditAction } from '../audit-log/actions.js';
import { SiemService } from '../siem/service.js';
import { incidentsService } from './service.js';
import { IncidentError, type IncidentListFilters } from './types.js';

const siemService = new SiemService(db);
const organizationsService = new OrganizationsService();

export interface IncidentRouteOptions {
  basePath: '/api/v1/incidents' | '/api/v1/siem/incidents';
  defaultSort: IncidentSortKey;
}

/**
 * Query values that accept repeated keys (`?a=x&a=y`) and comma lists
 * (`?a=x,y`) alike; an empty list means no filter.
 */
export function listParam<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v])
            .flatMap((s) => String(s).split(','))
            .map((s) => s.trim())
            .filter(Boolean),
    z.array(schema).optional()
  );
}

const ASSIGNEE_KEYWORDS = ['me', 'unassigned', 'anyone'] as const;

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  projectId: listParam(z.string().uuid()),
  status: listParam(z.enum(INCIDENT_STATUSES)),
  source: listParam(z.enum(INCIDENT_SOURCES)),
  severity: listParam(z.enum(SEVERITIES)),
  assignee: z.union([z.enum(ASSIGNEE_KEYWORDS), z.string().uuid()]).optional(),
  assigneeId: z.string().uuid().optional(),
  ruleId: z.string().uuid().optional(),
  service: z.string().min(1).max(255).optional(),
  technique: z.string().min(1).max(255).optional(),
  sort: z.enum(INCIDENT_SORT_KEYS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const orgQuerySchema = z.object({ organizationId: z.string().uuid() });

const patchBodySchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  severity: z.enum(SEVERITIES).optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
});

const bulkBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    ids: z.array(z.string().uuid()).min(1).max(INCIDENT_BULK_MAX_IDS),
    action: z.enum(INCIDENT_BULK_ACTIONS),
    assigneeId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => b.action !== 'assign' || b.assigneeId !== undefined, {
    message: 'assigneeId is required for the assign action',
    path: ['assigneeId'],
  });

const commentBodySchema = z.object({
  organizationId: z.string().uuid(),
  comment: z.string().min(1).max(10000),
});

const READ_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };
const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const BULK_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

function currentUser(request: FastifyRequest): { id: string; email: string } {
  // `authenticate` runs as onRequest on every route below.
  return request.user!;
}

/** Sends 403 and returns false unless the caller is a member of the organization. */
async function requireMember(
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string
): Promise<boolean> {
  const role = await organizationsService.getMemberRole(organizationId, currentUser(request).id);
  if (role === null) {
    await reply.status(403).send({ error: 'You are not a member of this organization' });
    return false;
  }
  return true;
}

/**
 * ZodError -> 400, IncidentError -> its status with `{ error, code }`, any
 * other error carrying a numeric `statusCode` (e.g. CapabilityError) goes to
 * the global handler, everything else -> 500 with `fallback`.
 */
function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply, fallback: string) {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'Validation error', details: error.errors });
  }
  if (error instanceof IncidentError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  if (typeof (error as { statusCode?: unknown } | null)?.statusCode === 'number') {
    throw error;
  }
  request.log.error({ err: error }, fallback);
  return reply.status(500).send({ error: fallback });
}

function auditActor(request: FastifyRequest) {
  const user = currentUser(request);
  return { type: 'user' as const, id: user.id, label: user.email };
}

/** Registers the incident handlers under `opts.basePath` (absolute paths, no hooks added). */
export function registerIncidentRoutes(fastify: FastifyInstance, opts: IncidentRouteOptions): void {
  const base = opts.basePath;

  fastify.get(base, { config: READ_LIMIT }, async (request, reply) => {
    try {
      const query = listQuerySchema.parse(request.query);
      if (!(await requireMember(request, reply, query.organizationId))) return reply;

      let assigneeId: string | null | undefined;
      const assignee = query.assignee ?? query.assigneeId;
      if (assignee === 'me') {
        assigneeId = currentUser(request).id;
      } else if (assignee === 'unassigned') {
        assigneeId = null;
      } else if (assignee === 'anyone' || assignee === undefined) {
        assigneeId = undefined;
      } else {
        await incidentsService.assertAssignableUser(query.organizationId, assignee);
        assigneeId = assignee;
      }

      const filters: IncidentListFilters = {
        organizationId: query.organizationId,
        projectIds: query.projectId,
        status: query.status,
        source: query.source,
        severity: query.severity,
        assigneeId,
        service: query.service,
        technique: query.technique,
        ruleId: query.ruleId,
        sort: query.sort ?? opts.defaultSort,
        order: query.order ?? 'desc',
        limit: query.limit,
        offset: query.offset,
      };
      return reply.send(await incidentsService.list(filters));
    } catch (error) {
      return handleError(error, request, reply, 'Failed to list incidents');
    }
  });

  fastify.post(`${base}/bulk`, { config: BULK_LIMIT }, async (request, reply) => {
    try {
      const body = bulkBodySchema.parse(request.body);
      if (!(await requireMember(request, reply, body.organizationId))) return reply;

      const { changedIds, ...result } = await incidentsService.bulk({
        organizationId: body.organizationId,
        ids: body.ids,
        action: body.action,
        assigneeId: body.assigneeId,
        actorId: currentUser(request).id,
      });

      const action: AuditAction = body.action === 'assign' ? 'incident.updated' : 'incident.status_changed';
      for (const id of changedIds) {
        await auditLogService.record({
          action,
          target: { type: 'incident', id },
          organizationId: body.organizationId,
          actor: auditActor(request),
          metadata: { bulk: true, action: body.action },
        });
      }

      const response: IncidentBulkResult = result;
      return reply.send(response);
    } catch (error) {
      return handleError(error, request, reply, 'Failed to update incidents');
    }
  });

  fastify.get(`${base}/:id`, { config: READ_LIMIT }, async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const { organizationId } = orgQuerySchema.parse(request.query);
      if (!(await requireMember(request, reply, organizationId))) return reply;

      const [incident, detections, comments, history, sourceEvents] = await Promise.all([
        incidentsService.getItem(id, organizationId),
        siemService.getIncidentDetections(id, organizationId),
        incidentsService.listComments(id, organizationId),
        incidentsService.listHistory(id, organizationId),
        incidentsService.listSourceEvents(id, organizationId),
      ]);
      if (!incident) {
        return reply.status(404).send({ error: 'Incident not found' });
      }

      const response: IncidentDetailResponse = {
        incident,
        detections,
        comments: comments ?? [],
        history: history ?? [],
        sourceEvents: sourceEvents ?? [],
      };
      return reply.send(response);
    } catch (error) {
      return handleError(error, request, reply, 'Failed to get incident');
    }
  });

  fastify.patch(`${base}/:id`, { config: WRITE_LIMIT }, async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const body = patchBodySchema.parse(request.body);
      if (!(await requireMember(request, reply, body.organizationId))) return reply;

      const incident = await incidentsService.update(
        id,
        body.organizationId,
        {
          status: body.status,
          assigneeId: body.assigneeId,
          severity: body.severity,
          title: body.title,
          description: body.description,
        },
        currentUser(request).id
      );
      if (!incident) {
        return reply.status(404).send({ error: 'Incident not found' });
      }

      await auditLogService.record({
        action: body.status ? 'incident.status_changed' : 'incident.updated',
        target: { type: 'incident', id },
        organizationId: body.organizationId,
        actor: auditActor(request),
        metadata: { status: body.status, severity: body.severity, assigneeId: body.assigneeId },
      });

      return reply.send(incident);
    } catch (error) {
      return handleError(error, request, reply, 'Failed to update incident');
    }
  });

  fastify.get(`${base}/:id/comments`, { config: READ_LIMIT }, async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const { organizationId } = orgQuerySchema.parse(request.query);
      if (!(await requireMember(request, reply, organizationId))) return reply;

      const comments = await incidentsService.listComments(id, organizationId);
      if (!comments) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      return reply.send({ comments });
    } catch (error) {
      return handleError(error, request, reply, 'Failed to get comments');
    }
  });

  fastify.post(`${base}/:id/comments`, { config: WRITE_LIMIT }, async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const body = commentBodySchema.parse(request.body);
      if (!(await requireMember(request, reply, body.organizationId))) return reply;

      const comment = await incidentsService.addComment({
        incidentId: id,
        organizationId: body.organizationId,
        userId: currentUser(request).id,
        comment: body.comment,
      });
      if (!comment) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      return reply.status(201).send(comment);
    } catch (error) {
      return handleError(error, request, reply, 'Failed to add comment');
    }
  });

  fastify.get(`${base}/:id/history`, { config: READ_LIMIT }, async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const { organizationId } = orgQuerySchema.parse(request.query);
      if (!(await requireMember(request, reply, organizationId))) return reply;

      const history = await incidentsService.listHistory(id, organizationId);
      if (!history) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      return reply.send({ history });
    } catch (error) {
      return handleError(error, request, reply, 'Failed to get incident history');
    }
  });
}

/** `/api/v1/incidents`: session authenticated, sorted by last event by default. */
export async function incidentsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', authenticate);
  registerIncidentRoutes(fastify, { basePath: '/api/v1/incidents', defaultSort: 'last_event_at' });
}
