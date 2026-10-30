/**
 * Notification routing preview route.
 *
 * GET /api/v1/notification-routing/preview
 * Read only: who would be notified for an event type, optionally for an
 * explicit channel selection. Any organization member may call it.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NOTIFICATION_ROUTING_EVENT_TYPES } from '@logtide/shared';
import { db } from '../../database/connection.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { resolveRoutingPreview } from './routing-preview.service.js';

const organizationsService = new OrganizationsService();

const MAX_CHANNEL_IDS = 50;

const uuid = z.string().uuid();

const previewQuerySchema = z
  .object({
    organizationId: uuid,
    eventType: z.enum(NOTIFICATION_ROUTING_EVENT_TYPES as [string, ...string[]]),
    projectId: uuid.optional(),
    channelIds: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined || value === '' ? [] : value.split(',')
      )
      .pipe(z.array(uuid).max(MAX_CHANNEL_IDS)),
  })
  .strict();

export async function notificationRoutingRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  fastify.get('/preview', async (request: any, reply) => {
    const parsed = previewQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { organizationId, eventType, projectId, channelIds } = parsed.data;

    try {
      const organizations = await organizationsService.getUserOrganizations(request.user.id);
      if (!organizations.some((org) => org.id === organizationId)) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }

      if (projectId) {
        const project = await db
          .selectFrom('projects')
          .select('id')
          .where('id', '=', projectId)
          .where('organization_id', '=', organizationId)
          .executeTakeFirst();
        if (!project) {
          return reply.status(404).send({ error: 'Project not found' });
        }
      }

      const preview = await resolveRoutingPreview({
        organizationId,
        eventType: eventType as (typeof NOTIFICATION_ROUTING_EVENT_TYPES)[number],
        channelIds,
      });

      return reply.send({ destinations: preview.destinations, fallback: preview.fallback });
    } catch (error) {
      console.error(error, 'Failed to preview routing');
      return reply.status(500).send({ error: 'Failed to preview routing' });
    }
  });
}
