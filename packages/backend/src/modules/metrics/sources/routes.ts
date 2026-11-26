import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MetricSourceKind, MetricSourcesResponse } from '@logtide/shared';
import { authenticate } from '../../auth/middleware.js';
import { OrganizationsService } from '../../organizations/service.js';
import { createWithinLimit } from '../../custom-dashboards/routes.js';
import { auditLogService } from '../../audit-log/service.js';
import { resolveProjectScope, MetricScopeError } from '../query/service.js';
import {
  buildCustomizeInput,
  createDashboard,
  getHostDetail,
  getServiceDetail,
  listHosts,
  listServices,
  listSourceIndex,
  sourceMetricNames,
  type SourcesContext,
} from './service.js';
import { getSourceTraceSeries } from './traces.js';

const organizationsService = new OrganizationsService();

const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000;
const CUSTOMIZE_WINDOW_MS = 24 * 60 * 60 * 1000;

const guid = z.string().guid();

const listQuerySchema = z.object({
  organizationId: guid,
  projectIds: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const nameParamSchema = z.object({ name: z.string().min(1).max(500) });

const customizeParamsSchema = z.object({
  kind: z.enum(['host', 'service']),
  name: z.string().min(1).max(500),
});

const customizeBodySchema = z.object({
  organizationId: guid,
  projectIds: z.array(guid).max(100).nullable().optional(),
});

async function isMember(userId: string, organizationId: string): Promise<boolean> {
  const orgs = await organizationsService.getUserOrganizations(userId);
  return orgs.some((o) => o.id === organizationId);
}

function parseWindow(q: { from?: string; to?: string }): { from: Date; to: Date } | null {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - DEFAULT_WINDOW_MS);
  if (!(from.getTime() < to.getTime())) return null;
  return { from, to };
}

export async function sourcesRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  /** Validate, authorize and resolve the scope of a read request; sends the error reply itself. */
  async function readContext(request: any, reply: any): Promise<SourcesContext | null> {
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.status(400).send({ error: 'Invalid query', details: parsed.error.issues });
      return null;
    }
    const q = parsed.data;
    const window = parseWindow(q);
    if (!window) {
      reply.status(400).send({ error: 'from must be before to' });
      return null;
    }
    let requested: string[] | null = null;
    if (q.projectIds) {
      requested = q.projectIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (requested.some((id) => !guid.safeParse(id).success)) {
        reply.status(400).send({ error: 'projectIds must be a comma separated list of ids' });
        return null;
      }
    }
    if (!(await isMember(request.user.id, q.organizationId))) {
      reply.status(403).send({ error: 'Forbidden' });
      return null;
    }
    try {
      const projectIds = await resolveProjectScope(q.organizationId, request.user.id, requested);
      return { organizationId: q.organizationId, projectIds, ...window };
    } catch (e) {
      if (e instanceof MetricScopeError) {
        reply.status(403).send({ error: e.message });
        return null;
      }
      throw e;
    }
  }

  fastify.get('/', async (request: any, reply) => {
    const ctx = await readContext(request, reply);
    if (!ctx) return;
    const [hosts, services] = await Promise.all([listHosts(ctx), listServices(ctx)]);
    const body: MetricSourcesResponse = { hosts, services };
    return body;
  });

  // Names, metric counts and last seen only: for pickers (the catalog side list).
  fastify.get('/index', async (request: any, reply) => {
    const ctx = await readContext(request, reply);
    if (!ctx) return;
    return listSourceIndex(ctx);
  });

  fastify.get('/host/:name', async (request: any, reply) => {
    const params = nameParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid name' });
    const ctx = await readContext(request, reply);
    if (!ctx) return;
    const detail = await getHostDetail(ctx, params.data.name);
    if (!detail) return reply.status(404).send({ error: 'Host not found' });
    return detail;
  });

  fastify.get('/service/:name', async (request: any, reply) => {
    const params = nameParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid name' });
    const ctx = await readContext(request, reply);
    if (!ctx) return;
    const detail = await getServiceDetail(ctx, params.data.name);
    if (!detail) return reply.status(404).send({ error: 'Service not found' });
    return detail;
  });

  // Requests, errors and p95 over time from the entry spans of a host or service.
  fastify.get('/:kind/:name/traces', async (request: any, reply) => {
    const params = customizeParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid source' });
    const ctx = await readContext(request, reply);
    if (!ctx) return;
    return getSourceTraceSeries(ctx, params.data.kind, params.data.name);
  });

  fastify.post('/:kind/:name/customize', async (request: any, reply) => {
    const params = customizeParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid kind or name' });
    const body = customizeBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Invalid body', details: body.error.issues });
    const { organizationId } = body.data;
    const requested = body.data.projectIds && body.data.projectIds.length > 0 ? body.data.projectIds : null;

    if (!(await isMember(request.user.id, organizationId))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    let projectIds: string[];
    try {
      projectIds = await resolveProjectScope(organizationId, request.user.id, requested);
    } catch (e) {
      if (e instanceof MetricScopeError) return reply.status(403).send({ error: e.message });
      throw e;
    }

    const kind = params.data.kind as MetricSourceKind;
    const to = new Date();
    const ctx: SourcesContext = {
      organizationId,
      projectIds,
      from: new Date(to.getTime() - CUSTOMIZE_WINDOW_MS),
      to,
    };
    const key = kind === 'host' ? 'host.name' : 'service.name';
    const metricNames = await sourceMetricNames(ctx, key, params.data.name);
    const input = buildCustomizeInput(kind, params.data.name, organizationId, metricNames, requested);

    // CapabilityError propagates to the global error handler on purpose.
    const dashboard = await createWithinLimit(organizationId, () => createDashboard(input, request.user.id));

    await auditLogService.record({
      action: 'dashboard.created',
      target: { type: 'custom_dashboard', id: dashboard.id },
      organizationId,
      metadata: { name: dashboard.name, source: `${kind}:${params.data.name}` },
    });

    return reply.status(201).send({ dashboardId: dashboard.id });
  });
}

export default sourcesRoutes;
