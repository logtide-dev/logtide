/**
 * Webhook delivery API (#218): list deliveries (incl. DLQ via status=dead),
 * fetch a delivery with its attempts, and replay a dead/failed delivery.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { webhookDeliveryService, redactDeliveryForApi } from './service.js';
import { webhookDispatcher } from './dispatcher.js';
import { auditLogService } from '../audit-log/service.js';

const organizationsService = new OrganizationsService();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(['pending', 'delivered', 'failed', 'dead']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================================
// HELPERS
// ============================================================================

async function checkOrganizationMembership(userId: string, organizationId: string): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}

async function checkAdminRole(userId: string, organizationId: string): Promise<boolean> {
  return organizationsService.isOwnerOrAdmin(organizationId, userId);
}

// ============================================================================
// ROUTES
// ============================================================================

export async function webhookDeliveriesRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  /**
   * GET /api/v1/webhooks/deliveries
   * List deliveries for an org, optionally filtered by status (dead = DLQ).
   */
  fastify.get('/deliveries', async (request: any, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { organizationId, status, limit, offset } = parsed.data;

    const isMember = await checkOrganizationMembership(request.user.id, organizationId);
    if (!isMember) {
      return reply.status(403).send({ error: 'Not a member of this organization' });
    }

    const isAdmin = await checkAdminRole(request.user.id, organizationId);
    const deliveries = await webhookDeliveryService.listDeliveries(organizationId, { status, limit, offset });
    return reply.send({ deliveries: deliveries.map((d) => redactDeliveryForApi(d, isAdmin)) });
  });

  /**
   * GET /api/v1/webhooks/deliveries/:id
   * Fetch a single delivery with its attempt log.
   */
  fastify.get('/deliveries/:id', async (request: any, reply) => {
    const { id } = request.params as { id: string };

    const delivery = await webhookDeliveryService.getDelivery(id);
    if (!delivery) return reply.status(404).send({ error: 'Delivery not found' });

    const isMember = await checkOrganizationMembership(request.user.id, delivery.organization_id);
    if (!isMember) {
      return reply.status(403).send({ error: 'Not a member of this organization' });
    }

    const isAdmin = await checkAdminRole(request.user.id, delivery.organization_id);
    const attempts = await webhookDeliveryService.listAttempts(id);
    return reply.send({ delivery: redactDeliveryForApi(delivery, isAdmin), attempts });
  });

  /**
   * POST /api/v1/webhooks/deliveries/:id/replay
   * Re-enqueue a dead-letter delivery. Admin only.
   */
  fastify.post('/deliveries/:id/replay', async (request: any, reply) => {
    const { id } = request.params as { id: string };

    const delivery = await webhookDeliveryService.getDelivery(id);
    if (!delivery) return reply.status(404).send({ error: 'Delivery not found' });

    const isAdmin = await checkAdminRole(request.user.id, delivery.organization_id);
    if (!isAdmin) {
      return reply.status(403).send({ error: 'Only admins can replay deliveries' });
    }

    // Only terminal 'dead' (dead-letter) deliveries may be replayed. A 'failed'
    // delivery still has a delayed retry job enqueued, so replaying it would
    // double-deliver and race attempt_count with the in-flight retry.
    if (delivery.status !== 'dead') {
      return reply.status(409).send({ error: 'Only dead-letter deliveries can be replayed' });
    }

    const reset = await webhookDeliveryService.resetForReplay(id);
    await webhookDispatcher.enqueueExisting(id);

    // host only: webhook URLs can embed credentials (e.g. Slack tokens)
    let urlHost: string | null = null;
    try {
      urlHost = new URL(delivery.url).host;
    } catch {
      urlHost = null;
    }
    await auditLogService.record({
      action: 'webhook.delivery_replayed',
      target: { type: 'webhook_delivery', id },
      organizationId: delivery.organization_id,
      metadata: { eventType: delivery.event_type, urlHost },
    });

    return reply.send({ delivery: redactDeliveryForApi(reset, true) });
  });
}
