/**
 * Capabilities Routes
 *
 * API endpoints for listing and checking capabilities.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import {
  list,
  has,
  CAPABILITY_NAMES,
  type CapabilityName,
} from './service.js';
import { CapabilityError } from './error.js';

// Rate limit config
const rateLimitConfig = {
  max: 100,
  timeWindow: '1 minute',
};

// Query params schema
const organizationQuerySchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
});

/**
 * Authenticated capabilities routes
 * GET /api/v1/capabilities?organizationId=... - List all capabilities for an org
 * GET /api/v1/capabilities/:capability?organizationId=... - Check if a specific capability is enabled
 */
export async function capabilitiesRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // GET /api/v1/capabilities - List all capabilities for an org
  fastify.get('/', {
    config: { rateLimit: rateLimitConfig },
    handler: async (request, reply) => {
      try {
        const query = organizationQuerySchema.parse(request.query);
        const capabilities = await list(query.organizationId);

        return reply.send({
          capabilities,
          organizationId: query.organizationId,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Invalid organization ID',
            details: error.errors,
          });
        }
        console.error('Error listing capabilities:', error);
        return reply.status(500).send({ error: 'Failed to list capabilities' });
      }
    },
  });

  // GET /api/v1/capabilities/:capability - Check if a specific capability is enabled
  fastify.get<{
    Params: { capability: string };
  }>('/:capability', {
    config: { rateLimit: rateLimitConfig },
    handler: async (request, reply) => {
      try {
        const { capability } = request.params;
        const query = organizationQuerySchema.parse(request.query);

        // Validate capability name
        if (!CAPABILITY_NAMES.includes(capability as CapabilityName)) {
          return reply.status(400).send({
            error: `Unknown capability: ${capability}`,
            validCapabilities: CAPABILITY_NAMES,
          });
        }

        const enabled = await has(query.organizationId, capability as CapabilityName);

        return reply.send({
          capability,
          enabled,
          organizationId: query.organizationId,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Invalid organization ID',
            details: error.errors,
          });
        }
        if (error instanceof CapabilityError) {
          return reply.status(403).send({
            error: error.message,
            capability: error.capability,
            organizationId: error.organizationId,
          });
        }
        console.error('Error checking capability:', error);
        return reply.status(500).send({ error: 'Failed to check capability' });
      }
    },
  });
}

