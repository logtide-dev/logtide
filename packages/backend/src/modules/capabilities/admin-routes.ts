import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '../../database/index.js';
import { authenticate, SERVICE_ACTOR_LABEL } from '../auth/middleware.js';
import { requireAdmin } from '../admin/middleware.js';
import {
  capabilities,
  CAPABILITIES,
  CAPABILITY_NAMES,
  isKnownCapability,
  type CapabilityName,
  type EntitlementValue,
} from '../../capabilities/index.js';
import { auditLogService } from '../audit-log/index.js';
import { validateUuidParams } from '../admin/params.js';

const entitlementInputSchema = z.object({
  capability: z.string(),
  enabled: z.boolean().optional(),
  // limit_value is BIGINT; cap at MAX_SAFE_INTEGER so reads coerce back exactly.
  limitValue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
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
  fastify.addHook('preValidation', validateUuidParams);

  const rateLimitConfig = { max: 100, timeWindow: '1 minute' };

  // GET /api/v1/admin/organizations/:id/entitlements
  fastify.get(
    '/organizations/:id/entitlements',
    { preHandler: [requireAdmin], config: { allowServiceToken: true, rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const list = await capabilities.list(id);

      // Registry defaults (incl. CAPABILITY_DEFAULTS_JSON) and the explicit
      // per-org rows, so clients can tell "inherited" from "override".
      const defaults = {} as Record<CapabilityName, EntitlementValue>;
      for (const name of CAPABILITY_NAMES) {
        const def = CAPABILITIES[name];
        defaults[name] =
          def.kind === 'boolean'
            ? { kind: 'boolean', enabled: def.defaultEnabled }
            : { kind: def.kind, limit: def.defaultLimit };
      }
      const rows = await db
        .selectFrom('organization_entitlements')
        .select(['capability', 'enabled', 'limit_value'])
        .where('organization_id', '=', id)
        .execute();
      const overrides: Record<string, { enabled: boolean | null; limitValue: number | null }> = {};
      for (const row of rows) {
        if (!isKnownCapability(row.capability)) continue;
        overrides[row.capability] = {
          enabled: row.enabled,
          // BIGINT comes back as a string from pg
          limitValue: row.limit_value === null ? null : Number(row.limit_value),
        };
      }

      return reply.send({ entitlements: list, defaults, overrides });
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

  // DELETE /api/v1/admin/organizations/:id/entitlements/:capability
  // Removes the explicit override so the org inherits the default again.
  fastify.delete(
    '/organizations/:id/entitlements/:capability',
    { preHandler: [requireAdmin], config: { allowServiceToken: true, rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const { id, capability } = request.params as { id: string; capability: string };
      if (!isKnownCapability(capability)) {
        return reply.status(400).send({ error: `Unknown capability '${capability}'` });
      }

      const result = await db
        .deleteFrom('organization_entitlements')
        .where('organization_id', '=', id)
        .where('capability', '=', capability)
        .executeTakeFirst();
      const removed = Number(result.numDeletedRows) > 0;

      capabilities.invalidate(id);

      if (removed) {
        await auditLogService.record({
          action: 'org.entitlements_updated',
          target: { type: 'organization_entitlement', id },
          organizationId: id,
          metadata: { ...(request.servicePrincipal ? { actor: SERVICE_ACTOR_LABEL } : {}), reset: [capability] },
        });
      }

      return reply.send({ removed });
    }
  );
}
