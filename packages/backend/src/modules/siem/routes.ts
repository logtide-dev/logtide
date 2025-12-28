import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SiemService } from './service.js';
import { SiemDashboardService } from './dashboard-service.js';
import { enrichmentService } from './enrichment-service.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { db } from '../../database/index.js';

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
          max: 60,
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
                enum: ['critical', 'high', 'medium', 'low', 'informational'],
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
          severity: z
            .array(
              z.enum(['critical', 'high', 'medium', 'low', 'informational'])
            )
            .optional(),
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
          max: 60,
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
          limit: query.limit,
          offset: query.offset,
        });

        return reply.send({ detections });
      } catch (error: any) {
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
              enum: ['critical', 'high', 'medium', 'low', 'informational'],
            },
            status: {
              type: 'string',
              enum: ['open', 'investigating', 'resolved', 'false_positive'],
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
          severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']),
          status: z
            .enum(['open', 'investigating', 'resolved', 'false_positive'])
            .optional(),
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

        // Create incident
        const incident = await siemService.createIncident({
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
            body.detectionEventIds
          );

          // Enrich incident with IP data after linking events
          await siemService.enrichIncidentIpData(incident.id, enrichmentService);
        }

        return reply.status(201).send(incident);
      } catch (error: any) {
        console.error('Error creating incident:', error);
        return reply.status(500).send({
          error: 'Failed to create incident',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/siem/incidents
   * List incidents with filters
   */
  fastify.get(
    '/api/v1/siem/incidents',
    {
      config: {
        rateLimit: {
          max: 60,
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
            status: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['open', 'investigating', 'resolved', 'false_positive'],
              },
            },
            severity: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low', 'informational'],
              },
            },
            assigneeId: { type: 'string', format: 'uuid' },
            service: { type: 'string' },
            technique: { type: 'string' },
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
          status: z
            .array(
              z.enum(['open', 'investigating', 'resolved', 'false_positive'])
            )
            .optional(),
          severity: z
            .array(
              z.enum(['critical', 'high', 'medium', 'low', 'informational'])
            )
            .optional(),
          assigneeId: z.string().uuid().optional(),
          service: z.string().optional(),
          technique: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
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

        const incidents = await siemService.listIncidents({
          organizationId: query.organizationId,
          projectId: query.projectId,
          status: query.status,
          severity: query.severity,
          assigneeId: query.assigneeId,
          service: query.service,
          technique: query.technique,
          limit: query.limit,
          offset: query.offset,
        });

        return reply.send({ incidents });
      } catch (error: any) {
        console.error('Error listing incidents:', error);
        return reply.status(500).send({
          error: 'Failed to list incidents',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/siem/incidents/:id
   * Get incident by ID (with related detections, comments, history)
   */
  fastify.get(
    '/api/v1/siem/incidents/:id',
    {
      config: {
        rateLimit: {
          max: 60,
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

        const incident = await siemService.getIncident(
          params.id,
          query.organizationId
        );

        if (!incident) {
          return reply.status(404).send({
            error: 'Incident not found',
          });
        }

        // Get related data
        const [detections, comments, history] = await Promise.all([
          siemService.getIncidentDetections(params.id),
          siemService.getIncidentComments(params.id),
          siemService.getIncidentHistory(params.id),
        ]);

        return reply.send({
          incident,
          detections,
          comments,
          history,
        });
      } catch (error: any) {
        console.error('Error getting incident:', error);
        return reply.status(500).send({
          error: 'Failed to get incident',
          details: error.message,
        });
      }
    }
  );

  /**
   * PATCH /api/v1/siem/incidents/:id
   * Update incident (status, assignee, etc.)
   */
  fastify.patch(
    '/api/v1/siem/incidents/:id',
    {
      config: {
        rateLimit: {
          max: 30,
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
        body: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            description: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low', 'informational'],
            },
            status: {
              type: 'string',
              enum: ['open', 'investigating', 'resolved', 'false_positive'],
            },
            assigneeId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const paramsSchema = z.object({
          id: z.string().uuid(),
        });

        const bodySchema = z.object({
          organizationId: z.string().uuid(),
          title: z.string().min(1).max(500).optional(),
          description: z.string().optional(),
          severity: z
            .enum(['critical', 'high', 'medium', 'low', 'informational'])
            .optional(),
          status: z
            .enum(['open', 'investigating', 'resolved', 'false_positive'])
            .optional(),
          assigneeId: z.string().uuid().optional().nullable(),
        });

        const params = paramsSchema.parse(request.params);
        const body = bodySchema.parse(request.body);

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

        const incident = await siemService.updateIncident(
          params.id,
          body.organizationId,
          {
            title: body.title,
            description: body.description,
            severity: body.severity,
            status: body.status,
            assigneeId: body.assigneeId,
          }
        );

        return reply.send(incident);
      } catch (error: any) {
        console.error('Error updating incident:', error);
        return reply.status(500).send({
          error: 'Failed to update incident',
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

        return reply.status(204).send();
      } catch (error: any) {
        console.error('Error deleting incident:', error);
        return reply.status(500).send({
          error: 'Failed to delete incident',
          details: error.message,
        });
      }
    }
  );

  // ==========================================================================
  // COMMENTS
  // ==========================================================================

  /**
   * POST /api/v1/siem/incidents/:id/comments
   * Add a comment to an incident
   */
  fastify.post(
    '/api/v1/siem/incidents/:id/comments',
    {
      config: {
        rateLimit: {
          max: 30,
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
        body: {
          type: 'object',
          required: ['organizationId', 'comment'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            comment: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const paramsSchema = z.object({
          id: z.string().uuid(),
        });

        const bodySchema = z.object({
          organizationId: z.string().uuid(),
          comment: z.string().min(1),
        });

        const params = paramsSchema.parse(request.params);
        const body = bodySchema.parse(request.body);

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

        // Verify incident exists and belongs to organization
        const incident = await siemService.getIncident(
          params.id,
          body.organizationId
        );

        if (!incident) {
          return reply.status(404).send({
            error: 'Incident not found or access denied',
          });
        }

        const comment = await siemService.addComment({
          incidentId: params.id,
          userId: request.user.id,
          comment: body.comment,
        });

        return reply.status(201).send(comment);
      } catch (error: any) {
        console.error('Error adding comment:', error);
        return reply.status(500).send({
          error: 'Failed to add comment',
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
