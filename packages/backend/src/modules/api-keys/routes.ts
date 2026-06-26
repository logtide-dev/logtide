import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { API_KEY_TYPES } from '@logtide/shared';
import { context } from '@logtide/shared/context';
import { apiKeysService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { projectsService } from '../projects/service.js';
import { auditLogService } from '../audit-log/index.js';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { CapabilityError } from '../../capabilities/errors.js';

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  type: z.enum(API_KEY_TYPES).default('write'),
  allowedOrigins: z
    .array(z.string().min(1).max(253))
    .max(50, 'Maximum 50 allowed origins')
    .optional()
    .nullable(),
});

const projectIdSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
});

const apiKeyIdSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
  id: z.string().uuid('Invalid API key ID format'),
});

export async function apiKeysRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // List all API keys for a project
  fastify.get('/:projectId/api-keys', async (request: any, reply) => {
    try {
      const { projectId } = projectIdSchema.parse(request.params);

      // Check if user has access to the project
      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project) {
        return reply.status(404).send({
          error: 'Project not found or access denied',
        });
      }

      const apiKeys = await apiKeysService.listProjectApiKeys(projectId);
      return reply.send({ apiKeys });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid project ID format',
        });
      }

      throw error;
    }
  });

  // Create a new API key for a project
  fastify.post('/:projectId/api-keys', async (request: any, reply) => {
    try {
      const { projectId } = projectIdSchema.parse(request.params);
      const body = createApiKeySchema.parse(request.body);

      // Check if user has access to the project
      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project) {
        return reply.status(404).send({
          error: 'Project not found or access denied',
        });
      }

      const result = await withLimitLock(project.organizationId, 'apikeys.max', async () => {
        await context.runAsSystem('apikeys:create-limit-check', async () => {
          await context.with({ organizationId: project.organizationId }, async () => {
            const count = await apiKeysService.countKeysForOrg(project.organizationId);
            await assertWithinLimit('apikeys.max', count);
          });
        });

        return apiKeysService.createApiKey({
          projectId,
          name: body.name,
          type: body.type,
          allowedOrigins: body.allowedOrigins ?? null,
        });
      });

      await auditLogService.record({
        action: 'apikey.created',
        target: { type: 'api_key', id: result.id },
        organizationId: project.organizationId,
        metadata: { name: body.name, type: body.type, projectId },
      });

      return reply.status(201).send({
        id: result.id,
        apiKey: result.apiKey,
        type: body.type,
        message: 'API key created successfully. Save this key securely - it will not be shown again.',
      });
    } catch (error) {
      if (error instanceof CapabilityError) {
        throw error;
      }
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Revoke an API key
  fastify.delete('/:projectId/api-keys/:id', async (request: any, reply) => {
    try {
      const { projectId, id } = apiKeyIdSchema.parse(request.params);

      // Check if user has access to the project
      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project) {
        return reply.status(404).send({
          error: 'Project not found or access denied',
        });
      }

      const deleted = await apiKeysService.deleteApiKey(id, projectId);

      if (!deleted) {
        return reply.status(404).send({
          error: 'API key not found',
        });
      }

      await auditLogService.record({
        action: 'apikey.revoked',
        target: { type: 'api_key', id },
        organizationId: project.organizationId,
        metadata: { projectId },
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid ID format',
        });
      }

      throw error;
    }
  });
}
