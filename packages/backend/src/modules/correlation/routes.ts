/**
 * Correlation API Routes
 *
 * Endpoints for event correlation feature:
 * - GET /v1/correlation/:identifierValue - Get correlated logs by identifier
 * - GET /v1/logs/:logId/identifiers - Get identifiers for a specific log
 * - POST /v1/logs/identifiers/batch - Get identifiers for multiple logs
 */

import type { FastifyInstance } from 'fastify';
import { correlationService } from './service.js';
import { db } from '../../database/index.js';

// Request type declarations
interface CorrelationParams {
  identifierValue: string;
}

interface CorrelationQuery {
  projectId: string;
  referenceTime?: string;
  timeWindowMinutes?: number;
  limit?: number;
}

interface LogIdParams {
  logId: string;
}

interface BatchIdentifiersBody {
  logIds: string[];
}

/**
 * Verify that the requesting user has access to the project
 * For API key auth: projectId is already validated by auth plugin
 * For session auth: verify org membership
 */
async function verifyProjectAccess(
  request: { projectId?: string; organizationId?: string },
  projectId: string
): Promise<boolean> {
  // If request already has projectId from API key auth, it's pre-validated
  if (request.projectId === projectId) {
    return true;
  }

  // For session-based auth, verify the project belongs to user's org
  if (request.organizationId) {
    const project = await db
      .selectFrom('projects')
      .select(['organization_id'])
      .where('id', '=', projectId)
      .executeTakeFirst();

    return project?.organization_id === request.organizationId;
  }

  return false;
}

export default async function correlationRoutes(fastify: FastifyInstance) {
  // Get correlated logs by identifier value
  fastify.get<{
    Params: CorrelationParams;
    Querystring: CorrelationQuery;
  }>(
    '/v1/correlation/:identifierValue',
    {
      schema: {
        params: {
          type: 'object',
          required: ['identifierValue'],
          properties: {
            identifierValue: { type: 'string', minLength: 1 },
          },
        },
        querystring: {
          type: 'object',
          required: ['projectId'],
          properties: {
            projectId: { type: 'string' },
            referenceTime: { type: 'string' },
            timeWindowMinutes: { type: 'number', default: 15 },
            limit: { type: 'number', default: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const { identifierValue } = request.params;
      const { projectId, referenceTime, timeWindowMinutes, limit } = request.query;

      // Verify project access
      const hasAccess = await verifyProjectAccess(request as any, projectId);
      if (!hasAccess) {
        return reply.status(403).send({
          success: false,
          error: 'Access denied to this project',
        });
      }

      try {
        const result = await correlationService.findCorrelatedLogs({
          projectId,
          identifierValue: decodeURIComponent(identifierValue),
          referenceTime: referenceTime ? new Date(referenceTime) : undefined,
          timeWindowMinutes: timeWindowMinutes ?? 15,
          limit: Math.min(limit ?? 100, 100), // Cap at 100
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error('[Correlation] Error finding correlated logs:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to find correlated logs',
        });
      }
    }
  );

  // Get identifiers for a specific log
  fastify.get<{
    Params: LogIdParams;
    Querystring: { projectId?: string };
  }>(
    '/v1/logs/:logId/identifiers',
    {
      schema: {
        params: {
          type: 'object',
          required: ['logId'],
          properties: {
            logId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { logId } = request.params;
      const { projectId } = request.query;

      try {
        // Get the log to verify access
        const log = await db
          .selectFrom('logs')
          .select(['project_id'])
          .where('id', '=', logId)
          .executeTakeFirst();

        if (!log) {
          return reply.status(404).send({
            success: false,
            error: 'Log not found',
          });
        }

        // Verify project access
        const hasAccess = await verifyProjectAccess(request as any, log.project_id || projectId || '');
        if (!hasAccess) {
          return reply.status(403).send({
            success: false,
            error: 'Access denied to this log',
          });
        }

        const identifiers = await correlationService.getLogIdentifiers(logId);

        return reply.send({
          success: true,
          data: { identifiers },
        });
      } catch (error) {
        console.error('[Correlation] Error getting log identifiers:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to get log identifiers',
        });
      }
    }
  );

  // Get identifiers for multiple logs (batch)
  fastify.post<{
    Body: BatchIdentifiersBody;
    Querystring: { projectId?: string };
  }>(
    '/v1/logs/identifiers/batch',
    {
      schema: {
        body: {
          type: 'object',
          required: ['logIds'],
          properties: {
            logIds: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 100,
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { logIds } = request.body;
      const { projectId } = request.query;

      // Server-side validation of batch size
      if (logIds.length > 100) {
        return reply.status(400).send({
          success: false,
          error: 'Batch size exceeds maximum of 100 log IDs',
        });
      }

      if (logIds.length === 0) {
        return reply.send({
          success: true,
          data: { identifiers: {} },
        });
      }

      try {
        // Verify at least one log belongs to accessible project
        const logs = await db
          .selectFrom('logs')
          .select(['id', 'project_id'])
          .where('id', 'in', logIds)
          .execute();

        if (logs.length === 0) {
          return reply.send({
            success: true,
            data: { identifiers: {} },
          });
        }

        // Check access to the first log's project
        const firstProjectId = logs[0].project_id || projectId || '';
        const hasAccess = await verifyProjectAccess(request as any, firstProjectId);
        if (!hasAccess) {
          return reply.status(403).send({
            success: false,
            error: 'Access denied to these logs',
          });
        }

        // Only return identifiers for logs in accessible projects
        const accessibleLogIds = logs
          .filter((log) => log.project_id === firstProjectId)
          .map((log) => log.id);

        const identifiersMap = await correlationService.getLogIdentifiersBatch(accessibleLogIds);

        // Convert Map to plain object for JSON serialization
        const identifiers: Record<string, Array<{ type: string; value: string; sourceField: string }>> = {};
        for (const [logId, matches] of identifiersMap) {
          identifiers[logId] = matches;
        }

        return reply.send({
          success: true,
          data: { identifiers },
        });
      } catch (error) {
        console.error('[Correlation] Error getting batch identifiers:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to get batch identifiers',
        });
      }
    }
  );
}
