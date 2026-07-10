import crypto from 'crypto';
import type { ApiKeyType } from '@logtide/shared';
import { db } from '../../database/connection.js';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';

export interface ApiKey {
  id: string;
  projectId: string;
  name: string;
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
  async createApiKey(input: CreateApiKeyInput): Promise<{ id: string; apiKey: string }> {
    const apiKey = this.generateApiKey();
    const keyHash = this.hashApiKey(apiKey);

    const result = await db
      .insertInto('api_keys')
      .values({
        project_id: input.projectId,
        name: input.name,
        key_hash: keyHash,
        type: input.type ?? 'write',
        allowed_origins: input.allowedOrigins ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return {
      id: result.id,
      apiKey, // Return plain key only once
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
      .select(['id', 'project_id', 'name', 'type', 'allowed_origins', 'created_at', 'last_used', 'revoked'])
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();

    return keys.map((k) => ({
      id: k.id,
      projectId: k.project_id,
      name: k.name,
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
