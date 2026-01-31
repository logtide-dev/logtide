/**
 * Exception API Routes
 *
 * Provides endpoints for:
 * - Getting exception details by log ID
 * - Listing and managing error groups
 * - Updating error group status
 * - Getting error group trends and logs
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ERROR_GROUP_STATUSES, EXCEPTION_LANGUAGES } from '@logtide/shared';
import { ExceptionService } from './service.js';
import { usersService } from '../users/service.js';
import { OrganizationsService } from '../organizations/service.js';
import { db } from '../../database/index.js';

const exceptionService = new ExceptionService(db);
const organizationsService = new OrganizationsService();

/**
 * Middleware to extract and validate session token
 */
async function authenticate(request: any, reply: any) {
  const token = request.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return reply.status(401).send({
      error: 'No token provided',
    });
  }

  const user = await usersService.validateSession(token);

  if (!user) {
    return reply.status(401).send({
      error: 'Invalid or expired session',
    });
  }

  request.user = user;
}

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
 * Exception API Routes
 */
export async function exceptionsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // ==========================================================================
  // EXCEPTION DETAILS
  // ==========================================================================

  /**
   * GET /api/v1/exceptions/by-log/:logId
   * Get exception details by log ID (includes stack frames)
   */
  fastify.get(
    '/api/v1/exceptions/by-log/:logId',
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
          required: ['logId'],
          properties: {
            logId: { type: 'string', format: 'uuid' },
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
          logId: z.string().uuid(),
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

        const exception = await exceptionService.getExceptionByLogId(params.logId);

        if (!exception) {
          return reply.status(404).send({
            error: 'No exception found for this log',
          });
        }

        // Verify exception belongs to organization
        if (exception.exception.organizationId !== query.organizationId) {
          return reply.status(403).send({
            error: 'Access denied',
          });
        }

        return reply.send(exception);
      } catch (error: any) {
        console.error('Error getting exception by log:', error);
        return reply.status(500).send({
          error: 'Failed to get exception',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/exceptions/:id
   * Get exception details by exception ID (includes stack frames)
   */
  fastify.get(
    '/api/v1/exceptions/:id',
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

        const exception = await exceptionService.getExceptionById(params.id);

        if (!exception) {
          return reply.status(404).send({
            error: 'Exception not found',
          });
        }

        // Verify exception belongs to organization
        if (exception.exception.organizationId !== query.organizationId) {
          return reply.status(403).send({
            error: 'Access denied',
          });
        }

        return reply.send(exception);
      } catch (error: any) {
        console.error('Error getting exception:', error);
        return reply.status(500).send({
          error: 'Failed to get exception',
          details: error.message,
        });
      }
    }
  );

  // ==========================================================================
  // ERROR GROUPS
  // ==========================================================================

  /**
   * GET /api/v1/error-groups
   * List error groups with filters
   */
  fastify.get(
    '/api/v1/error-groups',
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
            status: { type: 'string', enum: [...ERROR_GROUP_STATUSES] },
            language: { type: 'string', enum: [...EXCEPTION_LANGUAGES] },
            search: { type: 'string' },
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
          status: z.enum(ERROR_GROUP_STATUSES).optional(),
          language: z.enum(EXCEPTION_LANGUAGES).optional(),
          search: z.string().optional(),
          limit: z.coerce.number().min(1).max(100).optional().default(20),
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

        const result = await exceptionService.getErrorGroups({
          organizationId: query.organizationId,
          projectId: query.projectId,
          status: query.status,
          language: query.language,
          search: query.search,
          limit: query.limit,
          offset: query.offset,
        });

        return reply.send(result);
      } catch (error: any) {
        console.error('Error listing error groups:', error);
        return reply.status(500).send({
          error: 'Failed to list error groups',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/error-groups/top
   * Get top error groups for dashboard widget
   */
  fastify.get(
    '/api/v1/error-groups/top',
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
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          limit: z.coerce.number().min(1).max(20).optional().default(5),
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

        const groups = await exceptionService.getTopErrorGroups({
          organizationId: query.organizationId,
          projectId: query.projectId,
          limit: query.limit,
        });

        return reply.send({ groups });
      } catch (error: any) {
        console.error('Error getting top error groups:', error);
        return reply.status(500).send({
          error: 'Failed to get top error groups',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/error-groups/:id
   * Get error group by ID
   */
  fastify.get(
    '/api/v1/error-groups/:id',
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

        const group = await exceptionService.getErrorGroupById(params.id);

        if (!group) {
          return reply.status(404).send({
            error: 'Error group not found',
          });
        }

        // Verify group belongs to organization
        if (group.organizationId !== query.organizationId) {
          return reply.status(403).send({
            error: 'Access denied',
          });
        }

        return reply.send(group);
      } catch (error: any) {
        console.error('Error getting error group:', error);
        return reply.status(500).send({
          error: 'Failed to get error group',
          details: error.message,
        });
      }
    }
  );

  /**
   * PATCH /api/v1/error-groups/:id/status
   * Update error group status (resolve, ignore, reopen)
   */
  fastify.patch(
    '/api/v1/error-groups/:id/status',
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
          required: ['organizationId', 'status'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: [...ERROR_GROUP_STATUSES] },
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
          status: z.enum(ERROR_GROUP_STATUSES),
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

        // Check group exists and belongs to org
        const existingGroup = await exceptionService.getErrorGroupById(params.id);
        if (!existingGroup) {
          return reply.status(404).send({
            error: 'Error group not found',
          });
        }
        if (existingGroup.organizationId !== body.organizationId) {
          return reply.status(403).send({
            error: 'Access denied',
          });
        }

        const group = await exceptionService.updateErrorGroupStatus(
          params.id,
          body.status,
          request.user.id
        );

        return reply.send(group);
      } catch (error: any) {
        console.error('Error updating error group status:', error);
        return reply.status(500).send({
          error: 'Failed to update error group status',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/error-groups/:id/trend
   * Get error group occurrence trend (time-series)
   */
  fastify.get(
    '/api/v1/error-groups/:id/trend',
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
            interval: { type: 'string', enum: ['1h', '1d'] },
            days: { type: 'integer', minimum: 1, maximum: 30 },
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
          interval: z.enum(['1h', '1d']).optional().default('1d'),
          days: z.coerce.number().min(1).max(30).optional().default(7),
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

        // Verify group exists and belongs to org
        const group = await exceptionService.getErrorGroupById(params.id);
        if (!group) {
          return reply.status(404).send({
            error: 'Error group not found',
          });
        }
        if (group.organizationId !== query.organizationId) {
          return reply.status(403).send({
            error: 'Access denied',
          });
        }

        const trend = await exceptionService.getErrorGroupTrend(
          params.id,
          query.interval,
          query.days
        );

        return reply.send({ trend });
      } catch (error: any) {
        console.error('Error getting error group trend:', error);
        return reply.status(500).send({
          error: 'Failed to get error group trend',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/error-groups/:id/logs
   * Get logs associated with an error group
   */
  fastify.get(
    '/api/v1/error-groups/:id/logs',
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
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
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
          limit: z.coerce.number().min(1).max(100).optional().default(10),
          offset: z.coerce.number().min(0).optional().default(0),
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

        // Verify group exists and belongs to org
        const group = await exceptionService.getErrorGroupById(params.id);
        if (!group) {
          return reply.status(404).send({
            error: 'Error group not found',
          });
        }
        if (group.organizationId !== query.organizationId) {
          return reply.status(403).send({
            error: 'Access denied',
          });
        }

        const result = await exceptionService.getLogsForErrorGroup({
          groupId: params.id,
          limit: query.limit,
          offset: query.offset,
        });

        return reply.send(result);
      } catch (error: any) {
        console.error('Error getting error group logs:', error);
        return reply.status(500).send({
          error: 'Failed to get error group logs',
          details: error.message,
        });
      }
    }
  );
}
