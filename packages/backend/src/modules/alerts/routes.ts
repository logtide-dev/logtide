import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alertsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';

const organizationsService = new OrganizationsService();

const levelEnum = z.enum(['debug', 'info', 'warn', 'error', 'critical']);

const createAlertRuleSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  service: z.string().max(100).optional().nullable(),
  level: z.array(levelEnum).min(1),
  threshold: z.number().int().min(1),
  timeWindow: z.number().int().min(1),
  emailRecipients: z.array(z.string().email()).min(1),
  webhookUrl: z.string().url().optional().nullable(),
});

const updateAlertRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  service: z.string().max(100).optional().nullable(),
  level: z.array(levelEnum).min(1).optional(),
  threshold: z.number().int().min(1).optional(),
  timeWindow: z.number().int().min(1).optional(),
  emailRecipients: z.array(z.string().email()).min(1).optional(),
  webhookUrl: z.string().url().optional().nullable(),
});

const alertRuleIdSchema = z.object({
  id: z.string().uuid('Invalid alert rule ID format'),
});

const getAlertsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  enabledOnly: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

const getHistoryQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 100)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
});

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

export async function alertsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Create alert rule
  fastify.post('/', async (request: any, reply) => {
    try {
      const body = createAlertRuleSchema.parse(request.body);

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, body.organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const alertRule = await alertsService.createAlertRule(body);

      return reply.status(201).send({ alertRule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Get alert rules for organization
  fastify.get('/', async (request: any, reply) => {
    try {
      const query = getAlertsQuerySchema.parse(request.query);
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const alertRules = await alertsService.getAlertRules(organizationId, {
        projectId: query.projectId,
        enabledOnly: query.enabledOnly,
      });

      return reply.send({ alertRules });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Get alert rule by ID
  fastify.get('/:id', async (request: any, reply) => {
    try {
      const { id } = alertRuleIdSchema.parse(request.params);
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const alertRule = await alertsService.getAlertRule(id, organizationId);

      if (!alertRule) {
        return reply.status(404).send({
          error: 'Alert rule not found',
        });
      }

      return reply.send({ alertRule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid alert rule ID format',
        });
      }

      throw error;
    }
  });

  // Update alert rule
  fastify.put('/:id', async (request: any, reply) => {
    try {
      const { id } = alertRuleIdSchema.parse(request.params);
      const body = updateAlertRuleSchema.parse(request.body);
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const alertRule = await alertsService.updateAlertRule(id, organizationId, body);

      if (!alertRule) {
        return reply.status(404).send({
          error: 'Alert rule not found',
        });
      }

      return reply.send({ alertRule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Delete alert rule
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { id } = alertRuleIdSchema.parse(request.params);
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const deleted = await alertsService.deleteAlertRule(id, organizationId);

      if (!deleted) {
        return reply.status(404).send({
          error: 'Alert rule not found',
        });
      }

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid alert rule ID format',
        });
      }

      throw error;
    }
  });

  // Get alert history
  fastify.get('/history', async (request: any, reply) => {
    try {
      const query = getHistoryQuerySchema.parse(request.query);
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const history = await alertsService.getAlertHistory(organizationId, {
        projectId: query.projectId,
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send(history);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });
}
