import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { auditLogService } from '../audit-log/index.js';
import { reservoir } from '../../database/reservoir.js';
import { metadataFilterSchema } from '@logtide/shared';
import { sessionsService } from '../sessions/service.js';
import { context } from '@logtide/shared/context';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';
import { emailVerificationService } from '../users/email-verification.js';
import { termsAcceptanceService } from '../users/terms.js';
import { db } from '../../database/connection.js';
import {
  getOrganizationProjectStats,
  getOrganizationHealthSummary,
  getProjectHealthDetail,
  getProjectSummary,
} from './stats.js';
import { isCheckKey, setMute, updateProjectHealthSettings } from '../project-health/index.js';
import {
  PROJECT_HEALTH_SILENT_MAX_MINUTES,
  PROJECT_HEALTH_SILENT_MIN_MINUTES,
} from '@logtide/shared';

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

  // Last event time per project of an organization (registered before /:id)
  fastify.get('/last-events', async (request: any, reply) => {
    let organizationId: string;
    try {
      ({ organizationId } = orgQuerySchema.parse(request.query));
    } catch {
      return reply.status(400).send({
        error: 'organizationId query parameter is required',
      });
    }

    try {
      const lastEvents = await projectsService.getLastEvents(organizationId, request.user.id);
      return reply.send({ lastEvents });
    } catch (error) {
      if (error instanceof Error && error.message.includes('do not have access')) {
        return reply.status(403).send({ error: error.message });
      }
      throw error;
    }
  });

  // Org-level batched stats and health summary (registered before /:id)
  const orgScoped =
    (load: (organizationId: string) => Promise<unknown>) => async (request: any, reply: any) => {
      let organizationId: string;
      try {
        ({ organizationId } = orgQuerySchema.parse(request.query));
      } catch {
        return reply.status(400).send({ error: 'organizationId query parameter is required' });
      }
      try {
        await projectsService.checkOrganizationAccess(organizationId, request.user.id);
      } catch (error) {
        if (error instanceof Error && error.message.includes('do not have access')) {
          return reply.status(403).send({ error: error.message });
        }
        throw error;
      }
      return reply.send({ projects: await load(organizationId) });
    };

  fastify.get('/stats', orgScoped(getOrganizationProjectStats));
  fastify.get('/health-summary', orgScoped(getOrganizationHealthSummary));

  // Active project the caller can read, or sends 404/400 and returns null.
  async function readableProject(request: any, reply: any) {
    const parsed = projectIdSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.status(400).send({ error: 'Invalid project ID format' });
      return null;
    }
    const project = await projectsService.getProjectById(parsed.data.id, request.user.id);
    if (!project) {
      reply.status(404).send({ error: 'Project not found' });
      return null;
    }
    return project;
  }

  // Same as readableProject plus the owner/admin role check (403).
  async function adminProject(request: any, reply: any) {
    const project = await readableProject(request, reply);
    if (!project) return null;
    const member = await db
      .selectFrom('organization_members')
      .select('role')
      .where('user_id', '=', request.user.id)
      .where('organization_id', '=', project.organizationId)
      .executeTakeFirst();
    if (member?.role !== 'owner' && member?.role !== 'admin') {
      reply.status(403).send({ error: 'Admin or owner role required' });
      return null;
    }
    return project;
  }

  fastify.get('/:id/health', async (request: any, reply) => {
    const project = await readableProject(request, reply);
    if (!project) return;
    return reply.send(await getProjectHealthDetail(project.organizationId, project.id));
  });

  fastify.get('/:id/summary', async (request: any, reply) => {
    const project = await readableProject(request, reply);
    if (!project) return;
    return reply.send(await getProjectSummary(project.organizationId, project.id));
  });

  const muteBodySchema = z.object({
    duration: z.enum(['24h', '7d', 'until_resolved']).nullable(),
  });

  fastify.put('/:id/health/mutes/:checkKey', async (request: any, reply) => {
    const { checkKey } = request.params as { checkKey: string };
    const body = muteBodySchema.safeParse(request.body);
    if (!isCheckKey(checkKey) || !body.success) {
      return reply.status(400).send({ error: 'Invalid check key or duration' });
    }
    const project = await adminProject(request, reply);
    if (!project) return;
    if (project.deletedAt) {
      return reply.status(409).send({ error: 'Cannot update a deleted project' });
    }
    await setMute(project.organizationId, project.id, checkKey, body.data.duration);
    return reply.status(204).send();
  });

  const notificationSettingsSchema = z.object({
    healthChannelIds: z.array(z.string().uuid()).max(50).optional(),
    silentMinutes: z
      .number()
      .int()
      .min(PROJECT_HEALTH_SILENT_MIN_MINUTES)
      .max(PROJECT_HEALTH_SILENT_MAX_MINUTES)
      .optional(),
  });

  fastify.put('/:id/notification-settings', async (request: any, reply) => {
    const body = notificationSettingsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation error', details: body.error.errors });
    }
    const project = await adminProject(request, reply);
    if (!project) return;
    if (project.deletedAt) {
      return reply.status(409).send({ error: 'Cannot update a deleted project' });
    }

    const ids = Array.from(new Set(body.data.healthChannelIds ?? []));
    if (ids.length > 0) {
      const found = await db
        .selectFrom('notification_channels')
        .select('id')
        .where('organization_id', '=', project.organizationId)
        .where('id', 'in', ids)
        .execute();
      if (found.length !== ids.length) {
        return reply.status(400).send({ error: 'Unknown notification channel' });
      }
    }
    const settings = await updateProjectHealthSettings(project.organizationId, project.id, body.data);
    return reply.send({
      silentMinutes: settings.silentMinutes,
      healthChannelIds: settings.healthChannelIds,
    });
  });

  // First signal received by a project (any signal type)
  fastify.get('/:id/first-signal', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);
      const signal = await projectsService.getFirstSignal(id, request.user.id);
      if (!signal) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      return reply.send(signal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid project ID' });
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

      // Both probes go through the storage engine (reservoir) so ClickHouse and
      // MongoDB projects are answered from their own store. Short 24h window:
      // if a project has data it is almost certainly recent.
      const recentWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const now = new Date();

      const [webVitalsResult, hasSessions] = await Promise.all([
        // Web vitals records are identified by the performance.metric metadata key
        reservoir.query({
          projectId: id,
          from: recentWindow,
          to: now,
          metadataFilters: [metadataFilterSchema.parse({ key: 'performance.metric', op: 'exists' })],
          limit: 1,
        }).catch(() => ({ logs: [] })),

        sessionsService.hasRecentSessions(id).catch(() => false),
      ]);

      const capabilities = {
        hasWebVitals: webVitalsResult.logs.length > 0,
        hasSessions,
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

  // Get project ingestion health (#279: clock skew warning surface)
  fastify.get('/:id/ingestion-health', async (request: any, reply) => {
    try {
      const { id } = projectIdSchema.parse(request.params);

      // Access control + org scoping: getProjectById joins organization_members
      // on the caller, so a project outside the caller's orgs reads as 404.
      const project = await projectsService.getProjectById(id, request.user.id);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      const health = await projectsService.getIngestionHealth(project.organizationId, id);
      return reply.send(health);
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

      // Restoring re-activates a project, so it counts against projects.max
      // exactly like a create (same lock, same system-context count).
      const restored = await withLimitLock(project.organizationId, 'projects.max', async () => {
        await context.runAsSystem('projects:restore-limit-check', async () => {
          await context.with({ organizationId: project.organizationId }, async () => {
            const count = await projectsService.countActiveForOrg(project.organizationId);
            await assertWithinLimit('projects.max', count);
          });
        });
        return projectsService.restoreProject(id, request.user.id);
      });
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

      // Email verification gate (no-op unless REQUIRE_EMAIL_VERIFICATION=true),
      // checked before the projects.max limit.
      if (await emailVerificationService.isBlocked(request.user.id)) {
        return reply.status(403).send({ error: 'email_not_verified' });
      }
      // Terms gate (no-op unless the LOGTIDE_TERMS_* seam is active).
      if (await termsAcceptanceService.isPending(request.user.id)) {
        return reply.status(403).send({ error: 'terms_not_accepted' });
      }

      const project = await withLimitLock(body.organizationId, 'projects.max', async () => {
        // Membership first so non-members get the access error, not a limit error.
        await projectsService.checkOrganizationAccess(body.organizationId, request.user.id);
        await context.runAsSystem('projects:create-limit-check', async () => {
          await context.with({ organizationId: body.organizationId }, async () => {
            const count = await projectsService.countActiveForOrg(body.organizationId);
            await assertWithinLimit('projects.max', count);
          });
        });

        return projectsService.createProject({
          organizationId: body.organizationId,
          userId: request.user.id,
          name: body.name,
          description: body.description,
        });
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

      // The status page access settings (visibility, password, public slug) are
      // admin-only; plain members can still edit the project name and description.
      if (
        body.statusPageVisibility !== undefined ||
        body.statusPagePassword !== undefined ||
        body.slug !== undefined
      ) {
        const existing = await projectsService.getProjectById(id, request.user.id);
        if (existing) {
          const member = await db
            .selectFrom('organization_members')
            .select('role')
            .where('user_id', '=', request.user.id)
            .where('organization_id', '=', existing.organizationId)
            .executeTakeFirst();
          if (member?.role !== 'owner' && member?.role !== 'admin') {
            return reply.status(403).send({
              error: 'Admin or owner role required to change the status page access settings',
            });
          }
        }
      }

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
