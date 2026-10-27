import crypto from 'crypto';
import type { ApiKeyType } from '@logtide/shared';
import { db } from '../../database/connection.js';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';

/**
 * Length of the stored key prefix: the literal "lp_" plus 6 hex chars. Enough to
 * tell keys apart in the UI, never enough to authenticate.
 */
export const API_KEY_PREFIX_LENGTH = 9;

export interface ApiKey {
  id: string;
  projectId: string;
  name: string;
  /** First 9 chars of the key, null for keys created before 1.6 */
  keyPrefix: string | null;
  type: ApiKeyType;
  allowedOrigins: string[] | null;
  createdAt: Date;
  lastUsed: Date | null;
  revoked: boolean;
}

export interface CreateApiKeyInput {
  projectId: string;
  name: string;
  type?: ApiKeyType;
  allowedOrigins?: string[] | null;
}

export interface VerifiedApiKey {
  id: string;
  projectId: string;
  organizationId: string;
  type: ApiKeyType;
  allowedOrigins: string[] | null;
}

interface CachedApiKey {
  projectId: string;
  organizationId: string;
  keyId: string;
  type: ApiKeyType;
  allowedOrigins: string[] | null;
}

export class ApiKeysService {
  private static readonly LAST_USED_DEBOUNCE_MS = 60_000;
  private lastUsedWrites = new Map<string, number>();
  private static readonly REVOKED_KEY_THROTTLE_MS = 60_000;
  private static readonly REVOKED_KEY_THROTTLE_MAX_ENTRIES = 10_000;
  private revokedKeyRecords = new Map<string, number>();

  /**
   * Hash an API key using SHA-256
   */
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Generate a new API key
   */
  generateApiKey(): string {
    return `lp_${crypto.randomBytes(32).toString('hex')}`;
  }

