import { db } from '../database/index.js';
import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  type CapabilityName,
} from './registry.js';

/** The resolved value of one capability for one org. */
export type EntitlementValue =
  | { kind: 'boolean'; enabled: boolean }
  | { kind: 'limit'; limit: number | null }
  | { kind: 'quota'; limit: number | null };

export interface CapabilityResolver {
  has(organizationId: string, capability: CapabilityName): Promise<boolean>;
  getLimit(organizationId: string, capability: CapabilityName): Promise<number | null>;
  list(organizationId: string): Promise<Record<CapabilityName, EntitlementValue>>;
  invalidate(organizationId: string): void;
}

interface CachedEntry {
  values: Record<CapabilityName, EntitlementValue>;
  loadedAt: number;
}

/** Defensive TTL so a missed invalidation still self-heals (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Default DB-backed resolver. Loads all entitlement rows for an org in one query,
 * merges over registry defaults, and caches the merged map in memory keyed by org.
 * Cache is invalidated on admin update and has a defensive TTL.
 *
 * Fail-open: on a DB read error it returns the permissive registry defaults and
 * logs a warning (keeps OSS available; a hosted resolver can fail closed instead).
 */
export class DbCapabilityResolver implements CapabilityResolver {
  private cache = new Map<string, CachedEntry>();

  private buildDefaults(): Record<CapabilityName, EntitlementValue> {
    const out = {} as Record<CapabilityName, EntitlementValue>;
    for (const name of CAPABILITY_NAMES) {
      const def = CAPABILITIES[name];
      if (def.kind === 'boolean') {
        out[name] = { kind: 'boolean', enabled: def.defaultEnabled };
      } else {
        out[name] = { kind: def.kind, limit: def.defaultLimit };
      }
    }
    return out;
  }

  private async load(organizationId: string): Promise<Record<CapabilityName, EntitlementValue>> {
    const cached = this.cache.get(organizationId);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.values;
    }

    const values = this.buildDefaults();

    try {
      const rows = await db
        .selectFrom('organization_entitlements')
        .select(['capability', 'enabled', 'limit_value'])
        .where('organization_id', '=', organizationId)
        .execute();

      for (const row of rows) {
        const name = row.capability as CapabilityName;
        const def = CAPABILITIES[name];
        if (!def) continue; // unknown/legacy capability name: ignore
        if (def.kind === 'boolean') {
          values[name] = { kind: 'boolean', enabled: row.enabled ?? def.defaultEnabled };
        } else {
          // limit_value is BIGINT: the pg driver returns int8 as a string (migration 059).
          values[name] = { kind: def.kind, limit: row.limit_value === null ? null : Number(row.limit_value) };
        }
      }
    } catch (err) {
      console.warn(
        '[Capabilities] Failed to load entitlements, using registry defaults. org:',
        organizationId,
        err
      );
      // values already holds permissive defaults; do not cache a failed read.
      return values;
    }

    this.cache.set(organizationId, { values, loadedAt: Date.now() });
    return values;
  }

  async has(organizationId: string, capability: CapabilityName): Promise<boolean> {
    const def = CAPABILITIES[capability];
    if (!def || def.kind !== 'boolean') {
      throw new Error(`capabilities.has() is only valid for boolean capabilities, got '${capability}'`);
    }
    const values = await this.load(organizationId);
    const v = values[capability];
    return v.kind === 'boolean' ? v.enabled : def.defaultEnabled;
  }

  async getLimit(organizationId: string, capability: CapabilityName): Promise<number | null> {
    const def = CAPABILITIES[capability];
    if (!def || (def.kind !== 'limit' && def.kind !== 'quota')) {
      throw new Error(`capabilities.getLimit() is only valid for limit/quota capabilities, got '${capability}'`);
    }
    const values = await this.load(organizationId);
    const v = values[capability];
    return v.kind === 'boolean' ? null : v.limit;
  }

  async list(organizationId: string): Promise<Record<CapabilityName, EntitlementValue>> {
    // Copy the map AND each value: a shallow map copy still shares the cached
    // EntitlementValue objects, so a caller mutating one would corrupt the cache.
    const loaded = await this.load(organizationId);
    const out = {} as Record<CapabilityName, EntitlementValue>;
    for (const key of Object.keys(loaded) as CapabilityName[]) {
      out[key] = { ...loaded[key] };
    }
    return out;
  }

  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }
}
