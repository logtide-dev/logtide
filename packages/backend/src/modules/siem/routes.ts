import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SEVERITIES, INCIDENT_STATUSES, PACK_CATEGORIES } from '@logtide/shared';
import { SiemService } from './service.js';
import { SiemDashboardService } from './dashboard-service.js';
import { enrichmentService } from './enrichment-service.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { db } from '../../database/index.js';
import { auditLogService } from '../audit-log/service.js';
import { registerIncidentRoutes } from '../incidents/routes.js';
import { incidentsService } from '../incidents/service.js';
import { IncidentError } from '../incidents/types.js';
import { projectsService } from '../projects/service.js';

const siemService = new SiemService(db);
const dashboardService = new SiemDashboardService(db);
const organizationsService = new OrganizationsService();

/**
 * Check if user is member of organization
 */
async function checkOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}

/**
 * SIEM API Routes
 */
export async function siemRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Incident list, detail, update, bulk, comments and history are served by
  // the incidents module: this base is an alias of /api/v1/incidents that
  // keeps the legacy default order (created_at desc).
  registerIncidentRoutes(fastify, { basePath: '/api/v1/siem/incidents', defaultSort: 'created_at' });

  // ==========================================================================
  // DASHBOARD STATISTICS
  // ==========================================================================

  /**
   * GET /api/v1/siem/dashboard
   * Get all SIEM dashboard statistics (top threats, timeline, etc.)
   */
  fastify.get(
    '/api/v1/siem/dashboard',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
      schema: {
        querystring: {
          type: 'object',
          required: ['organizationId', 'timeRange'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            timeRange: { type: 'string', enum: ['24h', '7d', '30d'] },
            severity: {
              type: 'array',
              items: {
                type: 'string',
                enum: [...SEVERITIES],
              },
            },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          timeRange: z.enum(['24h', '7d', '30d']),
          severity: z.array(z.enum(SEVERITIES)).optional(),
        });

        const query = schema.parse(request.query);

        // Verify user is member of organization
        const isMember = await checkOrganizationMembership(
          request.user.id,
          query.organizationId
        );

        if (!isMember) {
          return reply.status(403).send({
            error: 'You are not a member of this organization',
          });
        }

        const stats = await dashboardService.getDashboardStats({
          organizationId: query.organizationId,
          projectId: query.projectId ?? null,
          timeRange: query.timeRange,
          severity: query.severity,
        });

        return reply.send(stats);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        console.error('Error getting dashboard stats:', error);
        return reply.status(500).send({
          error: 'Failed to get dashboard statistics',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/siem/detections
   * Get recent detection events
   */
  fastify.get(
    '/api/v1/siem/detections',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
      schema: {
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            category: {
              type: 'array',
              items: { type: 'string', enum: [...PACK_CATEGORIES] },
            },
            severity: {
              type: 'array',
              items: { type: 'string', enum: [...SEVERITIES] },
            },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          category: z.array(z.enum(PACK_CATEGORIES)).optional(),
          severity: z.array(z.enum(SEVERITIES)).optional(),
          limit: z.coerce.number().min(1).max(100).optional().default(10),
          offset: z.coerce.number().min(0).optional().default(0),
        });

        const query = schema.parse(request.query);

        // Verify user is member of organization
        const isMember = await checkOrganizationMembership(
          request.user.id,
          query.organizationId
        );

        if (!isMember) {
          return reply.status(403).send({
            error: 'You are not a member of this organization',
          });
        }

        const detections = await siemService.getDetectionEvents({
          organizationId: query.organizationId,
          projectId: query.projectId,
          category: query.category,
          severity: query.severity,
          limit: query.limit,
          offset: query.offset,
        });

        return reply.send({ detections });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        console.error('Error getting detection events:', error);
        return reply.status(500).send({
          error: 'Failed to get detection events',
          details: error.message,
        });
      }
    }
  );

  // ==========================================================================
  // INCIDENTS
  // ==========================================================================

  /**
   * POST /api/v1/siem/incidents
   * Create a new incident
   */
  fastify.post(
    '/api/v1/siem/incidents',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['organizationId', 'title', 'severity'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            description: { type: 'string' },
            severity: {
              type: 'string',
              enum: [...SEVERITIES],
            },
            status: {
              type: 'string',
              enum: [...INCIDENT_STATUSES],
            },
            assigneeId: { type: 'string', format: 'uuid' },
            traceId: { type: 'string', format: 'uuid' },
            detectionEventIds: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          title: z.string().min(1).max(500),
          description: z.string().optional(),
          severity: z.enum(SEVERITIES),
          status: z.enum(INCIDENT_STATUSES).optional(),
          assigneeId: z.string().uuid().optional(),
          traceId: z.string().uuid().optional(),
          detectionEventIds: z.array(z.string().uuid()).optional(),
        });

        const body = schema.parse(request.body);

        // Verify user is member of organization
        const isMember = await checkOrganizationMembership(
          request.user.id,
          body.organizationId
        );

        if (!isMember) {
          return reply.status(403).send({
            error: 'You are not a member of this organization',
          });
        }

        if (
          body.projectId &&
          !(await projectsService.projectBelongsToOrg(body.projectId, body.organizationId))
        ) {
          return reply.status(404).send({ error: 'Project not found' });
        }
        if (body.assigneeId) {
          await incidentsService.assertAssignableUser(body.organizationId, body.assigneeId);
        }

        // Create incident. A hand-made incident is 'manual'; only one built
        // from detection events is a sigma incident.
        const incident = await siemService.createIncident({
          source: body.detectionEventIds && body.detectionEventIds.length > 0 ? 'sigma' : 'manual',
          organizationId: body.organizationId,
          projectId: body.projectId,
          title: body.title,
          description: body.description,
          severity: body.severity,
          status: body.status,
          assigneeId: body.assigneeId,
          traceId: body.traceId,
        });

        // Link detection events if provided
        if (body.detectionEventIds && body.detectionEventIds.length > 0) {
          await siemService.linkDetectionEventsToIncident(
            incident.id,
            body.detectionEventIds,
            body.organizationId
          );

          // Enrich incident with IP data after linking events
          await siemService.enrichIncidentIpData(incident.id, enrichmentService, body.organizationId);
        }

        return reply.status(201).send(incident);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        if (error instanceof IncidentError) {
          return reply.status(error.statusCode).send({ error: error.message, code: error.code });
        }
        console.error('Error creating incident:', error);
        return reply.status(500).send({
          error: 'Failed to create incident',
          details: error.message,
        });
      }
    }
  );

  /**
   * DELETE /api/v1/siem/incidents/:id
   * Delete an incident
   */
  fastify.delete(
    '/api/v1/siem/incidents/:id',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const paramsSchema = z.object({
          id: z.string().uuid(),
        });

        const querySchema = z.object({
          organizationId: z.string().uuid(),
        });

        const params = paramsSchema.parse(request.params);
        const query = querySchema.parse(request.query);

        // Verify user is member of organization
        const isMember = await checkOrganizationMembership(
          request.user.id,
          query.organizationId
        );

        if (!isMember) {
          return reply.status(403).send({
            error: 'You are not a member of this organization',
          });
        }

        await siemService.deleteIncident(params.id, query.organizationId);

        await auditLogService.record({
          action: 'incident.deleted',
          target: { type: 'incident', id: params.id },
          organizationId: query.organizationId,
        });

        return reply.status(204).send();
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        console.error('Error deleting incident:', error);
        return reply.status(500).send({
          error: 'Failed to delete incident',
          details: error.message,
        });
      }
    }
  );

  // ==========================================================================
  // ENRICHMENT (Optional Features)
  // ==========================================================================

  /**
   * POST /api/v1/siem/enrichment/ip-reputation
   * Check IP reputation (AbuseIPDB)
   */
  fastify.post(
    '/api/v1/siem/enrichment/ip-reputation',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['ip'],
          properties: {
            ip: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          ip: z.string().ip(),
        });

        const body = schema.parse(request.body);

        const reputation = await enrichmentService.checkIpReputation(body.ip);

        if (!reputation) {
          return reply.status(503).send({
            error: 'IP reputation service unavailable or not configured',
          });
        }

        return reply.send(reputation);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        console.error('Error checking IP reputation:', error);
        return reply.status(500).send({
          error: 'Failed to check IP reputation',
          details: error.message,
        });
      }
    }
  );

  /**
   * POST /api/v1/siem/enrichment/geoip
   * Get GeoIP data (MaxMind)
   */
  fastify.post(
    '/api/v1/siem/enrichment/geoip',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['ip'],
          properties: {
            ip: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          ip: z.string().ip(),
        });

        const body = schema.parse(request.body);

        const geoData = await enrichmentService.getGeoIpData(body.ip);

        if (!geoData) {
          return reply.status(503).send({
            error: 'GeoIP service unavailable or not configured',
          });
        }

        return reply.send(geoData);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        console.error('Error getting GeoIP data:', error);
        return reply.status(500).send({
          error: 'Failed to get GeoIP data',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/siem/enrichment/status
   * Check enrichment services configuration status
   */
  fastify.get('/api/v1/siem/enrichment/status', async (_request, reply) => {
    const status = enrichmentService.getStatus();
    return reply.send(status);
  });
}
