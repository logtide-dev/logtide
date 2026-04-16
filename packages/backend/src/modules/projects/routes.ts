import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { auditLogService } from '../audit-log/index.js';
import { reservoir } from '../../database/reservoir.js';
import { db } from '../../database/connection.js';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';

const createProjectSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  statusPageVisibility: z.enum(['disabled', 'public', 'password', 'members_only']).optional(),
  statusPagePassword: z.string().min(1).max(128).optional(),
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

  // Get project data availability per category
  fastify.get('/data-availability', async (request: any, reply) => {
    const organizationId = request.query.organizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'organizationId query parameter is required',
      });
    }

    try {
      const availability = await projectsService.getProjectDataAvailability(
        organizationId,
        request.user.id,
      );
      return reply.send(availability);
    } catch (error) {
      if (error instanceof Error && error.message.includes('do not have access')) {
        return reply.status(403).send({ error: error.message });
      }
      throw error;
    }
  });

  // Get project capabilities (auto-detect browser SDK features)
  fastify.get('/:id/capabilities', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);

      // Verify access
      const project = await projectsService.getProjectById(id, request.user.id);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      // Check cache first
      const cacheKey = CacheManager.statsKey(id, 'project-capabilities');
      const cached = await CacheManager.get<{ hasWebVitals: boolean; hasSessions: boolean }>(cacheKey);
      if (cached) {
        return reply.send(cached);
      }

      // PERFORMANCE: Checking 7 days of raw logs for strings and sessions is extremely slow
      // on high-volume projects.
      // Optimization:
      // 1. Check a much shorter window (last 24h) - if they have data, it's likely recent.
      // 2. Use the most efficient query possible.
      const recentWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const now = new Date();

      // Check for web vitals and sessions in parallel
      const [webVitalsResult, sessionsResult] = await Promise.all([
        // Substring search on 24h is much faster than 7 days
        reservoir.query({
          projectId: id,
          from: recentWindow,
          to: now,
          search: 'Web Vital:',
          searchMode: 'substring',
          limit: 1,
        }).catch(() => ({ logs: [] })),
        
        // Efficient check for existence of a session_id
        db.selectFrom('logs')
          .select('id')
          .where('project_id', '=', id)
          .where('session_id', 'is not', null)
          .where('time', '>=', recentWindow)
          .limit(1)
          .executeTakeFirst()
          .catch(() => null),
      ]);

      const capabilities = {
        hasWebVitals: webVitalsResult.logs.length > 0,
        hasSessions: !!sessionsResult,
      };

      // Cache for 30 minutes (capabilities don't change often)
      await CacheManager.set(cacheKey, capabilities, CACHE_TTL.STATS * 6);

      return reply.send(capabilities);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid project ID' });
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

      auditLogService.log({
        organizationId: body.organizationId,
        userId: request.user.id,
        userEmail: request.user.email,
        action: 'create_project',
        category: 'config_change',
        resourceType: 'project',
        resourceId: project.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        metadata: { name: project.name },
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

      auditLogService.log({
        organizationId: project.organizationId,
        userId: request.user.id,
        userEmail: request.user.email,
        action: 'update_project',
        category: 'config_change',
        resourceType: 'project',
        resourceId: id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        metadata: body,
      });

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

      const project = await projectsService.getProjectById(id, request.user.id);
      if (!project) {
        return reply.status(404).send({
          error: 'Project not found',
        });
      }

      const deleted = await projectsService.deleteProject(id, request.user.id);

      if (!deleted) {
        return reply.status(404).send({
          error: 'Project not found',
        });
      }

      auditLogService.log({
        organizationId: project.organizationId,
        userId: request.user.id,
        userEmail: request.user.email,
        action: 'delete_project',
        category: 'data_modification',
        resourceType: 'project',
        resourceId: id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

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
