/**
 * Identifier Pattern Management API Routes
 *
 * Endpoints for managing custom identifier patterns per organization:
 * - GET /v1/patterns - List all patterns for the organization
 * - GET /v1/patterns/defaults - Get default built-in patterns
 * - POST /v1/patterns - Create a new custom pattern
 * - PUT /v1/patterns/:id - Update a pattern
 * - DELETE /v1/patterns/:id - Delete a pattern
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../../database/index.js';
import { patternRegistry } from './pattern-registry.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import isSafeRegex from 'safe-regex2';

const organizationsService = new OrganizationsService();

interface PatternParams {
  id: string;
}

interface CreatePatternBody {
  name: string;
  displayName: string;
  description?: string;
  pattern: string;
  fieldNames?: string[];
  enabled?: boolean;
  priority?: number;
}

interface UpdatePatternBody {
  displayName?: string;
  description?: string;
  pattern?: string;
  fieldNames?: string[];
  enabled?: boolean;
  priority?: number;
}

/**
 * Validate regex pattern for syntax and ReDoS safety
 */
function isValidRegex(pattern: string): { valid: boolean; error?: string } {
  try {
    new RegExp(pattern);
  } catch {
    return { valid: false, error: 'Invalid regex syntax' };
  }

  // Check for ReDoS vulnerabilities (catastrophic backtracking)
  if (!isSafeRegex(pattern)) {
    return { valid: false, error: 'Regex pattern is vulnerable to ReDoS attacks' };
  }

  return { valid: true };
}

/**
 * Get organization ID from user's organizations
 */
async function getUserOrganizationId(userId: string, requestedOrgId?: string): Promise<string | null> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  if (organizations.length === 0) return null;

  // If a specific org is requested, verify user is a member
  if (requestedOrgId) {
    const org = organizations.find((o) => o.id === requestedOrgId);
    return org ? org.id : null;
  }

  // Default to first organization
  return organizations[0].id;
}

