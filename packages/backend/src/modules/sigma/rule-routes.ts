import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createExceptionSchema, PREVIEW_RANGES } from '@logtide/shared';
import { context } from '@logtide/shared/context';
import { SigmaService } from './service.js';
import { sigmaExceptionsService } from './exceptions-service.js';
import { ruleManagementService } from './rule-management-service.js';
import { SigmaParser } from './parser.js';
import { SigmaConverter } from './converter.js';
import { YamlTooLargeError, assertYamlWithinLimit } from './yaml.js';
import { previewRule, loadPreviewTarget, resolvePreviewProjectIds } from './preview-service.js';
import { OrganizationsService } from '../organizations/service.js';
import { auditLogService } from '../audit-log/service.js';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';

const sigmaService = new SigmaService();
const organizationsService = new OrganizationsService();

async function isMember(userId: string, organizationId: string): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}

function auditActor(request: FastifyRequest) {
  const user = (request as any).user as { id: string; email?: string };
  return { type: 'user' as const, id: user.id, label: user.email ?? null };
}

const orgQuery = z.object({ organizationId: z.string().uuid() });
const ruleParams = z.object({ id: z.string().uuid() });
const exceptionParams = z.object({ id: z.string().uuid(), exceptionId: z.string().uuid() });
const createBody = createExceptionSchema.extend({ organizationId: z.string().uuid() });
const bulkBody = z.object({
  organizationId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['enable', 'disable', 'delete']),
});

const validateBody = z.object({ organizationId: z.string().uuid(), yaml: z.string().min(1) });
const matchesQuery = z.object({
  organizationId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  days: z.coerce.number().int().min(1).max(30).default(7),
});

const previewBody = z.object({
  organizationId: z.string().uuid(),
  range: z.enum(PREVIEW_RANGES),
  yaml: z.string().min(1).optional(),
});

// One preview at a time per organization (in process). Released in finally.
const runningPreviews = new Set<string>();

const BULK_AUDIT_ACTION = {
  enable: 'rule.enabled',
  disable: 'rule.disabled',
  delete: 'rule.deleted',
} as const;

/**
 * Detection rule management endpoints (exceptions, bulk, detail extras,
 * preview). Registered as an encapsulated child of `sigmaRoutes`, so it
 * inherits the `authenticate` hook.
 */
