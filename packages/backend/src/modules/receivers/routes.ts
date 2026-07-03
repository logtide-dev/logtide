import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { receiverAdapterTypeSchema, receiverFieldMappingSchema } from '@logtide/shared';
import { context } from '@logtide/shared/context';
import { receiversService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { projectsService } from '../projects/service.js';
import { auditLogService } from '../audit-log/index.js';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { CapabilityError } from '../../capabilities/errors.js';

const createReceiverSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    adapterType: receiverAdapterTypeSchema,
    fieldMapping: receiverFieldMappingSchema.optional().nullable(),
  })
  .refine((v) => v.adapterType === 'generic' || v.fieldMapping == null, {
    message: 'fieldMapping is only supported by the generic adapter',
    path: ['fieldMapping'],
  });

const updateReceiverSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    fieldMapping: receiverFieldMappingSchema.optional().nullable(),
  })
  .refine((v) => v.name !== undefined || v.enabled !== undefined || v.fieldMapping !== undefined, {
    message: 'At least one field must be provided',
  });

const projectIdSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
});

const receiverIdSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
  id: z.string().uuid('Invalid receiver ID format'),
});

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function receiversRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // List receivers for a project
  fastify.get('/:projectId/receivers', async (request: any, reply) => {
    try {
      const { projectId } = projectIdSchema.parse(request.params);

      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project || project.deletedAt) {
        return reply.status(404).send({ error: 'Project not found or access denied' });
      }

      const receivers = await receiversService.listReceivers(projectId);
      return reply.send({ receivers });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid project ID format' });
      }
      throw error;
    }
  });

  // Create a receiver
  fastify.post('/:projectId/receivers', async (request: any, reply) => {
    try {
      const { projectId } = projectIdSchema.parse(request.params);
      const body = createReceiverSchema.parse(request.body);

      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project || project.deletedAt) {
        return reply.status(404).send({ error: 'Project not found or access denied' });
      }

      const result = await withLimitLock(project.organizationId, 'receivers.max', async () => {
        await context.runAsSystem('receivers:create-limit-check', async () => {
          await context.with({ organizationId: project.organizationId }, async () => {
            const count = await receiversService.countReceiversForOrg(project.organizationId);
            await assertWithinLimit('receivers.max', count);
          });
        });

        return receiversService.createReceiver({
          projectId,
          name: body.name,
          adapterType: body.adapterType,
          fieldMapping: body.fieldMapping ?? null,
        });
      });

      await auditLogService.record({
        action: 'receiver.created',
        target: { type: 'receiver', id: result.id },
        organizationId: project.organizationId,
        metadata: { name: body.name, adapterType: body.adapterType, projectId },
      });

      return reply.status(201).send({
        id: result.id,
        token: result.token,
        ingestPath: `/api/v1/receivers/${result.id}/${result.token}`,
        message: 'Receiver created. Save the URL securely - the token will not be shown again.',
      });
    } catch (error) {
      if (error instanceof CapabilityError) {
        throw error;
      }
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      throw error;
    }
  });

  // Update a receiver (rename, enable/disable, edit field mapping)
  fastify.patch('/:projectId/receivers/:id', async (request: any, reply) => {
    try {
      const { projectId, id } = receiverIdSchema.parse(request.params);
      const body = updateReceiverSchema.parse(request.body);

      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project || project.deletedAt) {
        return reply.status(404).send({ error: 'Project not found or access denied' });
      }

      const updated = await receiversService.updateReceiver(id, projectId, body);
      if (!updated) {
        return reply.status(404).send({ error: 'Receiver not found' });
      }
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      throw error;
    }
  });

  // Delete a receiver
  fastify.delete('/:projectId/receivers/:id', async (request: any, reply) => {
    try {
      const { projectId, id } = receiverIdSchema.parse(request.params);

      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project || project.deletedAt) {
        return reply.status(404).send({ error: 'Project not found or access denied' });
      }

      const deleted = await receiversService.deleteReceiver(id, projectId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Receiver not found' });
      }

      await auditLogService.record({
        action: 'receiver.deleted',
        target: { type: 'receiver', id },
        organizationId: project.organizationId,
        metadata: { projectId },
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid ID format' });
      }
      throw error;
    }
  });

  // Recent events for a receiver (debug view)
  fastify.get('/:projectId/receivers/:id/events', async (request: any, reply) => {
    try {
      const { projectId, id } = receiverIdSchema.parse(request.params);
      const { limit } = eventsQuerySchema.parse(request.query ?? {});

      const project = await projectsService.getProjectById(projectId, request.user.id);
      if (!project || project.deletedAt) {
        return reply.status(404).send({ error: 'Project not found or access denied' });
      }

      // Confirm the receiver belongs to this project before listing its events.
      const receivers = await receiversService.listReceivers(projectId);
      if (!receivers.some((r) => r.id === id)) {
        return reply.status(404).send({ error: 'Receiver not found' });
      }

      const events = await receiversService.listEvents(id, limit);
      return reply.send({ events });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid ID format' });
      }
      throw error;
    }
  });
}
