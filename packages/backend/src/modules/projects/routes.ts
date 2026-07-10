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
  slug: z.string().min(2).max(50).optional(),
  statusPageVisibility: z.enum(['disabled', 'public', 'password', 'members_only']).optional(),
  statusPagePassword: z.string().min(1).max(128).optional(),
});

const projectIdSchema = z.object({
  id: z.string().uuid('Invalid project ID format'),
});

const orgQuerySchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid uuid'),
});

const orgQueryWithDeletedSchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid uuid'),
  includeDeleted: z.enum(['true', 'false']).optional(),
});

export async function projectsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Get all projects for an organization
  fastify.get('/', async (request: any, reply) => {
    let organizationId: string;
    let includeDeleted = false;
    try {
      const parsed = orgQueryWithDeletedSchema.parse(request.query);
      organizationId = parsed.organizationId;
      includeDeleted = parsed.includeDeleted === 'true';
    } catch {
      return reply.status(400).send({
        error: 'organizationId query parameter is required',
      });
    }

    try {
      const projects = includeDeleted
        ? await projectsService.getOrganizationProjectsIncludingDeleted(organizationId, request.user.id)
        : await projectsService.getOrganizationProjects(organizationId, request.user.id);
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
    let organizationId: string;
    try {
      ({ organizationId } = orgQuerySchema.parse(request.query));
    } catch {
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

  // Restore a soft-deleted project
  fastify.post('/:id/restore', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);

      const project = await projectsService.getProjectById(id, request.user.id);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      if (!project.deletedAt) {
        return reply.status(409).send({ error: 'Project is not deleted' });
      }

      const restored = await projectsService.restoreProject(id, request.user.id);
      if (!restored) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      await auditLogService.record({
        action: 'project.restored',
        target: { type: 'project', id },
        organizationId: project.organizationId,
      });

      const updated = await projectsService.getProjectById(id, request.user.id);
      return reply.send({ project: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid project ID format' });
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return reply.status(409).send({ error: error.message });
      }
      // Safety net for a concurrent name/slug reuse that slips past the
      // pre-check and trips the partial unique index (Postgres 23505).
      if ((error as { code?: string })?.code === '23505') {
        return reply.status(409).send({
          error: 'A project with this name or slug already exists in this organization',
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

      if (!project || project.deletedAt) {
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

      await auditLogService.record({
        action: 'project.created',
        target: { type: 'project', id: project.id },
        organizationId: body.organizationId,
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

      await auditLogService.record({
        action: 'project.updated',
        target: { type: 'project', id },
        organizationId: project.organizationId,
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
        if (error.message.includes('idx_projects_org_slug_unique')) {
          return reply.status(409).send({
            error: 'A project with this slug already exists in this organization',
          });
        }
        if (error.message.includes('Cannot update a deleted project')) {
          return reply.status(409).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Soft-delete a project
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);

      const project = await projectsService.getProjectById(id, request.user.id);
      if (!project) {
        return reply.status(404).send({
          error: 'Project not found',
        });
      }
      if (project.deletedAt) {
        return reply.status(409).send({
          error: 'Project is already deleted',
        });
      }

      const deleted = await projectsService.deleteProject(id, request.user.id);

      if (!deleted) {
        return reply.status(404).send({
          error: 'Project not found',
        });
      }

      await auditLogService.record({
        action: 'project.soft_delete',
        target: { type: 'project', id },
        organizationId: project.organizationId,
        metadata: { name: project.name },
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
