import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, SERVICE_ACTOR_LABEL } from '../auth/middleware.js';
import { requireAdmin } from '../admin/middleware.js';
import { validateUuidParams } from '../admin/params.js';
import {
  entitlementInputSchema,
  EntitlementValidationError,
  getOrganizationEntitlements,
  setOrganizationEntitlements,
  resetOrganizationEntitlement,
} from './entitlements-service.js';

const putBodySchema = z.object({
  entitlements: z.array(entitlementInputSchema).min(1),
});

export async function adminEntitlementsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);
  fastify.addHook('preValidation', validateUuidParams);

  const rateLimitConfig = { max: 100, timeWindow: '1 minute' };

  // GET /api/v1/admin/organizations/:id/entitlements
  fastify.get(
    '/organizations/:id/entitlements',
    { preHandler: [requireAdmin], config: { allowServiceToken: true, rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await getOrganizationEntitlements(id));
    }
  );

  // PUT /api/v1/admin/organizations/:id/entitlements
  fastify.put(
    '/organizations/:id/entitlements',
    { preHandler: [requireAdmin], config: { allowServiceToken: true, rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const body = putBodySchema.parse(request.body);
        const { updated } = await setOrganizationEntitlements(
          id,
          body.entitlements,
          request.servicePrincipal ? SERVICE_ACTOR_LABEL : undefined
        );
        return reply.send({ message: 'Entitlements updated', updated });
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.errors });
        }
        // the service throws plain Errors for registry/shape mismatches -> 400
        if (error instanceof Error) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  // DELETE /api/v1/admin/organizations/:id/entitlements/:capability
  // Removes the explicit override so the org inherits the default again.
  fastify.delete(
    '/organizations/:id/entitlements/:capability',
    { preHandler: [requireAdmin], config: { allowServiceToken: true, rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const { id, capability } = request.params as { id: string; capability: string };
      try {
        const { removed } = await resetOrganizationEntitlement(
          id,
          capability,
          request.servicePrincipal ? SERVICE_ACTOR_LABEL : undefined
        );
        return reply.send({ removed });
      } catch (error: unknown) {
        if (error instanceof EntitlementValidationError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );
}
