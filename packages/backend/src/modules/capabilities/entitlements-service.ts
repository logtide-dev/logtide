import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '../../database/index.js';
import {
  capabilities,
  CAPABILITIES,
  CAPABILITY_NAMES,
  isKnownCapability,
  type CapabilityName,
  type EntitlementValue,
} from '../../capabilities/index.js';
import { auditLogService } from '../audit-log/index.js';

export class EntitlementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntitlementValidationError';
  }
}

export const entitlementInputSchema = z.object({
  capability: z.string(),
  enabled: z.boolean().optional(),
  // limit_value is BIGINT; cap at MAX_SAFE_INTEGER so reads coerce back exactly.
  limitValue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
});

export type EntitlementInput = z.infer<typeof entitlementInputSchema>;

type UpsertRow = {
  organization_id: string;
  capability: string;
  enabled: boolean | null;
  limit_value: number | null;
};

/**
 * Validate one entitlement against the registry. Returns the row to upsert, or
 * throws an EntitlementValidationError with a developer-facing message.
 */
function toUpsertRow(organizationId: string, input: EntitlementInput): UpsertRow {
  if (!isKnownCapability(input.capability)) {
    throw new EntitlementValidationError(`Unknown capability '${input.capability}'`);
  }
  const def = CAPABILITIES[input.capability as CapabilityName];

  if (def.kind === 'boolean') {
    if (typeof input.enabled !== 'boolean') {
      throw new EntitlementValidationError(
        `Capability '${input.capability}' is boolean and requires 'enabled'`
      );
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
    throw new EntitlementValidationError(
      `Capability '${input.capability}' is numeric and does not accept 'enabled'`
    );
  }
  if (input.limitValue === undefined) {
    throw new EntitlementValidationError(
      `Capability '${input.capability}' requires 'limitValue' (number or null)`
    );
  }
  return {
    organization_id: organizationId,
    capability: input.capability,
    enabled: null,
    limit_value: input.limitValue,
  };
}

export async function getOrganizationEntitlements(orgId: string): Promise<{
  entitlements: Record<CapabilityName, EntitlementValue>;
  defaults: Record<CapabilityName, EntitlementValue>;
  overrides: Record<string, { enabled: boolean | null; limitValue: number | null }>;
}> {
  const entitlements = await capabilities.list(orgId);

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
    .where('organization_id', '=', orgId)
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

  return { entitlements, defaults, overrides };
}

export async function setOrganizationEntitlements(
  orgId: string,
  inputs: EntitlementInput[],
  actor?: string
): Promise<{ updated: number }> {
  try {
    const parsed = z.array(entitlementInputSchema).min(1).parse(inputs);
    const rows = parsed.map((e) => toUpsertRow(orgId, e));

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

    capabilities.invalidate(orgId);

    await auditLogService.record({
      action: 'org.entitlements_updated',
      target: { type: 'organization_entitlement', id: orgId },
      organizationId: orgId,
      metadata: {
        ...(actor ? { actor } : {}),
        entitlements: rows.map((r) => ({
          capability: r.capability,
          enabled: r.enabled,
          limitValue: r.limit_value,
        })),
      },
    });

    return { updated: rows.length };
  } catch (error) {
    capabilities.invalidate(orgId);
    throw error;
  }
}

/** Removes the explicit override so the org inherits the default again. */
export async function resetOrganizationEntitlement(
  orgId: string,
  capability: string,
  actor?: string
): Promise<{ removed: boolean }> {
  if (!isKnownCapability(capability)) {
    throw new EntitlementValidationError(`Unknown capability '${capability}'`);
  }

  const result = await db
    .deleteFrom('organization_entitlements')
    .where('organization_id', '=', orgId)
    .where('capability', '=', capability)
    .executeTakeFirst();
  const removed = Number(result.numDeletedRows) > 0;

  capabilities.invalidate(orgId);

  if (removed) {
    await auditLogService.record({
      action: 'org.entitlements_updated',
      target: { type: 'organization_entitlement', id: orgId },
      organizationId: orgId,
      metadata: { ...(actor ? { actor } : {}), reset: [capability] },
    });
  }

  return { removed };
}
