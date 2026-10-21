import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { pipelineService } from './service.js';
import { PipelineExecutor } from './pipeline-executor.js';
import { auditLogService } from '../audit-log/service.js';

const organizationsService = new OrganizationsService();

const stepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('parser'),
    parser: z.enum(['nginx', 'apache', 'syslog', 'logfmt', 'json']),
  }),
  z.object({
    type: z.literal('grok'),
    pattern: z.string().min(1),
    source: z.string().optional(),
  }),
  z.object({
    type: z.literal('geoip'),
    field: z.string().min(1),
    target: z.string().min(1),
  }),
]);

const createSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  steps: z.array(stepSchema),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  steps: z.array(stepSchema).optional(),
});

const previewSchema = z.object({
  organizationId: z.string().uuid(),
  steps: z.array(stepSchema),
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

const importYamlSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  yaml: z.string().min(1),
});

async function checkMembership(userId: string, orgId: string): Promise<boolean> {
  const orgs = await organizationsService.getUserOrganizations(userId);
  return orgs.some((o) => o.id === orgId);
}

export async function pipelineRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // List pipelines for org
  fastify.get('/', async (request: any, reply) => {
    const orgId = (request.query as any).organizationId as string;
    if (!orgId) return reply.status(400).send({ error: 'organizationId required' });
    if (!await checkMembership(request.user.id, orgId)) return reply.status(403).send({ error: 'Forbidden' });
    const pipelines = await pipelineService.listForOrg(orgId);
    return reply.send({ pipelines });
  });

  // Preview (before /:id routes to avoid conflict)
  fastify.post('/preview', async (request: any, reply) => {
    try {
      const orgIdFromQuery = (request.query as any).organizationId;
      const body = previewSchema.parse({ organizationId: orgIdFromQuery, ...request.body });
      if (!await checkMembership(request.user.id, body.organizationId)) return reply.status(403).send({ error: 'Forbidden' });
      const logEntry = { id: '', time: new Date(), message: body.message, metadata: body.metadata ?? null };
      const result = await PipelineExecutor.execute(logEntry, body.steps as any);
      return reply.send(result);
    } catch (e) {
      if (e instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: e.errors });
      throw e;
    }
  });

  // YAML import
  fastify.post('/import-yaml', async (request: any, reply) => {
    try {
      const orgIdFromQuery = (request.query as any).organizationId;
      const body = importYamlSchema.parse({ organizationId: orgIdFromQuery, ...request.body });
      if (!await checkMembership(request.user.id, body.organizationId)) return reply.status(403).send({ error: 'Forbidden' });
      if (!await organizationsService.isOwnerOrAdmin(body.organizationId, request.user.id)) return reply.status(403).send({ error: 'Only organization owners and admins can change log pipelines' });
      const pipeline = await pipelineService.importFromYaml(body.yaml, body.organizationId, body.projectId ?? null);
      await auditLogService.record({
        action: 'pipeline.imported',
        target: { type: 'log_pipeline', id: pipeline.id },
        organizationId: body.organizationId,
        metadata: { name: pipeline.name, projectId: pipeline.projectId ?? null },
      });
      return reply.status(201).send({ pipeline });
    } catch (e) {
      if (e instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: e.errors });
      if (e instanceof Error) return reply.status(400).send({ error: e.message });
      throw e;
    }
  });

  // Create pipeline
  fastify.post('/', async (request: any, reply) => {
    try {
      const orgIdFromQuery = (request.query as any).organizationId;
      const body = createSchema.parse({ organizationId: orgIdFromQuery, ...request.body });
      if (!await checkMembership(request.user.id, body.organizationId)) return reply.status(403).send({ error: 'Forbidden' });
      if (!await organizationsService.isOwnerOrAdmin(body.organizationId, request.user.id)) return reply.status(403).send({ error: 'Only organization owners and admins can change log pipelines' });
      const pipeline = await pipelineService.create(body as any);
      await auditLogService.record({
        action: 'pipeline.created',
        target: { type: 'log_pipeline', id: pipeline.id },
        organizationId: body.organizationId,
        metadata: { name: pipeline.name, projectId: pipeline.projectId ?? null },
      });
      return reply.status(201).send({ pipeline });
    } catch (e) {
      if (e instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: e.errors });
      if (e instanceof Error && e.message.includes('unique')) return reply.status(409).send({ error: 'A pipeline already exists for this project/org scope.' });
      throw e;
    }
  });

  // Get pipeline by ID
  fastify.get('/:id', async (request: any, reply) => {
    const orgId = (request.query as any).organizationId as string;
    if (!orgId) return reply.status(400).send({ error: 'organizationId required' });
    if (!await checkMembership(request.user.id, orgId)) return reply.status(403).send({ error: 'Forbidden' });
    const pipeline = await pipelineService.getById((request.params as any).id, orgId);
    if (!pipeline) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ pipeline });
  });

  // Update pipeline
  fastify.put('/:id', async (request: any, reply) => {
    try {
      const orgId = (request.query as any).organizationId as string;
      if (!orgId) return reply.status(400).send({ error: 'organizationId required' });
      if (!await checkMembership(request.user.id, orgId)) return reply.status(403).send({ error: 'Forbidden' });
      if (!await organizationsService.isOwnerOrAdmin(orgId, request.user.id)) return reply.status(403).send({ error: 'Only organization owners and admins can change log pipelines' });
      const body = updateSchema.parse(request.body);
      const pipeline = await pipelineService.update((request.params as any).id, orgId, body as any);
      await auditLogService.record({
        action: 'pipeline.updated',
        target: { type: 'log_pipeline', id: pipeline.id },
        organizationId: orgId,
        metadata: { name: pipeline.name, projectId: pipeline.projectId ?? null },
      });
      return reply.send({ pipeline });
    } catch (e) {
      if (e instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: e.errors });
      throw e;
    }
  });

  // Delete pipeline
  fastify.delete('/:id', async (request: any, reply) => {
    const orgId = (request.query as any).organizationId as string;
    if (!orgId) return reply.status(400).send({ error: 'organizationId required' });
    if (!await checkMembership(request.user.id, orgId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!await organizationsService.isOwnerOrAdmin(orgId, request.user.id)) return reply.status(403).send({ error: 'Only organization owners and admins can change log pipelines' });
    const pipelineId = (request.params as any).id as string;
    await pipelineService.delete(pipelineId, orgId);
    await auditLogService.record({
      action: 'pipeline.deleted',
      target: { type: 'log_pipeline', id: pipelineId },
      organizationId: orgId,
    });
    return reply.status(204).send();
  });
}
