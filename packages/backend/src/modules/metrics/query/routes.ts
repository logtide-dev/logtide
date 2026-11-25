// POST /api/v1/metrics/query and POST /api/v1/metrics/panels/data.
// Session users only: both read across the projects of an organization.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MetricQueryRequest, PanelConfig } from '@logtide/shared';
import { effectiveVariables, metricQueryRequestSchema, metricPanelsDataSchema } from './schema.js';
import { metricQueryService } from './service.js';
import { isOrgMember, resolveProjectScopeDetailed } from './scope.js';
import { fetchTemplatePanelData } from './panel.js';
import { MetricQueryValidationError, MetricScopeError } from './errors.js';

function sessionUserId(request: FastifyRequest, reply: FastifyReply): string | null {
  const user = (request as { user?: { id: string } }).user;
  if (!user?.id) {
    reply.code(403).send({ error: 'This endpoint requires a user session' });
    return null;
  }
  return user.id;
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof z.ZodError) {
    return reply.code(400).send({ error: 'Validation error', details: err.issues });
  }
  if (err instanceof MetricQueryValidationError) return reply.code(400).send({ error: err.message });
  if (err instanceof MetricScopeError) return reply.code(403).send({ error: err.message });
  throw err;
}

const metricQueryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/query', async (request, reply) => {
    const userId = sessionUserId(request, reply);
    if (!userId) return;
    try {
      const body = metricQueryRequestSchema.parse(request.body) as MetricQueryRequest;
      const scope = await resolveProjectScopeDetailed(body.organizationId, userId, body.projectIds);
      const response = await metricQueryService.run({ ...body, projectIds: scope.projectIds });
      if (scope.warnings.length === 0) return response;
      return { ...response, warnings: [...scope.warnings, ...response.warnings] };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post('/panels/data', async (request, reply) => {
    const userId = sessionUserId(request, reply);
    if (!userId) return;
    try {
      const body = metricPanelsDataSchema.parse(request.body);
      if (!(await isOrgMember(body.organizationId, userId))) {
        throw new MetricScopeError('Access denied - you are not a member of this organization');
      }
      const ctx = {
        organizationId: body.organizationId,
        userId,
        from: new Date(body.from),
        to: new Date(body.to),
        // Declared variables the body leaves out take their default.
        variables: effectiveVariables(body.variables, body.declaredVariables),
      };
      const settled = await Promise.allSettled(
        body.panels.map((p) => fetchTemplatePanelData(p.config as unknown as PanelConfig, ctx)),
      );
      const panels: Record<string, { data?: unknown; error?: string }> = {};
      body.panels.forEach((p, i) => {
        const r = settled[i];
        panels[p.id] =
          r.status === 'fulfilled'
            ? { data: r.value }
            : { error: r.reason instanceof Error ? r.reason.message : 'Failed to load panel data' };
      });
      return { panels };
    } catch (err) {
      return sendError(reply, err);
    }
  });
};

export default metricQueryRoutes;
