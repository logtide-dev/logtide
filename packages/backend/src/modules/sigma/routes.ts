import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SigmaService } from './service.js';
import { sigmaSyncService } from './sync-service.js';
import { MITREMapper } from './mitre-mapper.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { notificationChannelsService } from '../notification-channels/index.js';
import { auditLogService } from '../audit-log/service.js';
import { context } from '@logtide/shared/context';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { CapabilityError } from '../../capabilities/errors.js';

const sigmaService = new SigmaService();
const organizationsService = new OrganizationsService();

/**
 * Check if user is member of organization
 */
async function checkOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}

/**
 * Sigma Rules API Routes
 */
export async function sigmaRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);
  /**
   * POST /api/v1/sigma/import
   * Import a Sigma rule from YAML
   */
  fastify.post(
    '/api/v1/sigma/import',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['yaml', 'organizationId'],
          properties: {
            yaml: { type: 'string' },
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            emailRecipients: {
              type: 'array',
              items: { type: 'string', format: 'email' },
            },
            webhookUrl: { type: 'string', format: 'uri' },
            channelIds: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
            },
            createAlertRule: { type: 'boolean', default: true },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          yaml: z.string().min(1),
          organizationId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          emailRecipients: z.array(z.string().email()).optional(),
          webhookUrl: z.string().url().optional(),
          channelIds: z.array(z.string().uuid()).optional(),
          createAlertRule: z.boolean().optional().default(true),
        });

        const body = schema.parse(request.body);
        const { channelIds, ...importData } = body;

        // Verify user is member of organization
        const isMember = await checkOrganizationMembership(
          request.user.id,
          body.organizationId
        );

        if (!isMember) {
          return reply.code(403).send({
            error: 'User is not a member of this organization',
          });
        }

        // Cap on enabled sigma rules (#214 follow-up, WS2). Serialize the
        // count + import per org so concurrent imports can't race past the cap.
        const result = await withLimitLock(body.organizationId, 'sigma.max_active_rules', async () => {
          await context.runAsSystem('sigma:import-limit-check', async () => {
            await context.with({ organizationId: body.organizationId }, async () => {
              const activeCount = await sigmaService.countActiveRules(body.organizationId);
              await assertWithinLimit('sigma.max_active_rules', activeCount);
            });
          });

          return sigmaService.importSigmaRule(importData);
        });

        // Associate channels with the sigma rule if import was successful
        if (result.sigmaRule && channelIds && channelIds.length > 0) {
          await notificationChannelsService.setSigmaRuleChannels(result.sigmaRule.id, channelIds, body.organizationId);
        }

        if (result.errors.length > 0) {
          return reply.code(400).send(result);
        }

        await auditLogService.record({
          action: 'rule.imported',
          target: { type: 'sigma_rule', id: result.sigmaRule?.id ?? null },
          organizationId: body.organizationId,
          metadata: { title: result.sigmaRule?.title },
        });

        return reply.send(result);
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

        console.error('[Sigma Import] Error:', error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /api/v1/sigma/rules
   * List Sigma rules for an organization
   */
  fastify.get(
    '/api/v1/sigma/rules',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const schema = z.object({
        organizationId: z.string().uuid(),
      });

      const query = schema.parse(request.query);

      // Verify user is member of organization
      const isMember = await checkOrganizationMembership(
        request.user.id,
        query.organizationId
      );

      if (!isMember) {
        return reply.code(403).send({
          error: 'User is not a member of this organization',
        });
      }

      const rules = await sigmaService.getSigmaRules(query.organizationId);

      return reply.send({ rules });
    }
  );

  /**
   * GET /api/v1/sigma/rules/:id
   * Get a specific Sigma rule
   */
  fastify.get(
    '/api/v1/sigma/rules/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          403: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: any, reply) => {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const querySchema = z.object({
        organizationId: z.string().uuid(),
      });

      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);

      // Verify user is member of organization
      const isMember = await checkOrganizationMembership(
        request.user.id,
        query.organizationId
      );

      if (!isMember) {
        return reply.code(403).send({
          error: 'User is not a member of this organization',
        });
      }

      const rule = await sigmaService.getSigmaRuleById(
        params.id,
        query.organizationId
      );

      if (!rule) {
        return reply.code(404).send({ error: 'Sigma rule not found' });
      }

      return reply.send({ rule });
    }
  );

  /**
   * PATCH /api/v1/sigma/rules/:id
   * Update a Sigma rule (enable/disable, channels)
   */
  fastify.patch(
    '/api/v1/sigma/rules/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            enabled: { type: 'boolean' },
            channelIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
        },
      },
    },
    async (request: any, reply) => {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const bodySchema = z.object({
        organizationId: z.string().uuid(),
        enabled: z.boolean().optional(),
        channelIds: z.array(z.string().uuid()).optional(),
      });

      const params = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);

      // Verify user is member of organization
      const isMember = await checkOrganizationMembership(
        request.user.id,
        body.organizationId
      );

      if (!isMember) {
        return reply.code(403).send({
          error: 'User is not a member of this organization',
        });
      }

      let rule = null;

      // Update enabled status if provided
      if (body.enabled !== undefined) {
        if (body.enabled === true) {
          // Pre-fetch current state to avoid false positives on already-enabled rules
          const existingRule = await sigmaService.getRuleEnabledState(
            params.id,
            body.organizationId
          );
          if (!existingRule) {
            return reply.code(404).send({ error: 'Sigma rule not found' });
          }
          // Cap on enabled sigma rules - only check when actually transitioning
          // disabled -> enabled. Serialize the count + enable per org so two
          // concurrent enables can't race past the cap.
          if (!existingRule.enabled) {
            rule = await withLimitLock(body.organizationId, 'sigma.max_active_rules', async () => {
              await context.runAsSystem('sigma:enable-limit-check', async () => {
                await context.with({ organizationId: body.organizationId }, async () => {
                  const activeCount = await sigmaService.countActiveRules(body.organizationId);
                  await assertWithinLimit('sigma.max_active_rules', activeCount);
                });
              });
              // Inside the `body.enabled === true` branch: enable explicitly.
              return sigmaService.toggleSigmaRule(params.id, body.organizationId, true);
            });
          }
        }

        // For non-enable-transition cases (disable, or already enabled) toggle now.
        if (!rule) {
          rule = await sigmaService.toggleSigmaRule(
            params.id,
            body.organizationId,
            body.enabled
          );
        }

        if (!rule) {
          return reply.code(404).send({ error: 'Sigma rule not found' });
        }
      }

      // Update channels if provided
      if (body.channelIds !== undefined) {
        // Verify the rule exists if we haven't already fetched it
        if (!rule) {
          rule = await sigmaService.getSigmaRuleById(params.id, body.organizationId);
          if (!rule) {
            return reply.code(404).send({ error: 'Sigma rule not found' });
          }
        }
        await notificationChannelsService.setSigmaRuleChannels(params.id, body.channelIds, body.organizationId);
      }

      if (body.enabled === undefined && body.channelIds === undefined) {
        return reply.code(400).send({ error: 'No update fields provided' });
      }

      // Fetch updated rule to return
      const updatedRule = await sigmaService.getSigmaRuleById(params.id, body.organizationId);

      const sigmaAction = body.enabled === true ? 'rule.enabled' as const : body.enabled === false ? 'rule.disabled' as const : 'rule.updated' as const;
      await auditLogService.record({
        action: sigmaAction,
        target: { type: 'sigma_rule', id: params.id },
        organizationId: body.organizationId,
        metadata: { enabled: body.enabled, channelIds: body.channelIds },
      });

      return reply.send({ rule: updatedRule });
    }
  );

  /**
   * DELETE /api/v1/sigma/rules/:id
   * Delete a Sigma rule (and optionally its alert rule)
   */
  fastify.delete(
    '/api/v1/sigma/rules/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            deleteAlertRule: { type: 'boolean', default: false },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
          403: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: any, reply) => {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const querySchema = z.object({
        organizationId: z.string().uuid(),
        deleteAlertRule: z.boolean().optional().default(false),
      });

      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);

      // Verify user is member of organization
      const isMember = await checkOrganizationMembership(
        request.user.id,
        query.organizationId
      );

      if (!isMember) {
        return reply.code(403).send({
          error: 'User is not a member of this organization',
        });
      }

      try {
        await sigmaService.deleteSigmaRule(
          params.id,
          query.organizationId,
          query.deleteAlertRule
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'Sigma rule not found') {
          return reply.code(404).send({ error: 'Sigma rule not found' });
        }
        throw error;
      }

      await auditLogService.record({
        action: 'rule.deleted',
        target: { type: 'sigma_rule', id: params.id },
        organizationId: query.organizationId,
      });

      return reply.send({ success: true });
    }
  );

  /**
   * POST /api/v1/sigma/sync
   * Sync rules from SigmaHQ repository (granular selection)
   */
  fastify.post(
    '/api/v1/sigma/sync',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            // Legacy: single category (deprecated)
            category: { type: 'string' },
            // New: granular selection (categories + individual rules)
            selection: {
              type: 'object',
              properties: {
                categories: {
                  type: 'array',
                  items: { type: 'string' },
                },
                rules: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            limit: { type: 'number', minimum: 1, maximum: 1000 },
            autoCreateAlerts: { type: 'boolean', default: false },
            emailRecipients: {
              type: 'array',
              items: { type: 'string', format: 'email' },
            },
            webhookUrl: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          category: z.string().optional(), // Legacy
          selection: z
            .object({
              categories: z.array(z.string()).optional().default([]),
              rules: z.array(z.string()).optional().default([]),
            })
            .optional(),
          limit: z.number().min(1).max(1000).optional(),
          autoCreateAlerts: z.boolean().optional().default(false),
          emailRecipients: z.array(z.string().email()).optional(),
          webhookUrl: z.string().url().optional(),
        });

        const body = schema.parse(request.body);

        // Verify user is member of organization
        const isMember = await checkOrganizationMembership(
          request.user.id,
          body.organizationId
        );

        if (!isMember) {
          return reply.code(403).send({
            error: 'User is not a member of this organization',
          });
        }

        console.log(`[Sigma Sync API] Starting sync for organization ${body.organizationId}`);

        const result = await sigmaSyncService.syncFromSigmaHQ(body);

        return reply.send(result);
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

        console.error('[Sigma Sync API] Error:', error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /api/v1/sigma/tree
   * Get hierarchical category tree (for tree-multiselect)
   */
  fastify.get(
    '/api/v1/sigma/tree',
    async (_request: any, reply) => {
      try {
        const { sigmahqClient } = await import('./github-client.js');
        const tree = await sigmahqClient.buildCategoryTree();
        return reply.send({ tree });
      } catch (error) {
        console.error('[Sigma Tree API] Error:', error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Failed to fetch category tree',
        });
      }
    }
  );

  /**
   * GET /api/v1/sigma/categories/:path/rules
   * Get rules for a specific category (lazy loading)
   */
  fastify.get(
    '/api/v1/sigma/categories/:path/rules',
    {
      schema: {
        params: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            includeMetadata: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const paramsSchema = z.object({
          path: z.string(),
        });

        const querySchema = z.object({
          includeMetadata: z.boolean().optional().default(false),
        });

        const params = paramsSchema.parse(request.params);
        const query = querySchema.parse(request.query);

        const { sigmahqClient } = await import('./github-client.js');
        const rules = await sigmahqClient.getRulesForCategory(
          params.path,
          query.includeMetadata
        );

        return reply.send({ rules });
      } catch (error) {
        console.error('[Sigma Category Rules API] Error:', error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Failed to fetch category rules',
        });
      }
    }
  );

  /**
   * GET /api/v1/sigma/search
   * Search rules by query
   */
  fastify.get(
    '/api/v1/sigma/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 2 },
            category: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          q: z.string().min(2),
          category: z.string().optional(),
        });

        const query = schema.parse(request.query);

        const { sigmahqClient } = await import('./github-client.js');
        const results = await sigmahqClient.searchRules(query.q, query.category);

        return reply.send({ results });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }

        console.error('[Sigma Search API] Error:', error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Search failed',
        });
      }
    }
  );

  /**
   * GET /api/v1/sigma/categories
   * Get available SigmaHQ categories (flat list - legacy)
   */
  fastify.get(
    '/api/v1/sigma/categories',
    async (_request: any, reply) => {
      try {
        const categories = await sigmaSyncService.getCategories();
        return reply.send({ categories });
      } catch (error) {
        console.error('[Sigma Categories API] Error:', error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Failed to fetch categories',
        });
      }
    }
  );

  /**
   * GET /api/v1/sigma/sync/status
   * Get sync status for an organization
   */
  fastify.get(
    '/api/v1/sigma/sync/status',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const schema = z.object({
        organizationId: z.string().uuid(),
      });

      const query = schema.parse(request.query);

      // Verify user is member of organization
      const isMember = await checkOrganizationMembership(
        request.user.id,
        query.organizationId
      );

      if (!isMember) {
        return reply.code(403).send({
          error: 'User is not a member of this organization',
        });
      }

      const status = await sigmaSyncService.getSyncStatus(query.organizationId);
      return reply.send(status);
    }
  );

  /**
   * GET /api/v1/sigma/mitre/techniques/:technique
   * Search rules by MITRE technique
   */
  fastify.get(
    '/api/v1/sigma/mitre/techniques/:technique',
    {
      schema: {
        params: {
          type: 'object',
          required: ['technique'],
          properties: {
            technique: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const paramsSchema = z.object({
        technique: z.string(),
      });

      const querySchema = z.object({
        organizationId: z.string().uuid(),
      });

      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);

      // Verify user is member of organization
      const isMember = await checkOrganizationMembership(
        request.user.id,
        query.organizationId
      );

      if (!isMember) {
        return reply.code(403).send({
          error: 'User is not a member of this organization',
        });
      }

      const rules = await sigmaSyncService.searchByMITRETechnique(
        query.organizationId,
        params.technique.toUpperCase()
      );

      // Transform to camelCase
      const transformedRules = rules.map((rule) => ({
        id: rule.id,
        organizationId: rule.organization_id,
        projectId: rule.project_id,
        sigmaId: rule.sigma_id,
        title: rule.title,
        description: rule.description,
        author: rule.author,
        date: rule.date,
        level: rule.level,
        status: rule.status,
        logsource: rule.logsource,
        detection: rule.detection,
        alertRuleId: rule.alert_rule_id,
        conversionStatus: rule.conversion_status,
        conversionNotes: rule.conversion_notes,
        tags: rule.tags,
        mitreTactics: rule.mitre_tactics,
        mitreTechniques: rule.mitre_techniques,
        sigmahqPath: rule.sigmahq_path,
        sigmahqCommit: rule.sigmahq_commit,
        lastSyncedAt: rule.last_synced_at,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at,
      }));

      return reply.send({ rules: transformedRules });
    }
  );

  /**
   * GET /api/v1/sigma/mitre/tactics/:tactic
   * Search rules by MITRE tactic
   */
  fastify.get(
    '/api/v1/sigma/mitre/tactics/:tactic',
    {
      schema: {
        params: {
          type: 'object',
          required: ['tactic'],
          properties: {
            tactic: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: any, reply) => {
      const paramsSchema = z.object({
        tactic: z.string(),
      });

      const querySchema = z.object({
        organizationId: z.string().uuid(),
      });

      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);

      // Verify user is member of organization
      const isMember = await checkOrganizationMembership(
        request.user.id,
        query.organizationId
      );

      if (!isMember) {
        return reply.code(403).send({
          error: 'User is not a member of this organization',
        });
      }

      const rules = await sigmaSyncService.searchByMITRETactic(
        query.organizationId,
        params.tactic.toLowerCase()
      );

      // Transform to camelCase
      const transformedRules = rules.map((rule) => ({
        id: rule.id,
        organizationId: rule.organization_id,
        projectId: rule.project_id,
        sigmaId: rule.sigma_id,
        title: rule.title,
        description: rule.description,
        author: rule.author,
        date: rule.date,
        level: rule.level,
        status: rule.status,
        logsource: rule.logsource,
        detection: rule.detection,
        alertRuleId: rule.alert_rule_id,
        conversionStatus: rule.conversion_status,
        conversionNotes: rule.conversion_notes,
        tags: rule.tags,
        mitreTactics: rule.mitre_tactics,
        mitreTechniques: rule.mitre_techniques,
        sigmahqPath: rule.sigmahq_path,
        sigmahqCommit: rule.sigmahq_commit,
        lastSyncedAt: rule.last_synced_at,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at,
      }));

      return reply.send({ rules: transformedRules });
    }
  );

  /**
   * GET /api/v1/sigma/mitre/tactics
   * Get all MITRE tactics
   */
  fastify.get(
    '/api/v1/sigma/mitre/tactics',
    async (_request: any, reply) => {
      const tactics = MITREMapper.getAllTactics();
      return reply.send({ tactics });
    }
  );
}
