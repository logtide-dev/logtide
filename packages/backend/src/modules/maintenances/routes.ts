import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { maintenanceService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { db } from '../../database/connection.js';
import { projectsService } from '../projects/service.js';
import { InvalidMonitorIdsError, MAX_LINKED_MONITORS } from '../monitoring/component-links.js';
import { enqueueStatusSubscriberNotification } from '../../queue/jobs/monitor-status-subscribers.js';

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
  description: z.string().max(5000).optional(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
  autoUpdateStatus: z.boolean().optional(),
  monitorIds: z.array(z.string().uuid()).max(MAX_LINKED_MONITORS).optional(),
}).refine((d) => new Date(d.scheduledEnd) > new Date(d.scheduledStart), {
  message: 'End time must be after start time',
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed']).optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  autoUpdateStatus: z.boolean().optional(),
  monitorIds: z.array(z.string().uuid()).max(MAX_LINKED_MONITORS).optional(),
});

export async function maintenanceRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // List maintenances for a project
  fastify.get('/', async (request: any, reply) => {
    const { organizationId, projectId } = request.query;
    if (!organizationId || !projectId) {
      return reply.status(400).send({ error: 'organizationId and projectId required' });
    }
    if (!(await checkOrgMember(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const maintenances = await maintenanceService.list(projectId, organizationId);
    return reply.send({ maintenances });
  });

  // Get single maintenance
  fastify.get('/:id', async (request: any, reply) => {
    const { organizationId } = request.query;
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMember(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const maintenance = await maintenanceService.getById(request.params.id, organizationId);
    if (!maintenance) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ maintenance });
  });

  // Create maintenance (admin/owner only)
  fastify.post('/', async (request: any, reply) => {
    const parse = createSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });

    if (!(await checkOrgAdmin(request.user.id, parse.data.organizationId))) {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }

    // The projectId is attacker-controlled in the body; ensure it belongs to the
    // caller's organization, otherwise a maintenance with a victim project_id
    // could be injected onto another tenant's public status page.
    if (!(await projectsService.projectBelongsToOrg(parse.data.projectId, parse.data.organizationId))) {
      return reply.status(400).send({ error: 'projectId does not belong to the organization' });
    }

    try {
      const maintenance = await maintenanceService.create({
        organizationId: parse.data.organizationId,
        projectId: parse.data.projectId,
        title: parse.data.title,
        description: parse.data.description,
        scheduledStart: new Date(parse.data.scheduledStart),
        scheduledEnd: new Date(parse.data.scheduledEnd),
        autoUpdateStatus: parse.data.autoUpdateStatus,
        monitorIds: parse.data.monitorIds,
        createdBy: request.user.id,
      });
      // Best effort: a failing queue must not fail the request.
      await enqueueStatusSubscriberNotification({
        kind: 'maintenance_scheduled',
        organizationId: maintenance.organizationId,
        projectId: maintenance.projectId,
        title: maintenance.title,
        message: maintenance.description ?? undefined,
        scheduledStart: maintenance.scheduledStart.toISOString(),
        scheduledEnd: maintenance.scheduledEnd.toISOString(),
      });
      return reply.status(201).send({ maintenance });
    } catch (err) {
      if (err instanceof InvalidMonitorIdsError) return reply.status(400).send({ error: err.message });
      throw err;
    }
  });

  // Update maintenance (admin/owner only)
  fastify.put('/:id', async (request: any, reply) => {
    const { organizationId } = request.query;
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgAdmin(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }

    const parse = updateSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });

    const input: Record<string, unknown> = {};
    if (parse.data.title !== undefined) input.title = parse.data.title;
    if (parse.data.description !== undefined) input.description = parse.data.description;
    if (parse.data.status !== undefined) input.status = parse.data.status;
    if (parse.data.scheduledStart !== undefined) input.scheduledStart = new Date(parse.data.scheduledStart);
    if (parse.data.scheduledEnd !== undefined) input.scheduledEnd = new Date(parse.data.scheduledEnd);
    if (parse.data.autoUpdateStatus !== undefined) input.autoUpdateStatus = parse.data.autoUpdateStatus;

    if (parse.data.monitorIds !== undefined) input.monitorIds = parse.data.monitorIds;

    try {
      const maintenance = await maintenanceService.update(request.params.id, organizationId, input as any);
      if (!maintenance) return reply.status(404).send({ error: 'Not found' });
      return reply.send({ maintenance });
    } catch (err) {
      if (err instanceof InvalidMonitorIdsError) return reply.status(400).send({ error: err.message });
      throw err;
    }
  });

  // Delete maintenance (admin/owner only)
  fastify.delete('/:id', async (request: any, reply) => {
    const { organizationId } = request.query;
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgAdmin(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }

    const deleted = await maintenanceService.delete(request.params.id, organizationId);
    if (!deleted) return reply.status(404).send({ error: 'Not found' });
    return reply.status(204).send();
  });
}
