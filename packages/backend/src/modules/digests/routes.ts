/**
 * Digest Configuration API Routes (#154)
 *
 * Session-authenticated CRUD for the per-organization digest config and its
 * recipient list. Reads need membership; writes need owner/admin.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { digestsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { context } from '@logtide/shared/context';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { CapabilityError } from '../../capabilities/errors.js';
import { auditLogService } from '../audit-log/service.js';

const organizationsService = new OrganizationsService();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const orgQuerySchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid uuid'),
});

const configBodySchema = z
  .object({
    frequency: z.enum(['daily', 'weekly']),
    deliveryHour: z.number().int().min(0).max(23),
    deliveryDayOfWeek: z.number().int().min(0).max(6).nullish(),
    enabled: z.boolean(),
  })
  .refine((body) => body.frequency !== 'weekly' || body.deliveryDayOfWeek != null, {
    message: 'deliveryDayOfWeek is required for weekly digests',
    path: ['deliveryDayOfWeek'],
  });

const addRecipientSchema = z.object({
  email: z.string().email('Must be a valid email address'),
});

const recipientParamsSchema = z.object({
  id: z.string().uuid(),
});

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

export async function digestsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  /**
   * GET /api/v1/digests/config
   * Current digest config + recipients for an organization (members)
   */
  fastify.get('/config', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const config = await digestsService.getConfig(organizationId);
      const recipients = await digestsService.listRecipients(organizationId);

      return reply.send({ config: config ?? null, recipients });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      console.error(error, 'Failed to get digest config');
      return reply.status(500).send({ error: 'Failed to get digest config' });
    }
  });

  /**
   * PUT /api/v1/digests/config
   * Create or update the organization digest config (admin only)
   */
  fastify.put('/config', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);
      const body = configBodySchema.parse(request.body);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can configure digests' });
      }

      const config = await digestsService.upsertConfig(organizationId, {
        frequency: body.frequency,
        deliveryHour: body.deliveryHour,
        deliveryDayOfWeek: body.deliveryDayOfWeek,
        enabled: body.enabled,
      });

      await auditLogService.record({
        action: 'digest.config_updated',
        target: { type: 'digest_config', id: config.id },
        organizationId,
        metadata: {
          frequency: config.frequency,
          deliveryHour: config.delivery_hour,
          enabled: config.enabled,
        },
      });

      return reply.send({ config });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      console.error(error, 'Failed to save digest config');
      return reply.status(500).send({ error: 'Failed to save digest config' });
    }
  });

  /**
   * DELETE /api/v1/digests/config
   * Remove the digest config (and its recipients via cascade) (admin only)
   */
  fastify.delete('/config', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can configure digests' });
      }

      const deleted = await digestsService.deleteConfig(organizationId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Digest config not found' });
      }

      await auditLogService.record({
        action: 'digest.config_deleted',
        target: { type: 'digest_config', id: organizationId },
        organizationId,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      console.error(error, 'Failed to delete digest config');
      return reply.status(500).send({ error: 'Failed to delete digest config' });
    }
  });

  /**
   * POST /api/v1/digests/recipients
   * Add a recipient (admin only, capability-limited)
   */
  fastify.post('/recipients', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);
      const body = addRecipientSchema.parse(request.body);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can manage digest recipients' });
      }

      const recipient = await withLimitLock(organizationId, 'digests.max_recipients', async () => {
        await context.runAsSystem('digests:recipient-limit-check', async () => {
          await context.with({ organizationId }, async () => {
            const count = await digestsService.countRecipients(organizationId);
            await assertWithinLimit('digests.max_recipients', count);
          });
        });

        return digestsService.addRecipient(organizationId, body.email);
      });

      await auditLogService.record({
        action: 'digest.recipient_added',
        target: { type: 'digest_recipient', id: recipient.id },
        organizationId,
        metadata: { email: recipient.email },
      });

      return reply.status(201).send({ recipient });
    } catch (error) {
      if (error instanceof CapabilityError) {
        throw error;
      }
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      if (error instanceof Error && error.message.includes('not configured')) {
        return reply.status(409).send({ error: 'Configure the digest before adding recipients' });
      }
      if (error instanceof Error && (error.message.includes('unique') || error.message.includes('duplicate'))) {
        return reply.status(409).send({ error: 'This email is already a recipient' });
      }
      console.error(error, 'Failed to add digest recipient');
      return reply.status(500).send({ error: 'Failed to add recipient' });
    }
  });

  /**
   * DELETE /api/v1/digests/recipients/:id
   * Remove a recipient (admin only)
   */
  fastify.delete('/recipients/:id', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);
      const { id } = recipientParamsSchema.parse(request.params);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can manage digest recipients' });
      }

      const removed = await digestsService.removeRecipient(organizationId, id);
      if (!removed) {
        return reply.status(404).send({ error: 'Recipient not found' });
      }

      await auditLogService.record({
        action: 'digest.recipient_removed',
        target: { type: 'digest_recipient', id },
        organizationId,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      console.error(error, 'Failed to remove digest recipient');
      return reply.status(500).send({ error: 'Failed to remove recipient' });
    }
  });

  /**
   * POST /api/v1/digests/recipients/:id/resubscribe
   * Re-subscribe a recipient who opted out (admin only)
   */
  fastify.post('/recipients/:id/resubscribe', async (request: any, reply) => {
    try {
      const { organizationId } = orgQuerySchema.parse(request.query);
      const { id } = recipientParamsSchema.parse(request.params);

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      const isAdmin = await checkAdminRole(request.user.id, organizationId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Only admins can manage digest recipients' });
      }

      const recipient = await digestsService.resubscribeRecipient(organizationId, id);
      if (!recipient) {
        return reply.status(404).send({ error: 'Recipient not found' });
      }

      await auditLogService.record({
        action: 'digest.recipient_resubscribed',
        target: { type: 'digest_recipient', id },
        organizationId,
        metadata: { email: recipient.email },
      });

      return reply.send({ recipient });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      console.error(error, 'Failed to resubscribe digest recipient');
      return reply.status(500).send({ error: 'Failed to resubscribe recipient' });
    }
  });
}
