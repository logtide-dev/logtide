/**
 * Source Maps API Routes
 *
 * - POST /api/v1/sourcemaps - upload a source map (API key auth, full-access)
 * - GET /api/v1/sourcemaps - list source maps (session auth)
 * - DELETE /api/v1/sourcemaps/:release - delete maps for a release (session auth)
 */

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { requireFullAccess } from '../auth/guards.js';
import { usersService } from '../users/service.js';
import { OrganizationsService } from '../organizations/service.js';
import { projectsService } from '../projects/service.js';
import { sourceMapsService } from './index.js';
import { db } from '../../database/index.js';

const organizationsService = new OrganizationsService();

async function authenticate(request: any, reply: any) {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return reply.status(401).send({ error: 'No token provided' });
  }
  const user = await usersService.validateSession(token);
  if (!user) {
    return reply.status(401).send({ error: 'Invalid or expired session' });
  }
  request.user = user;
}

async function checkOrgMembership(userId: string, orgId: string): Promise<boolean> {
  const orgs = await organizationsService.getUserOrganizations(userId);
  return orgs.some((o) => o.id === orgId);
}

export async function sourcemapsRoutes(fastify: FastifyInstance) {
  // Register multipart for this scope only
  await fastify.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per source map
  });

  // ==========================================================================
  // UPLOAD (API key auth - requires full-access key)
  // ==========================================================================

  fastify.post(
    '/api/v1/sourcemaps',
    {
      config: {
        rateLimit: { max: 100, timeWindow: '1 minute' },
      },
    },
    async (request: any, reply) => {
      try {
        // API key auth is handled by authPlugin - request.projectId is set
        if (!request.projectId) {
          return reply.status(401).send({ error: 'API key required' });
        }

        const allowed = await requireFullAccess(request, reply);
        if (!allowed) return;

        // Get organization_id from project
        const project = await db
          .selectFrom('projects')
          .select(['organization_id'])
          .where('id', '=', request.projectId)
          .executeTakeFirst();

        if (!project) {
          return reply.status(404).send({ error: 'Project not found' });
        }

        const data = await request.file();
        if (!data) {
          return reply.status(400).send({ error: 'No file uploaded' });
        }

        // Extract fields from multipart
        const fields: Record<string, string> = {};
        for (const [key, field] of Object.entries(data.fields)) {
          if (field && typeof field === 'object' && 'value' in field) {
            fields[key] = (field as any).value;
          }
        }

        const release = fields.release;
        const fileName = fields.fileName;

        if (!release || !fileName) {
          return reply.status(400).send({
            error: 'Missing required fields: release, fileName',
          });
        }

        if (!fileName.endsWith('.map')) {
          return reply.status(400).send({
            error: 'File name must end with .map',
          });
        }

        const content = await data.toBuffer();

        const record = await sourceMapsService.storeMap({
          projectId: request.projectId,
          organizationId: project.organization_id,
          release,
          fileName,
          content,
        });

        return reply.status(201).send({
          id: record.id,
          release: record.release,
          fileName: record.fileName,
          fileSize: record.fileSize,
          uploadedAt: record.uploadedAt,
        });
      } catch (error: any) {
        if (error.message?.includes('Invalid file name')) {
          return reply.status(400).send({ error: error.message });
        }
        console.error('Error uploading source map:', error);
        return reply.status(500).send({
          error: 'Failed to upload source map',
          details: error.message,
        });
      }
    }
  );

  // ==========================================================================
  // LIST (session auth)
  // ==========================================================================

  fastify.get(
    '/api/v1/sourcemaps',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        querystring: {
          type: 'object',
          required: ['organizationId', 'projectId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            release: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      // Skip if this is an API key request (handled by upload route)
      if (request.projectId && !request.user) {
        return reply.status(401).send({ error: 'Session auth required for this endpoint' });
      }

      await authenticate(request, reply);
      if (!request.user) return;

      try {
        const schema = z.object({
          organizationId: z.string().guid(),
          projectId: z.string().guid(),
          release: z.string().optional(),
        });

        const query = schema.parse(request.query);

        const isMember = await checkOrgMembership(request.user.id, query.organizationId);
        if (!isMember) {
          return reply.status(403).send({ error: 'Not a member of this organization' });
        }

        // The projectId is untrusted - listMaps only filters by projectId, so
        // without this check a member of one org could list another tenant's
        // source maps by supplying a known foreign projectId.
        if (!(await projectsService.projectBelongsToOrg(query.projectId, query.organizationId))) {
          return reply.status(403).send({ error: 'Project does not belong to this organization' });
        }

        const maps = await sourceMapsService.listMaps(query.projectId, query.release);

        return reply.send({ sourcemaps: maps });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        console.error('Error listing source maps:', error);
        return reply.status(500).send({ error: 'Failed to list source maps' });
      }
    }
  );

  // ==========================================================================
  // DELETE (session auth)
  // ==========================================================================

  fastify.delete(
    '/api/v1/sourcemaps/:release',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        params: {
          type: 'object',
          required: ['release'],
          properties: {
            release: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          required: ['organizationId', 'projectId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: any, reply) => {
      await authenticate(request, reply);
      if (!request.user) return;

      try {
        const paramsSchema = z.object({ release: z.string().min(1) });
        const querySchema = z.object({
          organizationId: z.string().guid(),
          projectId: z.string().guid(),
        });

        const params = paramsSchema.parse(request.params);
        const query = querySchema.parse(request.query);

        const isMember = await checkOrgMembership(request.user.id, query.organizationId);
        if (!isMember) {
          return reply.status(403).send({ error: 'Not a member of this organization' });
        }

        // The projectId is untrusted - deleteMaps only filters by projectId, so
        // without this check a member of one org could delete another tenant's
        // source maps by supplying a known foreign projectId.
        if (!(await projectsService.projectBelongsToOrg(query.projectId, query.organizationId))) {
          return reply.status(403).send({ error: 'Project does not belong to this organization' });
        }

        const deleted = await sourceMapsService.deleteMaps(query.projectId, params.release);

        return reply.send({ deleted });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        console.error('Error deleting source maps:', error);
        return reply.status(500).send({ error: 'Failed to delete source maps' });
      }
    }
  );
}
