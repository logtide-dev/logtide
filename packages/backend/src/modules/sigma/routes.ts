import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SigmaService } from './service.js';
import { sigmaSyncService } from './sync-service.js';
import { MITREMapper } from './mitre-mapper.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';

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
          createAlertRule: z.boolean().optional().default(true),
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

        const result = await sigmaService.importSigmaRule(body);

        if (result.errors.length > 0) {
          return reply.code(400).send(result);
        }

        return reply.send(result);
      } catch (error) {
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
   * Update a Sigma rule (enable/disable)
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

      if (body.enabled !== undefined) {
        const rule = await sigmaService.toggleSigmaRule(
          params.id,
          body.organizationId,
          body.enabled
        );

        if (!rule) {
          return reply.code(404).send({ error: 'Sigma rule not found' });
        }

        return reply.send({ rule });
      }

      return reply.code(400).send({ error: 'No update fields provided' });
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

      await sigmaService.deleteSigmaRule(
        params.id,
        query.organizationId,
        query.deleteAlertRule
      );

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
