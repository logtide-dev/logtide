import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { retentionService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { requireAdmin } from '../admin/middleware.js';

// Validation schemas
const updateRetentionSchema = z.object({
  retentionDays: z.number().int().min(1).max(365),
});

export async function retentionRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Rate limiting
  const rateLimitConfig = {
    max: 100,
    timeWindow: '1 minute',
  };

  // ============================================================================
  // Admin-only Routes
  // ============================================================================

  // PUT /api/v1/admin/organizations/:id/retention - Update org retention (admin only)
  fastify.put(
    '/organizations/:id/retention',
    {
      preHandler: [requireAdmin],
      config: {
        rateLimit: rateLimitConfig,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = updateRetentionSchema.parse(request.body);

        const result = await retentionService.updateOrganizationRetention(
          id,
          body.retentionDays
        );

        return reply.send({
          message: 'Retention policy updated successfully',
          ...result,
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.status(400).send({
            error: 'Invalid retention days. Must be an integer between 1 and 365.',
          });
        }
        if (error.message === 'Organization not found') {
          return reply.status(404).send({ error: error.message });
        }
        console.error('Error updating retention:', error);
        return reply.status(500).send({
          error: 'Failed to update retention policy',
        });
      }
    }
  );

  // GET /api/v1/admin/organizations/:id/retention - Get org retention status (admin only)
  fastify.get(
    '/organizations/:id/retention',
    {
      preHandler: [requireAdmin],
      config: {
        rateLimit: rateLimitConfig,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const status = await retentionService.getOrganizationRetentionStatus(id);
        return reply.send(status);
      } catch (error: any) {
        if (error.message === 'Organization not found') {
          return reply.status(404).send({ error: error.message });
        }
        console.error('Error getting retention status:', error);
        return reply.status(500).send({
          error: 'Failed to get retention status',
        });
      }
    }
  );

  // POST /api/v1/admin/retention/execute - Trigger manual retention cleanup (admin only)
  fastify.post(
    '/retention/execute',
    {
      preHandler: [requireAdmin],
      config: {
        rateLimit: {
          max: 1, // Only allow 1 manual execution per minute
          timeWindow: '1 minute',
        },
      },
    },
    async (_request, reply) => {
      try {
        const summary = await retentionService.executeRetentionForAllOrganizations();
        return reply.send({
          message: 'Retention cleanup executed successfully',
          ...summary,
        });
      } catch (error) {
        console.error('Error executing retention cleanup:', error);
        return reply.status(500).send({
          error: 'Failed to execute retention cleanup',
        });
      }
    }
  );
}
