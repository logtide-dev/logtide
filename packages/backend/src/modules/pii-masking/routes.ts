/**
 * PII Masking Rule Management API Routes
 *
 * GET    /v1/pii-masking/rules      - List rules (built-in + custom)
 * POST   /v1/pii-masking/rules      - Create custom rule
 * PUT    /v1/pii-masking/rules/:id  - Update rule
 * DELETE /v1/pii-masking/rules/:id  - Delete custom rule
 * POST   /v1/pii-masking/test       - Test masking on sample data
 */

import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { piiMaskingService } from './service.js';
import { auditLogService } from '../audit-log/service.js';
import type { PiiAction, PiiPatternType } from '../../database/types.js';

const organizationsService = new OrganizationsService();

interface RuleParams {
  id: string;
}

interface CreateRuleBody {
  name: string;
  displayName: string;
  description?: string;
  patternType: PiiPatternType;
  regexPattern?: string;
  fieldNames?: string[];
  action: PiiAction;
  enabled?: boolean;
  priority?: number;
  projectId?: string;
}

interface UpdateRuleBody {
  displayName?: string;
  description?: string;
  regexPattern?: string;
  fieldNames?: string[];
  action?: PiiAction;
  enabled?: boolean;
  priority?: number;
}

interface TestMaskingBody {
  message?: string;
  metadata?: Record<string, unknown>;
  projectId?: string;
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getUserOrganizationId(userId: string, requestedOrgId?: string): Promise<string | null> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  if (organizations.length === 0) return null;

  if (requestedOrgId) {
    if (!uuidRegex.test(requestedOrgId)) return null;
    const org = organizations.find((o) => o.id === requestedOrgId);
    return org ? org.id : null;
  }

  return organizations[0].id;
}

