/**
 * Notification Channels API Routes
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notificationChannelsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import type { NotificationEventType } from '@logtide/shared';
import { context } from '@logtide/shared/context';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { CapabilityError } from '../../capabilities/errors.js';
import { auditLogService } from '../audit-log/service.js';

const organizationsService = new OrganizationsService();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const emailConfigSchema = z.object({
  recipients: z.array(z.string().email()).min(1, 'At least one email recipient is required'),
});

const webhookConfigSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  method: z.enum(['POST', 'PUT', 'PATCH']).optional(),
  headers: z.record(z.string()).optional(),
  auth: z
    .object({
      type: z.enum(['bearer', 'basic']),
      token: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
});

const channelConfigSchema = z.union([emailConfigSchema, webhookConfigSchema]);

const createChannelSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(['email', 'webhook']),
  config: channelConfigSchema,
  description: z.string().max(500).optional(),
});

const updateChannelSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: channelConfigSchema.optional(),
  description: z.string().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
});

const channelIdSchema = z.object({
  id: z.string().uuid('Invalid channel ID format'),
});

const orgQuerySchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid uuid'),
});

const setChannelsSchema = z.object({
  channelIds: z.array(z.string().uuid()),
});

const eventTypeSchema = z.enum(['alert', 'sigma', 'incident', 'error', 'monitoring']);

// ============================================================================
// HELPERS
// ============================================================================

async function checkOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}

async function checkAdminRole(userId: string, organizationId: string): Promise<boolean> {
  return organizationsService.isOwnerOrAdmin(organizationId, userId);
}

// ============================================================================
// ROUTES
// ============================================================================

export async function notificationChannelsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // ============================================================================
  // CHANNEL CRUD
  // ============================================================================

  /**
   * GET /api/v1/notification-channels
   * List all channels for an organization
   */
  fastify.get('/', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);
      const enabledOnly = request.query.enabled === 'true';
      const type = request.query.type as 'email' | 'webhook' | undefined;

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const channels = await notificationChannelsService.getChannels(organizationId, {
        enabledOnly,
        type,
      });

      return reply.send({ channels });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'organizationId query parameter is required' });
      }
      console.error(error, 'Failed to list notification channels');
      return reply.status(500).send({ error: 'Failed to list channels' });
    }
  });

  /**
   * GET /api/v1/notification-channels/:id
   * Get a single channel
   */
  fastify.get('/:id', async (request: any, reply) => {
    try {
      const { id } = channelIdSchema.parse(request.params);
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const channel = await notificationChannelsService.getChannel(id, organizationId);
      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' });
      }

      return reply.send({ channel });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request', details: error.errors });
      }
      console.error(error, 'Failed to get notification channel');
      return reply.status(500).send({ error: 'Failed to get channel' });
    }
  });

  /**
   * POST /api/v1/notification-channels
   * Create a new channel (admin only)
   */
  fastify.post('/', async (request: any, reply) => {
    try {
      const body = createChannelSchema.parse(request.body);
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can create notification channels' });
      }

      const channel = await withLimitLock(organizationId, 'notifications.max_channels', async () => {
        await context.runAsSystem('channels:create-limit-check', async () => {
          await context.with({ organizationId }, async () => {
            const count = await notificationChannelsService.countChannels(organizationId);
            await assertWithinLimit('notifications.max_channels', count);
          });
        });

        return notificationChannelsService.createChannel(
          organizationId,
          body,
          request.user.id
        );
      });

      await auditLogService.record({
        action: 'channel.created',
        target: { type: 'notification_channel', id: channel.id },
        organizationId,
        metadata: { name: channel.name, type: channel.type },
      });

      return reply.status(201).send({ channel });
    } catch (error) {
      if (error instanceof CapabilityError) {
        throw error;
      }
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      if (error instanceof Error && error.message.includes('unique')) {
        return reply.status(409).send({ error: 'A channel with this name already exists' });
      }
      console.error(error, 'Failed to create notification channel');
      return reply.status(500).send({ error: 'Failed to create channel' });
    }
  });

  /**
   * PUT /api/v1/notification-channels/:id
   * Update a channel (admin only)
   */
  fastify.put('/:id', async (request: any, reply) => {
    try {
      const { id } = channelIdSchema.parse(request.params);
      const body = updateChannelSchema.parse(request.body);
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can update notification channels' });
      }

      const channel = await notificationChannelsService.updateChannel(id, organizationId, body);

      await auditLogService.record({
        action: 'channel.updated',
        target: { type: 'notification_channel', id: channel.id },
        organizationId,
        metadata: { name: channel.name, type: channel.type },
      });

      return reply.send({ channel });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      if (error instanceof Error && error.message === 'Channel not found') {
        return reply.status(404).send({ error: 'Channel not found' });
      }
      console.error(error, 'Failed to update notification channel');
      return reply.status(500).send({ error: 'Failed to update channel' });
    }
  });

  /**
   * DELETE /api/v1/notification-channels/:id
   * Delete a channel (admin only)
   */
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { id } = channelIdSchema.parse(request.params);
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can delete notification channels' });
      }

      const deleted = await notificationChannelsService.deleteChannel(id, organizationId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Channel not found' });
      }

      await auditLogService.record({
        action: 'channel.deleted',
        target: { type: 'notification_channel', id },
        organizationId,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request', details: error.errors });
      }
      console.error(error, 'Failed to delete notification channel');
      return reply.status(500).send({ error: 'Failed to delete channel' });
    }
  });

  /**
   * POST /api/v1/notification-channels/:id/test
   * Test a channel by sending a test notification
   */
  fastify.post('/:id/test', async (request: any, reply) => {
    try {
      const { id } = channelIdSchema.parse(request.params);
      // Accept from body (preferred) or query (legacy)
      const { organizationId } = orgQuerySchema.parse(
        request.body?.organizationId
          ? request.body
          : request.query
      );

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can test notification channels' });
      }

      const result = await notificationChannelsService.testChannel(id, organizationId);

      return reply.send({ result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'organizationId is required' });
      }
      if (error instanceof Error && error.message === 'Channel not found') {
        return reply.status(404).send({ error: 'Channel not found' });
      }
      console.error(error, 'Failed to test notification channel');
      return reply.status(500).send({ error: 'Failed to test channel' });
    }
  });

  // ============================================================================
  // ORGANIZATION DEFAULTS
  // ============================================================================

  /**
   * GET /api/v1/notification-channels/defaults
   * Get all organization default channels
   */
  fastify.get('/defaults', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const defaults = await notificationChannelsService.getAllOrganizationDefaults(organizationId);

      return reply.send({ defaults });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'organizationId is required' });
      }
      console.error(error, 'Failed to get organization defaults');
      return reply.status(500).send({ error: 'Failed to get defaults' });
    }
  });

  /**
   * GET /api/v1/notification-channels/defaults/:eventType
   * Get default channels for an event type
   */
  fastify.get('/defaults/:eventType', async (request: any, reply) => {
    try {
      const eventType = eventTypeSchema.parse(request.params.eventType);
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const channels = await notificationChannelsService.getOrganizationDefaults(
        organizationId,
        eventType as NotificationEventType
      );

      return reply.send({ channels });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid event type' });
      }
      console.error(error, 'Failed to get organization defaults');
      return reply.status(500).send({ error: 'Failed to get defaults' });
    }
  });

  /**
   * PUT /api/v1/notification-channels/defaults/:eventType
   * Set default channels for an event type (admin only)
   */
  fastify.put('/defaults/:eventType', async (request: any, reply) => {
    try {
      const eventType = eventTypeSchema.parse(request.params.eventType);
      const { channelIds } = setChannelsSchema.parse(request.body);
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can update default channels' });
      }

      // Channels must belong to this org: prevent setting defaults to another
      // tenant's channels.
      if (!(await notificationChannelsService.channelsBelongToOrg(channelIds, organizationId))) {
        return reply
          .status(400)
          .send({ error: 'One or more channels do not belong to this organization' });
      }

      await notificationChannelsService.setOrganizationDefaults(
        organizationId,
        eventType as NotificationEventType,
        channelIds
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      console.error(error, 'Failed to set organization defaults');
      return reply.status(500).send({ error: 'Failed to set defaults' });
    }
  });

  /**
   * GET /api/v1/notification-channels/alert-rules/:alertRuleId
   * Get channels for an alert rule
   */
  fastify.get('/alert-rules/:alertRuleId', async (request: any, reply) => {
    try {
      const alertRuleId = request.params.alertRuleId as string;

      if (!alertRuleId) {
        return reply.status(400).send({ error: 'alertRuleId is required' });
      }

      // Resolve the rule's organization and require the caller to be a member,
      // then scope the channel read to that org. Without this any authenticated
      // user could read another tenant's channels (incl. webhook secrets).
      const organizationId =
        await notificationChannelsService.getAlertRuleOrganizationId(alertRuleId);
      if (!organizationId) {
        return reply.status(404).send({ error: 'Alert rule not found' });
      }
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const channels = await notificationChannelsService.getAlertRuleChannels(
        alertRuleId,
        organizationId
      );
      return reply.send({ channels });
    } catch (error) {
      console.error(error, 'Failed to get alert rule channels');
      return reply.status(500).send({ error: 'Failed to get channels' });
    }
  });

  /**
   * GET /api/v1/notification-channels/sigma-rules/:sigmaRuleId
   * Get channels for a sigma rule
   */
  fastify.get('/sigma-rules/:sigmaRuleId', async (request: any, reply) => {
    try {
      const sigmaRuleId = request.params.sigmaRuleId as string;

      if (!sigmaRuleId) {
        return reply.status(400).send({ error: 'sigmaRuleId is required' });
      }

      // Resolve the rule's organization and require the caller to be a member,
      // then scope the channel read to that org (see alert-rules above).
      const organizationId =
        await notificationChannelsService.getSigmaRuleOrganizationId(sigmaRuleId);
      if (!organizationId) {
        return reply.status(404).send({ error: 'Sigma rule not found' });
      }
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const channels = await notificationChannelsService.getSigmaRuleChannels(
        sigmaRuleId,
        organizationId
      );
      return reply.send({ channels });
    } catch (error) {
      console.error(error, 'Failed to get sigma rule channels');
      return reply.status(500).send({ error: 'Failed to get channels' });
    }
  });
}
