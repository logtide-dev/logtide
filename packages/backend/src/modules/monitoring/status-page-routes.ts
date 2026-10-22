import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { db } from '../../database/index.js';
import { projectsService } from '../projects/service.js';
import { isSmtpConfigured } from '../../config/index.js';
import {
  statusPageService,
  statusPageConfigSchema,
  componentsSchema,
  ComponentsValidationError,
} from './status-page.js';
import { statusSubscribersService } from './subscribers.js';

const uuidSchema = z.string().uuid();

async function getMemberRole(userId: string, organizationId: string): Promise<string | null> {
  const member = await db
    .selectFrom('organization_members')
    .select('role')
    .where('user_id', '=', userId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  return member?.role ?? null;
}

const configBodySchema = statusPageConfigSchema.extend({
  organizationId: uuidSchema,
  projectId: uuidSchema,
});

const componentsBodySchema = z.object({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  components: componentsSchema,
});

/**
 * Admin routes of the public status page (branding and components).
 * Registered under /api/v1/status-page. Members may read, admins and owners
 * may write.
 */
export async function statusPageRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  fastify.get('/config', async (request: any, reply) => {
    const { organizationId, projectId } = request.query ?? {};
    if (!uuidSchema.safeParse(organizationId).success || !uuidSchema.safeParse(projectId).success) {
      return reply.status(400).send({ error: 'valid organizationId and projectId required' });
    }
    if (!(await getMemberRole(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!(await projectsService.projectBelongsToOrg(projectId, organizationId))) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const [cfg, project] = await Promise.all([
      statusPageService.getConfig(projectId, organizationId),
      db
        .selectFrom('projects')
        .select('status_page_visibility')
        .where('id', '=', projectId)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst(),
    ]);

    return reply.send({
      config: cfg,
      subscriptionsAvailable: isSmtpConfigured() && project?.status_page_visibility === 'public',
    });
  });

  fastify.put('/config', async (request: any, reply) => {
    const parse = configBodySchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });
    const { organizationId, projectId, ...input } = parse.data;

    const role = await getMemberRole(request.user.id, organizationId);
    if (role !== 'owner' && role !== 'admin') {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }
    if (!(await projectsService.projectBelongsToOrg(projectId, organizationId))) {
      return reply.status(400).send({ error: 'projectId does not belong to the organization' });
    }

    const cfg = await statusPageService.upsertConfig(projectId, organizationId, input);
    return reply.send({ config: cfg });
  });

  fastify.put('/components', async (request: any, reply) => {
    const parse = componentsBodySchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });
    const { organizationId, projectId, components } = parse.data;

    const role = await getMemberRole(request.user.id, organizationId);
    if (role !== 'owner' && role !== 'admin') {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }
    if (!(await projectsService.projectBelongsToOrg(projectId, organizationId))) {
      return reply.status(400).send({ error: 'projectId does not belong to the organization' });
    }

    try {
      await statusPageService.updateComponents(projectId, organizationId, components);
    } catch (err) {
      if (err instanceof ComponentsValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
    return reply.send({ ok: true });
  });

  // Subscribers hold email addresses: admins and owners only.
  fastify.get('/subscribers', async (request: any, reply) => {
    const { organizationId, projectId, page } = request.query ?? {};
    if (!uuidSchema.safeParse(organizationId).success || !uuidSchema.safeParse(projectId).success) {
      return reply.status(400).send({ error: 'valid organizationId and projectId required' });
    }
    const role = await getMemberRole(request.user.id, organizationId);
    if (role !== 'owner' && role !== 'admin') {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }
    if (!(await projectsService.projectBelongsToOrg(projectId, organizationId))) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    const result = await statusSubscribersService.listConfirmed(organizationId, projectId, Number(page) || 1);
    return reply.send(result);
  });

  fastify.delete('/subscribers/:id', async (request: any, reply) => {
    const { organizationId } = request.query ?? {};
    if (!uuidSchema.safeParse(request.params?.id).success || !uuidSchema.safeParse(organizationId).success) {
      return reply.status(400).send({ error: 'valid id and organizationId required' });
    }
    const role = await getMemberRole(request.user.id, organizationId);
    if (role !== 'owner' && role !== 'admin') {
      return reply.status(403).send({ error: 'Admin or owner role required' });
    }
    const removed = await statusSubscribersService.remove(request.params.id, organizationId);
    if (!removed) return reply.status(404).send({ error: 'Not found' });
    return reply.status(204).send();
  });
}
