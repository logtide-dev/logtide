import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectsService } from './service.js';
import { authenticate } from '../auth/middleware.js';

const createProjectSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
});

const projectIdSchema = z.object({
  id: z.string().uuid('Invalid project ID format'),
});

export async function projectsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Get all projects for an organization
  fastify.get('/', async (request: any, reply) => {
    const organizationId = request.query.organizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'organizationId query parameter is required',
      });
    }

    try {
      const projects = await projectsService.getOrganizationProjects(organizationId, request.user.id);
      return reply.send({ projects });
    } catch (error) {
      if (error instanceof Error && error.message.includes('do not have access')) {
        return reply.status(403).send({
          error: error.message,
        });
      }
      throw error;
    }
  });

  // Get a single project
  fastify.get('/:id', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);

      const project = await projectsService.getProjectById(id, request.user.id);

      if (!project) {
        return reply.status(404).send({
          error: 'Project not found',
        });
      }

      return reply.send({ project });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid project ID format',
        });
      }

      throw error;
    }
  });

  // Create a new project
  fastify.post('/', async (request: any, reply) => {
    try {
      const body = createProjectSchema.parse(request.body);

      const project = await projectsService.createProject({
        organizationId: body.organizationId,
        userId: request.user.id,
        name: body.name,
        description: body.description,
      });

      return reply.status(201).send({ project });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          return reply.status(409).send({
            error: error.message,
          });
        }
        if (error.message.includes('do not have access')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Update a project
  fastify.put('/:id', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);
      const body = updateProjectSchema.parse(request.body);

      const project = await projectsService.updateProject(id, request.user.id, body);

      if (!project) {
        return reply.status(404).send({
          error: 'Project not found',
        });
      }

      return reply.send({ project });
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Check if it's a params validation error (UUID) or body validation error
        const firstError = error.errors[0];
        if (firstError?.path[0] === 'id') {
          return reply.status(400).send({
            error: 'Invalid project ID format',
          });
        }
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          return reply.status(409).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Delete a project
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);

      const deleted = await projectsService.deleteProject(id, request.user.id);

      if (!deleted) {
        return reply.status(404).send({
          error: 'Project not found',
        });
      }

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid project ID format',
        });
      }

      throw error;
    }
  });
}