  /** Count api keys across all projects of an organization (capability limit input). */
  async countKeysForOrg(organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('api_keys')
      .innerJoin('projects', 'projects.id', 'api_keys.project_id')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('projects.organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Create a new API key for a project
   */
  async createApiKey(input: CreateApiKeyInput): Promise<{ id: string; apiKey: string; keyPrefix: string }> {
    const apiKey = this.generateApiKey();
    const keyHash = this.hashApiKey(apiKey);
    const keyPrefix = apiKey.slice(0, API_KEY_PREFIX_LENGTH);

    const result = await db
      .insertInto('api_keys')
      .values({
        project_id: input.projectId,
        name: input.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        type: input.type ?? 'write',
        allowed_origins: input.allowedOrigins ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return {
      id: result.id,
      apiKey, // Return plain key only once
      keyPrefix,
    };
  }

  /**
   * Verify an API key and return project ID, type, and allowed origins
   * Cached for performance - API key verification happens on every ingestion request
   */
  async verifyApiKey(apiKey: string): Promise<VerifiedApiKey | null> {
    const keyHash = this.hashApiKey(apiKey);

    // Try cache first (skip stale entries missing 'type' from before migration)
    const cacheKey = CacheManager.apiKeyKey(keyHash);
    const cached = await CacheManager.get<CachedApiKey>(cacheKey);

    if (cached && cached.type) {
      // Update last_used timestamp asynchronously (don't block the response)
      this.updateLastUsedAsync(cached.keyId).catch(() => {});
      return {
        id: cached.keyId,
        projectId: cached.projectId,
        organizationId: cached.organizationId,
        type: cached.type,
        allowedOrigins: cached.allowedOrigins ?? null,
      };
    }

    // Cache miss - query database
    const result = await db
      .selectFrom('api_keys')
      .innerJoin('projects', 'api_keys.project_id', 'projects.id')
      .select([
        'api_keys.id',
        'api_keys.project_id',
        'api_keys.type',
        'api_keys.allowed_origins',
        'projects.organization_id',
      ])
      .where('api_keys.key_hash', '=', keyHash)
      .where('api_keys.revoked', '=', false)
      .where('projects.deleted_at', 'is', null)
      .executeTakeFirst();

    if (!result) {
      return null;
    }

    // Cache the result
    await CacheManager.set(
      cacheKey,
      {
        projectId: result.project_id,
        organizationId: result.organization_id,
        keyId: result.id,
        type: result.type,
        allowedOrigins: result.allowed_origins,
      },
      CACHE_TTL.API_KEY
    );

    // Update last_used timestamp asynchronously
    this.updateLastUsedAsync(result.id).catch(() => {});

    return {
      id: result.id,
      projectId: result.project_id,
      organizationId: result.organization_id,
      type: result.type,
      allowedOrigins: result.allowed_origins,
    };
  }

  /**
   * Look up a REVOKED key by its hash. Used only on the 401 path of ingest auth
   * to attribute attempts with a revoked key to its project (health check).
   * Keys of deleted projects are ignored.
   */
  async findRevokedKeyOwner(
    apiKey: string
  ): Promise<{ organizationId: string; projectId: string; apiKeyId: string } | null> {
    const keyHash = this.hashApiKey(apiKey);
    const row = await db
      .selectFrom('api_keys')
      .innerJoin('projects', 'api_keys.project_id', 'projects.id')
      .select(['api_keys.id', 'api_keys.project_id', 'projects.organization_id'])
      .where('api_keys.key_hash', '=', keyHash)
      .where('api_keys.revoked', '=', true)
      .where('projects.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    return { organizationId: row.organization_id, projectId: row.project_id, apiKeyId: row.id };
  }

  /**
   * Record an `ingestion.revoked_key` counter when `apiKey` is a revoked key.
   * Throttled in memory to one row per key per minute so a misconfigured shipper
   * cannot flood metering_events. Never throws.
   */
  async recordRevokedKeyAttempt(apiKey: string): Promise<void> {
    try {
      const owner = await this.findRevokedKeyOwner(apiKey);
      if (!owner) return;
      const now = Date.now();
      const last = this.revokedKeyRecords.get(owner.apiKeyId);
      if (last !== undefined && now - last < ApiKeysService.REVOKED_KEY_THROTTLE_MS) return;
      if (this.revokedKeyRecords.size >= ApiKeysService.REVOKED_KEY_THROTTLE_MAX_ENTRIES) {
        for (const [id, ts] of this.revokedKeyRecords) {
          if (now - ts >= ApiKeysService.REVOKED_KEY_THROTTLE_MS) this.revokedKeyRecords.delete(id);
        }
        if (this.revokedKeyRecords.size >= ApiKeysService.REVOKED_KEY_THROTTLE_MAX_ENTRIES) {
          this.revokedKeyRecords.clear();
        }
      }
      this.revokedKeyRecords.set(owner.apiKeyId, now);
      // Lazy: the metering module graph pulls in the reservoir.
      const { metering } = await import('../metering/index.js');
      metering.record({
        type: 'ingestion.revoked_key',
        quantity: 1,
        organizationId: owner.organizationId,
        projectId: owner.projectId,
        metadata: { apiKeyId: owner.apiKeyId },
      });
    } catch {
      // Counter only: a failed lookup must never change the auth response.
    }
  }

  /** Test seam: forget the revoked-key throttle state. */
  resetRevokedKeyThrottle(): void {
    this.revokedKeyRecords.clear();
  }

  /**
   * Update last_used timestamp asynchronously.
   * Debounced per key: at most one DB write per 60s per process.
   * last_used is only used for UI display, so minute-granularity is fine.
   */
  private async updateLastUsedAsync(keyId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastUsedWrites.get(keyId);
    if (last !== undefined && now - last < ApiKeysService.LAST_USED_DEBOUNCE_MS) {
      return;
    }
    this.lastUsedWrites.set(keyId, now);
    // Bound the debounce map: entries older than the debounce window no longer
    // affect the decision, so prune them once the map grows large (otherwise it
    // leaks one entry per distinct API key ever seen).
    if (this.lastUsedWrites.size > 10_000) {
      for (const [k, t] of this.lastUsedWrites) {
        if (now - t >= ApiKeysService.LAST_USED_DEBOUNCE_MS) {
          this.lastUsedWrites.delete(k);
        }
      }
    }
    await db
      .updateTable('api_keys')
      .set({ last_used: new Date() })
      .where('id', '=', keyId)
      .execute();
  }

  /**
   * List all API keys for a project
   */
  async listProjectApiKeys(projectId: string): Promise<ApiKey[]> {
    const keys = await db
      .selectFrom('api_keys')
      .select(['id', 'project_id', 'name', 'key_prefix', 'type', 'allowed_origins', 'created_at', 'last_used', 'revoked'])
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();

    return keys.map((k) => ({
      id: k.id,
      projectId: k.project_id,
      name: k.name,
      keyPrefix: k.key_prefix ?? null,
      type: k.type,
      allowedOrigins: k.allowed_origins,
      createdAt: new Date(k.created_at),
      lastUsed: k.last_used ? new Date(k.last_used) : null,
      revoked: k.revoked,
    }));
  }

  /**
   * Revoke (soft delete) an API key
   */
  async revokeApiKey(id: string, projectId: string): Promise<boolean> {
    // Get the key hash first for cache invalidation
    const keyRecord = await db
      .selectFrom('api_keys')
      .select('key_hash')
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();

    const result = await db
      .updateTable('api_keys')
      .set({ revoked: true })
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();

    // Invalidate cache after successful revocation
    if (keyRecord && Number(result.numUpdatedRows || 0) > 0) {
      await CacheManager.invalidateApiKey(keyRecord.key_hash);
    }

    return Number(result.numUpdatedRows || 0) > 0;
  }

  /**
   * Delete an API key permanently
   */
  async deleteApiKey(id: string, projectId: string): Promise<boolean> {
    // Get the key hash first for cache invalidation
    const keyRecord = await db
      .selectFrom('api_keys')
      .select('key_hash')
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();

    const result = await db
      .deleteFrom('api_keys')
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();

    // Invalidate cache after successful deletion
    if (keyRecord && Number(result.numDeletedRows || 0) > 0) {
      await CacheManager.invalidateApiKey(keyRecord.key_hash);
    }

    return Number(result.numDeletedRows || 0) > 0;
  }
}

export const apiKeysService = new ApiKeysService();
