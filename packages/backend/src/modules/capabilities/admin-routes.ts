import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '../../database/index.js';
import { authenticate, SERVICE_ACTOR_LABEL } from '../auth/middleware.js';
import { requireAdmin } from '../admin/middleware.js';
import {
  capabilities,
  CAPABILITIES,
  isKnownCapability,
  type CapabilityName,
} from '../../capabilities/index.js';
import { auditLogService } from '../audit-log/index.js';

const entitlementInputSchema = z.object({
  capability: z.string(),
  enabled: z.boolean().optional(),
  limitValue: z.number().int().min(0).nullable().optional(),
});

const putBodySchema = z.object({
  entitlements: z.array(entitlementInputSchema).min(1),
});

type EntitlementInput = z.infer<typeof entitlementInputSchema>;

/**
 * Validate one entitlement against the registry. Returns the row to upsert, or
 * throws a developer-facing message (mapped to 400 by the handler).
 */
function toUpsertRow(organizationId: string, input: EntitlementInput): {
  organization_id: string;
  capability: string;
  enabled: boolean | null;
  limit_value: number | null;
} {
  if (!isKnownCapability(input.capability)) {
    throw new Error(`Unknown capability '${input.capability}'`);
  }
  const def = CAPABILITIES[input.capability as CapabilityName];

  if (def.kind === 'boolean') {
    if (typeof input.enabled !== 'boolean') {
      throw new Error(`Capability '${input.capability}' is boolean and requires 'enabled'`);
    }
    return {
      organization_id: organizationId,
      capability: input.capability,
      enabled: input.enabled,
      limit_value: null,
    };
  }

  // limit or quota: numeric limit_value (null = unlimited)
  if (input.enabled !== undefined) {
    throw new Error(`Capability '${input.capability}' is numeric and does not accept 'enabled'`);
  }
  if (input.limitValue === undefined) {
    throw new Error(`Capability '${input.capability}' requires 'limitValue' (number or null)`);
  }
  return {
    organization_id: organizationId,
    capability: input.capability,
    enabled: null,
    limit_value: input.limitValue,
  };
}

export async function adminEntitlementsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  const rateLimitConfig = { max: 100, timeWindow: '1 minute' };

  // GET /api/v1/admin/organizations/:id/entitlements
  fastify.get(
    '/organizations/:id/entitlements',
    { preHandler: [requireAdmin], config: { allowServiceToken: true, rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const list = await capabilities.list(id);
      return reply.send({ entitlements: list });
    }
  );

  // PUT /api/v1/admin/organizations/:id/entitlements
  fastify.put(
    '/organizations/:id/entitlements',
    { preHandler: [requireAdmin], config: { allowServiceToken: true, rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      let rows: ReturnType<typeof toUpsertRow>[] = [];
      try {
        const body = putBodySchema.parse(request.body);
        rows = body.entitlements.map((e) => toUpsertRow(id, e));

        await db.transaction().execute(async (trx) => {
          for (const row of rows) {
            await trx
              .insertInto('organization_entitlements')
              .values({
                organization_id: row.organization_id,
                capability: row.capability,
                enabled: row.enabled,
                limit_value: row.limit_value,
              })
              .onConflict((oc) =>
                oc.columns(['organization_id', 'capability']).doUpdateSet({
                  enabled: row.enabled,
                  limit_value: row.limit_value,
                  updated_at: sql`NOW()`,
                })
              )
              .execute();
          }
        });

        capabilities.invalidate(id);

        await auditLogService.record({
          action: 'org.entitlements_updated',
          target: { type: 'organization_entitlement', id },
          organizationId: id,
          metadata: { ...(request.servicePrincipal ? { actor: SERVICE_ACTOR_LABEL } : {}), entitlements: rows.map((r) => ({ capability: r.capability, enabled: r.enabled, limitValue: r.limit_value })) },
        });

        return reply.send({ message: 'Entitlements updated', updated: rows.length });
      } catch (error: unknown) {
        capabilities.invalidate(id);
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.errors });
        }
        // toUpsertRow throws plain Errors for registry/shape mismatches -> 400
        if (error instanceof Error) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );
}
