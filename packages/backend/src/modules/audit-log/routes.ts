import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import type { AuditCategory, AuditActorType, AuditOutcome } from '../../database/types.js';

const organizationsService = new OrganizationsService();

const AUDIT_CATEGORIES = ['log_access', 'config_change', 'user_management', 'data_modification'] as const;

const querySchema = z.object({
  organizationId: z.string().guid(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  userId: z.string().guid().optional(),
  actorType: z.enum(['user', 'apiKey', 'system']).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

const exportSchema = z.object({
  organizationId: z.string().guid(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
  action: z.string().optional(),
  actorType: z.enum(['user', 'apiKey', 'system']).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function auditLogRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // GET /api/v1/audit-log
  fastify.get(
    '/',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
    },
    async (request: any, reply) => {
      try {
        const params = querySchema.parse(request.query);

        const isAdmin = await organizationsService.isOwnerOrAdmin(
          params.organizationId,
          request.user.id
        );
        if (!isAdmin) {
          return reply.status(403).send({
            error: 'Only organization owners and admins can view audit logs',
          });
        }

        const result = await auditLogService.query({
          organizationId: params.organizationId,
          category: params.category as AuditCategory | undefined,
          action: params.action,
          resourceType: params.resourceType,
          userId: params.userId,
          actorType: params.actorType as AuditActorType | undefined,
          outcome: params.outcome as AuditOutcome | undefined,
          from: params.from ? new Date(params.from) : undefined,
          to: params.to ? new Date(params.to) : undefined,
          limit: params.limit,
          offset: params.offset,
        });

        return reply.send(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.issues,
          });
        }
        console.error('[AuditLog] Error querying audit logs:', error);
        return reply.status(500).send({
          error: 'Failed to retrieve audit logs',
        });
      }
    }
  );

  // GET /api/v1/audit-log/actions - Get distinct action names for filter dropdown
  fastify.get(
    '/actions',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    async (request: any, reply) => {
      try {
        const { organizationId } = z
          .object({ organizationId: z.string().guid() })
          .parse(request.query);

        const isAdmin = await organizationsService.isOwnerOrAdmin(
          organizationId,
          request.user.id
        );
        if (!isAdmin) {
          return reply.status(403).send({
            error: 'Only organization owners and admins can view audit logs',
          });
        }

        const actions = await auditLogService.getDistinctActions(organizationId);
        return reply.send({ actions });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.issues,
          });
        }
        throw error;
      }
    }
  );

  // GET /api/v1/audit-log/export - Export audit log as CSV
  fastify.get(
    '/export',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request: any, reply) => {
      try {
        const params = exportSchema.parse(request.query);

        const isAdmin = await organizationsService.isOwnerOrAdmin(
          params.organizationId,
          request.user.id
        );
        if (!isAdmin) {
          return reply.status(403).send({
            error: 'Only organization owners and admins can export audit logs',
          });
        }

        const escape = (v: string | null) => {
          if (v == null) return '';
          const s = String(v).replace(/"/g, '""');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
        };

        const formatRow = (e: any) => {
          const meta = e.metadata ? JSON.stringify(e.metadata) : '';
          const timeStr = e.time instanceof Date ? e.time.toISOString() : new Date(e.time).toISOString();
          return [
            escape(timeStr),
            escape(e.user_email),
            escape(e.actor_type),
            escape(e.outcome),
            escape(e.category),
            escape(e.action),
            escape(e.resource_type),
            escape(e.resource_id),
            escape(e.ip_address),
            escape(e.user_agent),
            escape(meta),
          ].join(',');
        };

        reply.raw.setHeader('Content-Type', 'text/csv');
        reply.raw.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);

        const csvHeader = 'Time,User,Actor Type,Outcome,Category,Action,Resource Type,Resource ID,IP Address,User Agent,Details\n';
        reply.raw.write(csvHeader);

        const CHUNK_SIZE = 200;
        let offset = 0;
        let totalRows = 0;

        while (true) {
          const result = await auditLogService.query({
            organizationId: params.organizationId,
            category: params.category as AuditCategory | undefined,
            action: params.action,
            actorType: params.actorType as AuditActorType | undefined,
            outcome: params.outcome as AuditOutcome | undefined,
            from: params.from ? new Date(params.from) : undefined,
            to: params.to ? new Date(params.to) : undefined,
            limit: CHUNK_SIZE,
            offset,
          });

          for (const entry of result.entries) {
            reply.raw.write(formatRow(entry) + '\n');
          }

          totalRows += result.entries.length;
          offset += CHUNK_SIZE;

          if (result.entries.length < CHUNK_SIZE || totalRows >= 10000) break;
        }

        await auditLogService.record({
          action: 'data.exported',
          target: { type: 'audit_log', id: null },
          organizationId: params.organizationId,
          metadata: {
            format: 'csv',
            rowCount: totalRows,
            filters: { category: params.category, action: params.action, from: params.from, to: params.to },
          },
        });

        reply.raw.end();
        return;
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.issues,
          });
        }
        console.error('[AuditLog] Error exporting audit logs:', error);
        return reply.status(500).send({
          error: 'Failed to export audit logs',
        });
      }
    }
  );
}
