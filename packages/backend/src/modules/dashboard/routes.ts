import type { FastifyPluginAsync } from 'fastify';
import { dashboardService } from './service.js';
import { db } from '../../database/index.js';
import { requireFullAccess } from '../auth/guards.js';
import { fetchPanelData } from '../custom-dashboards/panel-data-service.js';
import type { ActivityOverviewConfig, ActivityOverviewSeries } from '@logtide/shared';

const ACTIVITY_OVERVIEW_SERIES: ActivityOverviewSeries[] = [
  'logs',
  'log_errors',
  'spans',
  'span_errors',
  'detections',
  'alerts',
];


async function verifyOrganizationAccess(organizationId: string, userId: string): Promise<boolean> {
  const result = await db
    .selectFrom('organization_members')
    .select(['organization_id'])
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return !!result;
}

async function verifyProjectBelongsToOrg(projectId: string, organizationId: string): Promise<boolean> {
  const result = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', projectId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();

  return !!result;
}

/** Returned when access was denied and a response has already been sent. */
const SCOPE_DENIED = Symbol('dashboard-scope-denied');

/**
 * Resolve and authorize the tenant scope for a dashboard request.
 *
 * Session auth (request.user set): the user must be a member of the requested
 * organization; a provided projectId must belong to that organization.
 *
 * API-key auth (no user; request.organizationId/projectId bound by the auth
 * plugin): the requested organizationId MUST match the key's bound organization
 * and a provided projectId MUST match the key's bound project. When projectId is
 * omitted it defaults to the key's bound project, so a project-scoped key can
 * never read org-wide or cross-org data. This mirrors resolveQueryProjectId,
 * which already protects the query and traces routes.
 *
 * Returns the effective projectId to scope on (string | undefined), or
 * SCOPE_DENIED if a 403/404 was already sent.
 */
