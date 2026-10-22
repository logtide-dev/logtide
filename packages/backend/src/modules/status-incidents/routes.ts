import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { statusIncidentService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { db } from '../../database/connection.js';
import { projectsService } from '../projects/service.js';
import {
  InvalidMonitorIdsError,
  InvalidSourceIncidentError,
  MAX_LINKED_MONITORS,
} from '../monitoring/component-links.js';
import { enqueueStatusSubscriberNotification } from '../../queue/jobs/monitor-status-subscribers.js';

const STATUS_VALUES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
const SEVERITY_VALUES = ['minor', 'major', 'critical'] as const;

async function checkOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
  const member = await db
    .selectFrom('organization_members')
    .select(['id', 'role'])
    .where('user_id', '=', userId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  return member?.role === 'owner' || member?.role === 'admin';
}

async function checkOrgMember(userId: string, organizationId: string): Promise<boolean> {
  const member = await db
    .selectFrom('organization_members')
    .select('id')
    .where('user_id', '=', userId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  return !!member;
}

const createSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  status: z.enum(STATUS_VALUES).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  message: z.string().max(5000).optional(),
  monitorIds: z.array(z.string().uuid()).max(MAX_LINKED_MONITORS).optional(),
  sourceIncidentId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  monitorIds: z.array(z.string().uuid()).max(MAX_LINKED_MONITORS).optional(),
});

/**
 * Emails the confirmed subscribers of the page. Best effort: any failure here
 * (lookup or queue) is logged and never fails the request.
 */
async function notifySubscribers(
  incidentId: string,
  organizationId: string,
  kind: 'incident_created' | 'incident_updated' | 'incident_resolved',
  status: string,
  message?: string,
): Promise<void> {
  try {
    const incident = await statusIncidentService.getById(incidentId, organizationId);
    if (!incident) return;
    await enqueueStatusSubscriberNotification({
      kind,
      organizationId,
      projectId: incident.projectId,
      title: incident.title,
      status,
      message,
    });
  } catch (err) {
    console.error('[StatusIncidents] subscriber notification failed:', err instanceof Error ? err.message : err);
  }
}

/** Maps link validation errors to a 400; anything else is rethrown. */
function sendLinkError(err: unknown, reply: any) {
  if (err instanceof InvalidMonitorIdsError || err instanceof InvalidSourceIncidentError) {
    return reply.status(400).send({ error: err.message });
  }
  throw err;
}

const addUpdateSchema = z.object({
  status: z.enum(STATUS_VALUES),
  message: z.string().min(1).max(5000),
});

const idSchema = z.object({ id: z.string().uuid() });
const orgIdSchema = z.string().uuid();

export async function statusIncidentRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // List incidents for a project
  fastify.get('/', async (request: any, reply) => {
    const { organizationId, projectId } = request.query;
    if (!orgIdSchema.safeParse(organizationId).success || !orgIdSchema.safeParse(projectId).success) {
      return reply.status(400).send({ error: 'valid organizationId and projectId required' });
    }
    if (!(await checkOrgMember(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { sourceIncidentId } = request.query;
    if (sourceIncidentId !== undefined && !orgIdSchema.safeParse(sourceIncidentId).success) {
      return reply.status(400).send({ error: 'sourceIncidentId must be a UUID' });
    }

    const incidents = await statusIncidentService.list(projectId, organizationId, {
      sourceIncidentId: sourceIncidentId || undefined,
    });
    return reply.send({ incidents });
  });

  // Get single incident with updates
  fastify.get('/:id', async (request: any, reply) => {
    const paramsParse = idSchema.safeParse(request.params);
    if (!paramsParse.success) return reply.status(400).send({ error: 'Invalid incident ID' });
    const { organizationId } = request.query;
    if (!orgIdSchema.safeParse(organizationId).success) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMember(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const incident = await statusIncidentService.getById(paramsParse.data.id, organizationId);
    if (!incident) return reply.status(404).send({ error: 'Not found' });

    const updates = await statusIncidentService.getUpdates(incident.id);
    return reply.send({ incident, updates });
  });

  // Create incident (admin/owner only)
  fastify.post('/', async (request: any, reply) => {
    const parse = createSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });

    if (!(await checkOrgAdmin(request.user.id, parse.data.organizationId))) {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }

    // The projectId is attacker-controlled in the body; ensure it belongs to the
    // caller's organization to prevent cross-tenant status-page injection.
    if (!(await projectsService.projectBelongsToOrg(parse.data.projectId, parse.data.organizationId))) {
      return reply.status(400).send({ error: 'projectId does not belong to the organization' });
    }

    try {
      const incident = await statusIncidentService.create({
        ...parse.data,
        createdBy: request.user.id,
      });
      await notifySubscribers(incident.id, incident.organizationId, 'incident_created', incident.status, parse.data.message);
      return reply.status(201).send({ incident });
    } catch (err) {
      return sendLinkError(err, reply);
    }
  });

  // Update incident (admin/owner only)
  fastify.put('/:id', async (request: any, reply) => {
    const paramsParse = idSchema.safeParse(request.params);
    if (!paramsParse.success) return reply.status(400).send({ error: 'Invalid incident ID' });
    const { organizationId } = request.query;
    if (!orgIdSchema.safeParse(organizationId).success) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgAdmin(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }

    const parse = updateSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });

    try {
      const before = parse.data.status === 'resolved'
        ? await statusIncidentService.getById(paramsParse.data.id, organizationId)
        : null;
      const incident = await statusIncidentService.update(paramsParse.data.id, organizationId, parse.data);
      if (!incident) return reply.status(404).send({ error: 'Not found' });
      // Only the transition into "resolved" is announced, not repeated saves.
      if (before && before.status !== 'resolved' && incident.status === 'resolved') {
        await notifySubscribers(incident.id, organizationId, 'incident_resolved', incident.status);
      }
      return reply.send({ incident });
    } catch (err) {
      return sendLinkError(err, reply);
    }
  });

  // Delete incident (admin/owner only)
  fastify.delete('/:id', async (request: any, reply) => {
    const paramsParse = idSchema.safeParse(request.params);
    if (!paramsParse.success) return reply.status(400).send({ error: 'Invalid incident ID' });
    const { organizationId } = request.query;
    if (!orgIdSchema.safeParse(organizationId).success) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgAdmin(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }

    const deleted = await statusIncidentService.delete(paramsParse.data.id, organizationId);
    if (!deleted) return reply.status(404).send({ error: 'Not found' });
    return reply.status(204).send();
  });

  // Add update to incident (admin/owner only)
  fastify.post('/:id/updates', async (request: any, reply) => {
    const paramsParse = idSchema.safeParse(request.params);
    if (!paramsParse.success) return reply.status(400).send({ error: 'Invalid incident ID' });
    const { organizationId } = request.query;
    if (!orgIdSchema.safeParse(organizationId).success) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgAdmin(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }

    const parse = addUpdateSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });

    try {
      const update = await statusIncidentService.addUpdate(
        paramsParse.data.id,
        organizationId,
        { ...parse.data, createdBy: request.user.id },
      );
      await notifySubscribers(
        paramsParse.data.id,
        organizationId,
        update.status === 'resolved' ? 'incident_resolved' : 'incident_updated',
        update.status,
        update.message,
      );
      return reply.status(201).send({ update });
    } catch (err) {
      if (err instanceof Error && err.message === 'Incident not found') {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      throw err;
    }
  });
}