export async function sigmaRuleRoutes(fastify: FastifyInstance) {
  /** 403 reply when the caller is not a member, else null. */
  async function requireMember(request: any, reply: any, organizationId: string) {
    if (!(await isMember(request.user.id, organizationId))) {
      return reply.code(403).send({ error: 'User is not a member of this organization' });
    }
    return null;
  }

  async function ruleExists(ruleId: string, organizationId: string): Promise<boolean> {
    const rule = await sigmaService.getSigmaRuleById(ruleId, organizationId);
    return rule !== null && rule !== undefined;
  }

  // -------------------------------------------------------------------------
  // Bulk actions
  // -------------------------------------------------------------------------

  fastify.post(
    '/api/v1/sigma/rules/bulk',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      const body = bulkBody.parse(request.body);

      const denied = await requireMember(request, reply, body.organizationId);
      if (denied) return denied;

      // CapabilityError (enable over sigma.max_active_rules) propagates to the
      // global handler; nothing is changed in that case.
      const affected = await ruleManagementService.bulk(body.organizationId, body.ids, body.action);

      if (affected > 0) {
        await auditLogService.record({
          action: BULK_AUDIT_ACTION[body.action],
          target: { type: 'sigma_rule', id: null },
          organizationId: body.organizationId,
          actor: auditActor(request),
          metadata: { count: affected, bulk: true },
        });
      }

      return reply.send({ affected });
    }
  );

  // -------------------------------------------------------------------------
  // Validate and recent matches
  // -------------------------------------------------------------------------

  fastify.post(
    '/api/v1/sigma/validate',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      const body = validateBody.parse(request.body);

      const denied = await requireMember(request, reply, body.organizationId);
      if (denied) return denied;

      try {
        assertYamlWithinLimit(body.yaml);
      } catch (error) {
        if (error instanceof YamlTooLargeError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }

      const parsed = SigmaParser.parse(body.yaml);
      if (!parsed.rule) {
        return reply.send({ valid: false, errors: parsed.errors, warnings: [] });
      }

      const conversion = SigmaConverter.convert(parsed.rule, { organizationId: body.organizationId });
      return reply.send({
        valid: true,
        errors: [],
        warnings: conversion.warnings,
        summary: {
          title: parsed.rule.title,
          level: parsed.rule.level,
          status: parsed.rule.status,
          tags: parsed.rule.tags ?? [],
        },
      });
    }
  );

  fastify.get('/api/v1/sigma/rules/:id/matches', async (request: any, reply) => {
    const { id } = ruleParams.parse(request.params);
    const query = matchesQuery.parse(request.query);

    const denied = await requireMember(request, reply, query.organizationId);
    if (denied) return denied;

    if (!(await ruleExists(id, query.organizationId))) {
      return reply.code(404).send({ error: 'Sigma rule not found' });
    }

    const result = await ruleManagementService.listMatches({
      ruleId: id,
      organizationId: query.organizationId,
      limit: query.limit,
      offset: query.offset,
      days: query.days,
    });
    return reply.send(result);
  });

  // -------------------------------------------------------------------------
  // History preview
  // -------------------------------------------------------------------------

  fastify.post(
    '/api/v1/sigma/rules/:id/preview',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      const { id } = ruleParams.parse(request.params);
      const body = previewBody.parse(request.body);

      const denied = await requireMember(request, reply, body.organizationId);
      if (denied) return denied;

      const target = await loadPreviewTarget(id, body.organizationId);
      if (!target) {
        return reply.code(404).send({ error: 'Sigma rule not found' });
      }

      let rule = target.rule;
      if (body.yaml !== undefined) {
        try {
          assertYamlWithinLimit(body.yaml);
        } catch (error) {
          if (error instanceof YamlTooLargeError) {
            return reply.code(400).send({ error: error.message });
          }
          throw error;
        }
        const parsed = SigmaParser.parse(body.yaml);
        if (!parsed.rule) {
          return reply.code(400).send({ error: 'Invalid rule', errors: parsed.errors });
        }
        // Keep the stored id so exceptions of this rule still apply.
        rule = { ...parsed.rule, id };
      }

      if (runningPreviews.has(body.organizationId)) {
        return reply.code(429).send({ error: 'A preview is already running for this organization' });
      }
      runningPreviews.add(body.organizationId);
      try {
        const [projectIds, exceptions] = await Promise.all([
          resolvePreviewProjectIds(body.organizationId, target.projectId),
          sigmaExceptionsService.loadActiveForRules(body.organizationId, [id], new Date()),
        ]);
        const result = await previewRule({
          organizationId: body.organizationId,
          rule,
          projectIds,
          range: body.range,
          exceptions: exceptions.get(id) ?? [],
        });
        return reply.send(result);
      } finally {
        runningPreviews.delete(body.organizationId);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Exceptions
  // -------------------------------------------------------------------------

  fastify.get('/api/v1/sigma/rules/:id/exceptions', async (request: any, reply) => {
    const { id } = ruleParams.parse(request.params);
    const { organizationId } = orgQuery.parse(request.query);

    const denied = await requireMember(request, reply, organizationId);
    if (denied) return denied;

    if (!(await ruleExists(id, organizationId))) {
      return reply.code(404).send({ error: 'Sigma rule not found' });
    }

    const exceptions = await sigmaExceptionsService.list(id, organizationId);
    return reply.send({ exceptions });
  });

  fastify.post(
    '/api/v1/sigma/rules/:id/exceptions',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request: any, reply) => {
      const { id } = ruleParams.parse(request.params);
      const body = createBody.parse(request.body);

      const denied = await requireMember(request, reply, body.organizationId);
      if (denied) return denied;

      if (!(await ruleExists(id, body.organizationId))) {
        return reply.code(404).send({ error: 'Sigma rule not found' });
      }

      // CapabilityError from the limit check propagates to the global handler.
      // Serialize count + insert per org so concurrent creates cannot race
      // past the per-rule cap.
      const exception = await withLimitLock(
        body.organizationId,
        'sigma.exceptions.max_per_rule',
        async () => {
          await context.runAsSystem('sigma:exception-limit-check', async () => {
            await context.with({ organizationId: body.organizationId }, async () => {
              const count = await sigmaExceptionsService.countForRule(id, body.organizationId);
              await assertWithinLimit('sigma.exceptions.max_per_rule', count);
            });
          });

          return sigmaExceptionsService.create({
            ruleId: id,
            organizationId: body.organizationId,
            conditions: body.conditions,
            reason: body.reason,
            expiresAt: body.expiresAt,
            userId: request.user.id,
          });
        }
      );

      await auditLogService.record({
        action: 'rule.updated',
        target: { type: 'sigma_rule', id },
        organizationId: body.organizationId,
        actor: auditActor(request),
        metadata: { exception: 'added', exceptionId: exception.id },
      });

      return reply.code(201).send({ exception });
    }
  );

  fastify.delete('/api/v1/sigma/rules/:id/exceptions/:exceptionId', async (request: any, reply) => {
    const { id, exceptionId } = exceptionParams.parse(request.params);
    const { organizationId } = orgQuery.parse(request.query);

    const denied = await requireMember(request, reply, organizationId);
    if (denied) return denied;

    if (!(await ruleExists(id, organizationId))) {
      return reply.code(404).send({ error: 'Sigma rule not found' });
    }

    const removed = await sigmaExceptionsService.remove(exceptionId, id, organizationId);
    if (!removed) {
      return reply.code(404).send({ error: 'Exception not found' });
    }

    await auditLogService.record({
      action: 'rule.updated',
      target: { type: 'sigma_rule', id },
      organizationId,
      actor: auditActor(request),
      metadata: { exception: 'removed', exceptionId },
    });

    return reply.send({ success: true });
  });
}
