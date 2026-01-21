import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { detectionPacksService } from './service.js';
import { getPackById } from './pack-definitions.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';

const organizationsService = new OrganizationsService();

const thresholdOverrideSchema = z.object({
  level: z.enum(['informational', 'low', 'medium', 'high', 'critical']).optional(),
  emailEnabled: z.boolean().optional(),
  webhookEnabled: z.boolean().optional(),
});

const enablePackSchema = z.object({
  organizationId: z.string().uuid(),
  customThresholds: z.record(z.string(), thresholdOverrideSchema).optional(),
  emailRecipients: z.array(z.string().email()).optional(),
  webhookUrl: z.string().url().optional().nullable(),
});

const updateThresholdsSchema = z.object({
  organizationId: z.string().uuid(),
  customThresholds: z.record(z.string(), thresholdOverrideSchema),
});

const packIdSchema = z.object({
  packId: z.string().min(1),
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

export async function detectionPacksRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  /**
   * GET /api/v1/detection-packs
   * List all available detection packs with status for organization
   */
  fastify.get('/', async (request: any, reply) => {
    try {
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const packs = await detectionPacksService.listPacksWithStatus(organizationId);

      return reply.send({ packs });
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

  /**
   * GET /api/v1/detection-packs/:packId
   * Get single pack details with status
   */
  fastify.get('/:packId', async (request: any, reply) => {
    try {
      const { packId } = packIdSchema.parse(request.params);
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const pack = await detectionPacksService.getPackWithStatus(organizationId, packId);

      if (!pack) {
        return reply.status(404).send({
          error: 'Pack not found',
        });
      }

      return reply.send({ pack });
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

  /**
   * POST /api/v1/detection-packs/:packId/enable
   * Enable a detection pack for organization
   */
  fastify.post('/:packId/enable', async (request: any, reply) => {
    try {
      const { packId } = packIdSchema.parse(request.params);
      const body = enablePackSchema.parse(request.body);

      const isMember = await checkOrganizationMembership(request.user.id, body.organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const pack = getPackById(packId);
      if (!pack) {
        return reply.status(404).send({
          error: 'Pack not found',
        });
      }

      await detectionPacksService.enablePack(
        body.organizationId,
        packId,
        body.customThresholds,
        body.emailRecipients,
        body.webhookUrl
      );

      const updatedPack = await detectionPacksService.getPackWithStatus(
        body.organizationId,
        packId
      );

      return reply.status(201).send({ pack: updatedPack });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }
      if (error instanceof Error && error.message.includes('already enabled')) {
        return reply.status(409).send({
          error: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * POST /api/v1/detection-packs/:packId/disable
   * Disable a detection pack for organization
   */
  fastify.post('/:packId/disable', async (request: any, reply) => {
    try {
      const { packId } = packIdSchema.parse(request.params);
      const organizationId = request.query.organizationId as string;

      if (!organizationId) {
        return reply.status(400).send({
          error: 'organizationId query parameter is required',
        });
      }

      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const pack = getPackById(packId);
      if (!pack) {
        return reply.status(404).send({
          error: 'Pack not found',
        });
      }

      await detectionPacksService.disablePack(organizationId, packId);

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }
      if (error instanceof Error && error.message.includes('is not enabled')) {
        return reply.status(400).send({
          error: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * PUT /api/v1/detection-packs/:packId/thresholds
   * Update thresholds for an enabled pack
   */
  fastify.put('/:packId/thresholds', async (request: any, reply) => {
    try {
      const { packId } = packIdSchema.parse(request.params);
      const body = updateThresholdsSchema.parse(request.body);

      const isMember = await checkOrganizationMembership(request.user.id, body.organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const pack = getPackById(packId);
      if (!pack) {
        return reply.status(404).send({
          error: 'Pack not found',
        });
      }

      // Check if pack is enabled
      const activation = await detectionPacksService.getActivation(body.organizationId, packId);
      if (!activation?.enabled) {
        return reply.status(400).send({
          error: 'Pack must be enabled before updating thresholds',
        });
      }

      await detectionPacksService.updatePackThresholds(
        body.organizationId,
        packId,
        body.customThresholds
      );

      const updatedPack = await detectionPacksService.getPackWithStatus(
        body.organizationId,
        packId
      );

      return reply.send({ pack: updatedPack });
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
