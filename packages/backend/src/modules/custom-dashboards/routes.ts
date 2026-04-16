import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { customDashboardsService } from './service.js';
import { panelInstanceSchema } from './panel-registry.js';
import { fetchPanelData } from './panel-data-service.js';

const organizationsService = new OrganizationsService();

const createSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  isPersonal: z.boolean().optional(),
  panels: z.array(panelInstanceSchema).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  isPersonal: z.boolean().optional(),
  panels: z.array(panelInstanceSchema).optional(),
});

const importYamlSchema = z.object({
  organizationId: z.string().uuid(),
  yaml: z.string().min(1),
});

const panelDataBatchSchema = z.object({
  organizationId: z.string().uuid(),
  panelIds: z.array(z.string()).optional(),
});

async function checkMembership(userId: string, orgId: string): Promise<boolean> {
  const orgs = await organizationsService.getUserOrganizations(userId);
  return orgs.some((o) => o.id === orgId);
}

export async function customDashboardsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // ─── List dashboards ────────────────────────────────────────────────────
  fastify.get('/', async (request: any, reply) => {
    const { organizationId, projectId } = request.query as {
      organizationId?: string;
      projectId?: string;
    };
    if (!organizationId) {
      return reply.status(400).send({ error: 'organizationId required' });
    }
    if (!(await checkMembership(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const dashboards = await customDashboardsService.list(
      organizationId,
      request.user.id,
      projectId !== undefined ? projectId || null : undefined
    );
    return reply.send({ dashboards });
  });

  // ─── Get-or-create default ──────────────────────────────────────────────
  fastify.get('/default', async (request: any, reply) => {
    const { organizationId } = request.query as { organizationId?: string };
    if (!organizationId) {
      return reply.status(400).send({ error: 'organizationId required' });
    }
    if (!(await checkMembership(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const dashboard = await customDashboardsService.ensureDefaultExists(
      organizationId,
      request.user.id
    );
    return reply.send({ dashboard });
  });

  // ─── Create ─────────────────────────────────────────────────────────────
  fastify.post('/', async (request: any, reply) => {
    try {
      const body = createSchema.parse(request.body);
      if (!(await checkMembership(request.user.id, body.organizationId))) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const dashboard = await customDashboardsService.create(
        {
          organizationId: body.organizationId,
          projectId: body.projectId ?? null,
          name: body.name,
          description: body.description ?? null,
          isPersonal: body.isPersonal,
          panels: body.panels,
        },
        request.user.id
      );
      return reply.status(201).send({ dashboard });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: 'Validation error', details: e.errors });
      }
      throw e;
    }
  });

  // ─── YAML import (must come before /:id routes) ─────────────────────────
  fastify.post('/import-yaml', async (request: any, reply) => {
    try {
      const body = importYamlSchema.parse(request.body);
      if (!(await checkMembership(request.user.id, body.organizationId))) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const dashboard = await customDashboardsService.importYaml(
        body.yaml,
        body.organizationId,
        request.user.id
      );
      return reply.status(201).send({ dashboard });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: 'Validation error', details: e.errors });
      }
      if (e instanceof Error) {
        return reply.status(400).send({ error: e.message });
      }
      throw e;
    }
  });

  // ─── Get by ID ──────────────────────────────────────────────────────────
  fastify.get('/:id', async (request: any, reply) => {
    const { organizationId } = request.query as { organizationId?: string };
    if (!organizationId) {
      return reply.status(400).send({ error: 'organizationId required' });
    }
    if (!(await checkMembership(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const dashboard = await customDashboardsService.getById(
      (request.params as { id: string }).id,
      organizationId
    );
    if (!dashboard) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.send({ dashboard });
  });

  // ─── Update ─────────────────────────────────────────────────────────────
  fastify.put('/:id', async (request: any, reply) => {
    try {
      const { organizationId } = request.query as { organizationId?: string };
      if (!organizationId) {
        return reply.status(400).send({ error: 'organizationId required' });
      }
      if (!(await checkMembership(request.user.id, organizationId))) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const body = updateSchema.parse(request.body);
      const dashboard = await customDashboardsService.update(
        (request.params as { id: string }).id,
        organizationId,
        body
      );
      return reply.send({ dashboard });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: 'Validation error', details: e.errors });
      }
      throw e;
    }
  });

  // ─── Delete ─────────────────────────────────────────────────────────────
  fastify.delete('/:id', async (request: any, reply) => {
    const { organizationId } = request.query as { organizationId?: string };
    if (!organizationId) {
      return reply.status(400).send({ error: 'organizationId required' });
    }
    if (!(await checkMembership(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    try {
      await customDashboardsService.delete(
        (request.params as { id: string }).id,
        organizationId
      );
      return reply.status(204).send();
    } catch (e) {
      if (e instanceof Error && e.message.includes('default')) {
        return reply.status(400).send({ error: e.message });
      }
      throw e;
    }
  });

  // ─── YAML export ────────────────────────────────────────────────────────
  fastify.get('/:id/export-yaml', async (request: any, reply) => {
    const { organizationId } = request.query as { organizationId?: string };
    if (!organizationId) {
      return reply.status(400).send({ error: 'organizationId required' });
    }
    if (!(await checkMembership(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    try {
      const yamlText = await customDashboardsService.exportYaml(
        (request.params as { id: string }).id,
        organizationId
      );
      return reply
        .header('Content-Type', 'application/x-yaml')
        .header(
          'Content-Disposition',
          `attachment; filename="dashboard-${(request.params as { id: string }).id}.yaml"`
        )
        .send(yamlText);
    } catch (e) {
      if (e instanceof Error && e.message === 'Dashboard not found') {
        return reply.status(404).send({ error: e.message });
      }
      throw e;
    }
  });

  // ─── Batch panel data ───────────────────────────────────────────────────
  // POST so the (potentially long) panelIds list isn't in a query string.
  fastify.post('/:id/panels/data', async (request: any, reply) => {
    try {
      const body = panelDataBatchSchema.parse(request.body);
      if (!(await checkMembership(request.user.id, body.organizationId))) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const dashboard = await customDashboardsService.getById(
        (request.params as { id: string }).id,
        body.organizationId
      );
      if (!dashboard) {
        return reply.status(404).send({ error: 'Dashboard not found' });
      }

      const requestedIds = body.panelIds && body.panelIds.length > 0
        ? new Set(body.panelIds)
        : null;
      const panelsToFetch = requestedIds
        ? dashboard.panels.filter((p) => requestedIds.has(p.id))
        : dashboard.panels;

      const ctx = { organizationId: body.organizationId, userId: request.user.id };
      const settled = await Promise.allSettled(
        panelsToFetch.map((panel) =>
          fetchPanelData(panel.config, ctx).then((data) => ({
            id: panel.id,
            data,
          }))
        )
      );

      const results: Record<string, { data: unknown; error?: string }> = {};
      panelsToFetch.forEach((panel, idx) => {
        const r = settled[idx];
        if (r.status === 'fulfilled') {
          results[panel.id] = { data: r.value.data };
        } else {
          results[panel.id] = {
            data: null,
            error:
              r.reason instanceof Error
                ? r.reason.message
                : 'Failed to load panel data',
          };
        }
      });

      return reply.send({ panels: results });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: 'Validation error', details: e.errors });
      }
      throw e;
    }
  });
}