export default async function piiMaskingRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // List rules
  fastify.get<{
    Querystring: { organizationId?: string; projectId?: string };
  }>(
    '/v1/pii-masking/rules',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            organizationId: { type: 'string' },
            projectId: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const organizationId = await getUserOrganizationId(
        request.user.id,
        request.query.organizationId
      );

      if (!organizationId) {
        return reply.status(403).send({ success: false, error: 'No organization access' });
      }

      try {
        const rules = await piiMaskingService.getRulesForOrg(
          organizationId,
          request.query.projectId
        );

        return reply.send({ success: true, data: rules });
      } catch (error) {
        console.error('[PiiMasking] Error listing rules:', error);
        return reply.status(500).send({ success: false, error: 'Failed to list rules' });
      }
    }
  );

  // Create rule
  fastify.post<{
    Body: CreateRuleBody;
    Querystring: { organizationId?: string };
  }>(
    '/v1/pii-masking/rules',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'displayName', 'patternType', 'action'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            displayName: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            patternType: { type: 'string', enum: ['builtin', 'field_name', 'custom'] },
            regexPattern: { type: 'string', maxLength: 500 },
            fieldNames: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            action: { type: 'string', enum: ['mask', 'redact', 'hash'] },
            enabled: { type: 'boolean', default: true },
            priority: { type: 'number', minimum: 1, maximum: 1000, default: 50 },
            projectId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            organizationId: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const organizationId = await getUserOrganizationId(
        request.user.id,
        request.query.organizationId
      );

      if (!organizationId) {
        return reply.status(403).send({ success: false, error: 'No organization access' });
      }
      if (!(await organizationsService.isOwnerOrAdmin(organizationId, request.user.id))) {
        return reply.status(403).send({
          success: false,
          error: 'Only organization owners and admins can change PII masking rules',
        });
      }

      try {
        const rule = await piiMaskingService.createRule(organizationId, {
          name: request.body.name,
          displayName: request.body.displayName,
          description: request.body.description,
          patternType: request.body.patternType,
          regexPattern: request.body.regexPattern,
          fieldNames: request.body.fieldNames,
          action: request.body.action,
          enabled: request.body.enabled,
          priority: request.body.priority,
          projectId: request.body.projectId,
        });

        await auditLogService.record({
          action: 'rule.created',
          target: { type: 'pii_masking_rule', id: rule.id },
          organizationId,
          metadata: { name: request.body.name, action: request.body.action },
        });

        return reply.status(201).send({ success: true, data: rule });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to create rule';
        if (msg === 'Project not found in this organization') {
          return reply.status(400).send({ success: false, error: msg });
        }
        if (msg.includes('unique') || msg.includes('duplicate')) {
          return reply.status(409).send({ success: false, error: 'A rule with this name already exists' });
        }
        console.error('[PiiMasking] Error creating rule:', error);
        return reply.status(400).send({ success: false, error: msg });
      }
    }
  );

  // Update rule
  fastify.put<{
    Params: RuleParams;
    Body: UpdateRuleBody;
    Querystring: { organizationId?: string };
  }>(
    '/v1/pii-masking/rules/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            regexPattern: { type: 'string', maxLength: 500 },
            fieldNames: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            action: { type: 'string', enum: ['mask', 'redact', 'hash'] },
            enabled: { type: 'boolean' },
            priority: { type: 'number', minimum: 1, maximum: 1000 },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            organizationId: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const organizationId = await getUserOrganizationId(
        request.user.id,
        request.query.organizationId
      );

      if (!organizationId) {
        return reply.status(403).send({ success: false, error: 'No organization access' });
      }
      if (!(await organizationsService.isOwnerOrAdmin(organizationId, request.user.id))) {
        return reply.status(403).send({
          success: false,
          error: 'Only organization owners and admins can change PII masking rules',
        });
      }

      try {
        const rule = await piiMaskingService.updateRule(
          request.params.id,
          organizationId,
          request.body
        );

        const piiAction = request.body.enabled === true ? 'rule.enabled' as const : request.body.enabled === false ? 'rule.disabled' as const : 'rule.updated' as const;
        await auditLogService.record({
          action: piiAction,
          target: { type: 'pii_masking_rule', id: request.params.id },
          organizationId,
          metadata: request.body,
        });

        return reply.send({ success: true, data: rule });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to update rule';
        console.error('[PiiMasking] Error updating rule:', error);
        return reply.status(400).send({ success: false, error: msg });
      }
    }
  );

  // Delete rule
  fastify.delete<{
    Params: RuleParams;
    Querystring: { organizationId?: string };
  }>(
    '/v1/pii-masking/rules/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          properties: {
            organizationId: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const organizationId = await getUserOrganizationId(
        request.user.id,
        request.query.organizationId
      );

      if (!organizationId) {
        return reply.status(403).send({ success: false, error: 'No organization access' });
      }
      if (!(await organizationsService.isOwnerOrAdmin(organizationId, request.user.id))) {
        return reply.status(403).send({
          success: false,
          error: 'Only organization owners and admins can change PII masking rules',
        });
      }

      try {
        await piiMaskingService.deleteRule(request.params.id, organizationId);

        await auditLogService.record({
          action: 'rule.deleted',
          target: { type: 'pii_masking_rule', id: request.params.id },
          organizationId,
        });

        return reply.send({ success: true, message: 'Rule deleted' });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to delete rule';
        if (msg === 'Rule not found') {
          return reply.status(404).send({ success: false, error: msg });
        }
        console.error('[PiiMasking] Error deleting rule:', error);
        return reply.status(500).send({ success: false, error: msg });
      }
    }
  );

  // Test masking
  fastify.post<{
    Body: TestMaskingBody;
    Querystring: { organizationId?: string };
  }>(
    '/v1/pii-masking/test',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            message: { type: 'string', maxLength: 10000 },
            metadata: { type: 'object' },
            projectId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            organizationId: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const organizationId = await getUserOrganizationId(
        request.user.id,
        request.query.organizationId
      );

      if (!organizationId) {
        return reply.status(403).send({ success: false, error: 'No organization access' });
      }

      try {
        const result = await piiMaskingService.testMasking(
          organizationId,
          request.body.projectId,
          {
            message: request.body.message,
            metadata: request.body.metadata,
          }
        );

        return reply.send({ success: true, data: result });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to test masking';
        console.error('[PiiMasking] Error testing masking:', error);
        return reply.status(500).send({ success: false, error: msg });
      }
    }
  );
}