async function resolveDashboardScope(
  request: any,
  reply: any,
  organizationId: string,
  projectId?: string,
): Promise<string | undefined | typeof SCOPE_DENIED> {
  // Session-based auth: org-wide membership check.
  if (request.user?.id) {
    const hasAccess = await verifyOrganizationAccess(organizationId, request.user.id);
    if (!hasAccess) {
      reply.code(403).send({
        error: 'Access denied - you are not a member of this organization',
      });
      return SCOPE_DENIED;
    }

    if (projectId) {
      const belongsToOrg = await verifyProjectBelongsToOrg(projectId, organizationId);
      if (!belongsToOrg) {
        reply.code(404).send({ error: 'Project not found in this organization' });
        return SCOPE_DENIED;
      }
    }

    return projectId;
  }

  // API-key auth: the key is bound to a single org/project by the auth plugin.
  // Enforce that the requested org/project match the key's bound values.
  const boundOrg = request.organizationId;
  const boundProject = request.projectId;

  if (boundOrg && organizationId !== boundOrg) {
    reply.code(403).send({
      error: 'Access denied - API key is not bound to this organization',
    });
    return SCOPE_DENIED;
  }

  if (boundProject && projectId && projectId !== boundProject) {
    reply.code(403).send({
      error: 'Access denied - API key is not bound to this project',
    });
    return SCOPE_DENIED;
  }

  // Default to the key's bound project so a project-scoped key cannot read
  // org-wide data (mirrors resolveQueryProjectId).
  return projectId ?? boundProject;
}

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/dashboard/stats - Get dashboard statistics
  fastify.get('/api/v1/dashboard/stats', {
    schema: {
      description: 'Get dashboard statistics for organization or project',
      tags: ['dashboard'],
      querystring: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
        },
        required: ['organizationId'],
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { organizationId, projectId } = request.query as { organizationId: string; projectId?: string };

      if (!organizationId) {
        return reply.code(400).send({
          error: 'organizationId is required',
        });
      }

      const scope = await resolveDashboardScope(request, reply, organizationId, projectId);
      if (scope === SCOPE_DENIED) return;

      const stats = await dashboardService.getStats(organizationId, scope);
      return stats;
    },
  });

  // GET /api/v1/dashboard/timeseries - Get timeseries data for chart
  fastify.get('/api/v1/dashboard/timeseries', {
    schema: {
      description: 'Get timeseries data for dashboard chart (last 24 hours)',
      tags: ['dashboard'],
      querystring: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
        },
        required: ['organizationId'],
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { organizationId, projectId } = request.query as { organizationId: string; projectId?: string };

      if (!organizationId) {
        return reply.code(400).send({
          error: 'organizationId is required',
        });
      }

      const scope = await resolveDashboardScope(request, reply, organizationId, projectId);
      if (scope === SCOPE_DENIED) return;

      const timeseries = await dashboardService.getTimeseries(organizationId, scope);
      return { timeseries };
    },
  });

  // GET /api/v1/dashboard/activity-overview - Multi-signal activity timeline
  // (logs, spans, detections, alerts). Reuses the custom-dashboard panel fetcher.
  fastify.get('/api/v1/dashboard/activity-overview', {
    schema: {
      description: 'Get multi-signal activity overview timeline for organization or project',
      tags: ['dashboard'],
      querystring: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          timeRange: { type: 'string', enum: ['24h', '7d', '30d'] },
        },
        required: ['organizationId'],
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { organizationId, projectId, timeRange } = request.query as {
        organizationId: string;
        projectId?: string;
        timeRange?: '24h' | '7d' | '30d';
      };

      if (!organizationId) {
        return reply.code(400).send({ error: 'organizationId is required' });
      }

      const scope = await resolveDashboardScope(request, reply, organizationId, projectId);
      if (scope === SCOPE_DENIED) return;

      const config: ActivityOverviewConfig = {
        type: 'activity_overview',
        title: 'Activity Overview',
        source: 'mixed',
        projectId: scope ?? null,
        timeRange: timeRange ?? '24h',
        series: ACTIVITY_OVERVIEW_SERIES,
      };

      const data = await fetchPanelData(config, {
        organizationId,
        userId: request.user?.id ?? '',
      });
      return data;
    },
  });

  // GET /api/v1/dashboard/top-services - Get top services
  fastify.get('/api/v1/dashboard/top-services', {
    schema: {
      description: 'Get top services by log count for organization or project',
      tags: ['dashboard'],
      querystring: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          limit: { type: 'number', minimum: 1, maximum: 20, default: 5 },
        },
        required: ['organizationId'],
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { organizationId, projectId, limit } = request.query as { organizationId: string; projectId?: string; limit?: number };

      if (!organizationId) {
        return reply.code(400).send({
          error: 'organizationId is required',
        });
      }

      const scope = await resolveDashboardScope(request, reply, organizationId, projectId);
      if (scope === SCOPE_DENIED) return;

      const services = await dashboardService.getTopServices(organizationId, limit || 5, scope);
      return { services };
    },
  });

  // GET /api/v1/dashboard/timeline-events - Get alert/detection events for chart markers
  fastify.get('/api/v1/dashboard/timeline-events', {
    schema: {
      description: 'Get timeline events (alerts + detections) for last 24 hours',
      tags: ['dashboard'],
      querystring: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
        },
        required: ['organizationId'],
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { organizationId, projectId } = request.query as { organizationId: string; projectId?: string };

      if (!organizationId) {
        return reply.code(400).send({
          error: 'organizationId is required',
        });
      }

      const scope = await resolveDashboardScope(request, reply, organizationId, projectId);
      if (scope === SCOPE_DENIED) return;

      const events = await dashboardService.getTimelineEvents(organizationId, scope);
      return { events };
    },
  });

  // GET /api/v1/dashboard/recent-errors - Get recent errors
  fastify.get('/api/v1/dashboard/recent-errors', {
    schema: {
      description: 'Get recent error logs for organization or project',
      tags: ['dashboard'],
      querystring: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
        },
        required: ['organizationId'],
      },
    },
    handler: async (request: any, reply) => {
      if (!await requireFullAccess(request, reply)) return;

      const { organizationId, projectId } = request.query as { organizationId: string; projectId?: string };

      if (!organizationId) {
        return reply.code(400).send({
          error: 'organizationId is required',
        });
      }

      const scope = await resolveDashboardScope(request, reply, organizationId, projectId);
      if (scope === SCOPE_DENIED) return;

      const errors = await dashboardService.getRecentErrors(organizationId, scope);
      return { errors };
    },
  });
};

export default dashboardRoutes;