export default async function patternRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Get all patterns for the organization (custom + defaults)
  fastify.get<{
    Querystring: { organizationId?: string };
  }>(
    '/v1/patterns',
    {
      schema: {
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
        return reply.status(403).send({
          success: false,
          error: 'No organization access',
        });
      }

      try {
        // Get custom patterns from DB
        const customPatterns = await db
          .selectFrom('identifier_patterns')
          .selectAll()
          .where('organization_id', '=', organizationId)
          .orderBy('priority', 'asc')
          .execute();

        // Get default patterns
        const defaultPatterns = patternRegistry.getDefaultPatterns();

        return reply.send({
          success: true,
          data: {
            custom: customPatterns.map((p) => ({
              id: p.id,
              name: p.name,
              displayName: p.display_name,
              description: p.description,
              pattern: p.pattern,
              fieldNames: p.field_names || [],
              enabled: p.enabled,
              priority: p.priority,
              isBuiltIn: false,
              createdAt: p.created_at,
              updatedAt: p.updated_at,
            })),
            defaults: defaultPatterns.map((p) => ({
              name: p.type,
              displayName: p.displayName,
              pattern: p.pattern.source,
              fieldNames: p.fieldNames,
              priority: p.priority,
              isBuiltIn: true,
            })),
          },
        });
      } catch (error) {
        console.error('[Patterns] Error listing patterns:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to list patterns',
        });
      }
    }
  );

  // Get default patterns only
  fastify.get('/v1/patterns/defaults', async (_request, reply) => {
    try {
      const defaultPatterns = patternRegistry.getDefaultPatterns();

      return reply.send({
        success: true,
        data: defaultPatterns.map((p) => ({
          name: p.type,
          displayName: p.displayName,
          pattern: p.pattern.source,
          fieldNames: p.fieldNames,
          priority: p.priority,
          isBuiltIn: true,
        })),
      });
    } catch (error) {
      console.error('[Patterns] Error getting defaults:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to get default patterns',
      });
    }
  });

  // Create a new custom pattern
  fastify.post<{
    Body: CreatePatternBody;
    Querystring: { organizationId?: string };
  }>(
    '/v1/patterns',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'displayName', 'pattern'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[a-z][a-z0-9_]*$' },
            displayName: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            pattern: { type: 'string', minLength: 1, maxLength: 1000 },
            fieldNames: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            enabled: { type: 'boolean', default: true },
            priority: { type: 'number', minimum: 1, maximum: 1000, default: 50 },
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
        return reply.status(403).send({
          success: false,
          error: 'No organization access',
        });
      }

      const { name, displayName, description, pattern, fieldNames, enabled, priority } =
        request.body;

      // Validate regex pattern
      const regexValidation = isValidRegex(pattern);
      if (!regexValidation.valid) {
        return reply.status(400).send({
          success: false,
          error: regexValidation.error || 'Invalid regex pattern',
        });
      }

      try {
        // Check if pattern name already exists for this org
        const existing = await db
          .selectFrom('identifier_patterns')
          .select(['id'])
          .where('organization_id', '=', organizationId)
          .where('name', '=', name)
          .executeTakeFirst();

        if (existing) {
          return reply.status(409).send({
            success: false,
            error: 'A pattern with this name already exists',
          });
        }

        // Insert new pattern
        const newPattern = await db
          .insertInto('identifier_patterns')
          .values({
            organization_id: organizationId,
            name,
            display_name: displayName,
            description: description || null,
            pattern,
            field_names: fieldNames || [],
            enabled: enabled ?? true,
            priority: priority ?? 50,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        // Invalidate cache for this organization
        patternRegistry.invalidateCache(organizationId);

        return reply.status(201).send({
          success: true,
          data: {
            id: newPattern.id,
            name: newPattern.name,
            displayName: newPattern.display_name,
            description: newPattern.description,
            pattern: newPattern.pattern,
            fieldNames: newPattern.field_names || [],
            enabled: newPattern.enabled,
            priority: newPattern.priority,
            isBuiltIn: false,
            createdAt: newPattern.created_at,
            updatedAt: newPattern.updated_at,
          },
        });
      } catch (error) {
        console.error('[Patterns] Error creating pattern:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to create pattern',
        });
      }
    }
  );

  // Update a pattern
  fastify.put<{
    Params: PatternParams;
    Body: UpdatePatternBody;
    Querystring: { organizationId?: string };
  }>(
    '/v1/patterns/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            pattern: { type: 'string', minLength: 1, maxLength: 1000 },
            fieldNames: { type: 'array', items: { type: 'string' }, maxItems: 20 },
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
    async (request, reply) => {
      const { id } = request.params;
      const organizationId = (request as any).organizationId || request.query.organizationId;

      if (!organizationId) {
        return reply.status(400).send({
          success: false,
          error: 'Organization ID is required',
        });
      }

      // Get existing pattern
      const existing = await db
        .selectFrom('identifier_patterns')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst();

      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: 'Pattern not found',
        });
      }

      const { displayName, description, pattern, fieldNames, enabled, priority } = request.body;

      // Validate regex pattern if provided
      if (pattern) {
        const regexValidation = isValidRegex(pattern);
        if (!regexValidation.valid) {
          return reply.status(400).send({
            success: false,
            error: regexValidation.error || 'Invalid regex pattern',
          });
        }
      }

      try {
        // Build update object
        const updates: Record<string, unknown> = {
          updated_at: new Date(),
        };
        if (displayName !== undefined) updates.display_name = displayName;
        if (description !== undefined) updates.description = description || null;
        if (pattern !== undefined) updates.pattern = pattern;
        if (fieldNames !== undefined) updates.field_names = fieldNames;
        if (enabled !== undefined) updates.enabled = enabled;
        if (priority !== undefined) updates.priority = priority;

        const updated = await db
          .updateTable('identifier_patterns')
          .set(updates)
          .where('id', '=', id)
          .where('organization_id', '=', organizationId)
          .returningAll()
          .executeTakeFirstOrThrow();

        // Invalidate cache for this organization
        patternRegistry.invalidateCache(organizationId);

        return reply.send({
          success: true,
          data: {
            id: updated.id,
            name: updated.name,
            displayName: updated.display_name,
            description: updated.description,
            pattern: updated.pattern,
            fieldNames: updated.field_names || [],
            enabled: updated.enabled,
            priority: updated.priority,
            isBuiltIn: false,
            createdAt: updated.created_at,
            updatedAt: updated.updated_at,
          },
        });
      } catch (error) {
        console.error('[Patterns] Error updating pattern:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to update pattern',
        });
      }
    }
  );

  // Delete a pattern
  fastify.delete<{
    Params: PatternParams;
    Querystring: { organizationId?: string };
  }>(
    '/v1/patterns/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
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
    async (request, reply) => {
      const { id } = request.params;
      const organizationId = (request as any).organizationId || request.query.organizationId;

      if (!organizationId) {
        return reply.status(400).send({
          success: false,
          error: 'Organization ID is required',
        });
      }

      try {
        // Check if pattern exists and belongs to this org
        const existing = await db
          .selectFrom('identifier_patterns')
          .select(['id'])
          .where('id', '=', id)
          .where('organization_id', '=', organizationId)
          .executeTakeFirst();

        if (!existing) {
          return reply.status(404).send({
            success: false,
            error: 'Pattern not found',
          });
        }

        // Delete the pattern
        await db
          .deleteFrom('identifier_patterns')
          .where('id', '=', id)
          .where('organization_id', '=', organizationId)
          .execute();

        // Invalidate cache for this organization
        patternRegistry.invalidateCache(organizationId);

        return reply.send({
          success: true,
          message: 'Pattern deleted',
        });
      } catch (error) {
        console.error('[Patterns] Error deleting pattern:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to delete pattern',
        });
      }
    }
  );

  // Test a pattern against sample text
  fastify.post<{
    Body: { pattern: string; text: string };
  }>(
    '/v1/patterns/test',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pattern', 'text'],
          properties: {
            pattern: { type: 'string', minLength: 1, maxLength: 1000 },
            text: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { pattern, text } = request.body;

      // Validate regex pattern
      const regexValidation = isValidRegex(pattern);
      if (!regexValidation.valid) {
        return reply.status(400).send({
          success: false,
          error: regexValidation.error || 'Invalid regex pattern',
        });
      }

      try {
        const regex = new RegExp(pattern, 'gi');
        const matches: string[] = [];
        let match;

        while ((match = regex.exec(text)) !== null) {
          // Use first capture group if exists, otherwise full match
          matches.push(match[1] || match[0]);

          // Prevent infinite loops on zero-width matches
          if (match.index === regex.lastIndex) {
            regex.lastIndex++;
          }

          // Limit matches
          if (matches.length >= 100) break;
        }

        return reply.send({
          success: true,
          data: {
            matches,
            count: matches.length,
          },
        });
      } catch (error) {
        console.error('[Patterns] Error testing pattern:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to test pattern',
        });
      }
    }
  );
}
