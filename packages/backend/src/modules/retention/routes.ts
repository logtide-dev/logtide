import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { retentionService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { requireAdmin } from '../admin/middleware.js';
import { SERVICE_ACTOR_LABEL } from '../auth/middleware.js';
import { auditLogService } from '../audit-log/index.js';

// Validation schemas
const updateRetentionSchema = z
  .object({
    retentionDays: z.number().int().min(1).max(365).optional(),
    auditRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .refine((b) => b.retentionDays !== undefined || b.auditRetentionDays !== undefined, {
    message: 'At least one of retentionDays or auditRetentionDays is required',
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
        allowServiceToken: true,
        rateLimit: rateLimitConfig,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = updateRetentionSchema.parse(request.body);

        const response = await retentionService.setOrganizationRetentionPolicy(
          id,
          body,
          request.servicePrincipal ? SERVICE_ACTOR_LABEL : undefined
        );

        return reply.send(response);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Invalid retention configuration. retentionDays must be 1-365; auditRetentionDays must be 1-3650 or null.',
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
        allowServiceToken: true,
        rateLimit: rateLimitConfig,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        return reply.send(await retentionService.getOrganizationRetentionPolicy(id));
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
        const auditSummary = await retentionService.executeAuditRetentionForAllOrganizations();

        if (auditSummary.totalEntriesDeleted > 0) {
          await auditLogService.record({
            action: 'data.deleted',
            organizationId: null,
            target: { type: 'audit_log', id: null },
            metadata: { scope: 'audit_retention', entriesDeleted: auditSummary.totalEntriesDeleted },
          });
        }

        return reply.send({
          message: 'Retention cleanup executed successfully',
          ...summary,
          auditRetention: auditSummary,
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
