/**
 * Provider Registry
 *
 * Manages authentication provider instances, loading configurations from database
 * and caching them in Redis for performance.
 */

import { db } from '../../../database/connection.js';
import { CacheManager } from '../../../utils/cache.js';
import type { AuthProvider, AuthProviderConfig, PublicAuthProvider } from './types.js';
import { LocalProvider } from './local-provider.js';
import { OidcProvider } from './oidc-provider.js';
import { LdapProvider } from './ldap-provider.js';

const CACHE_KEY_ALL_PROVIDERS = 'auth:providers:all';
const CACHE_KEY_PROVIDER_PREFIX = 'auth:provider:';

/**
 * Convert database row to AuthProviderConfig
 */
function toAuthProviderConfig(row: {
  id: string;
  type: string;
  name: string;
  slug: string;
  enabled: boolean;
  is_default: boolean;
  display_order: number;
  icon: string | null;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}): AuthProviderConfig {
  return {
    id: row.id,
    type: row.type as AuthProviderConfig['type'],
    name: row.name,
    slug: row.slug,
    enabled: row.enabled,
    isDefault: row.is_default,
    displayOrder: row.display_order,
    icon: row.icon,
    config: row.config,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create provider instance based on type
 */
function createProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.type) {
    case 'local':
      return new LocalProvider(config);
    case 'oidc':
      return new OidcProvider(config);
    case 'ldap':
      return new LdapProvider(config);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

/**
 * Provider Registry Class
 *
 * Provides methods to load, cache, and retrieve authentication providers.
 */
export class ProviderRegistry {
  private providers: Map<string, AuthProvider> = new Map();
  private initialized = false;

  /**
   * Initialize the registry by loading all providers from database
   */
  async initialize(): Promise<void> {
    await this.reloadProviders();
    this.initialized = true;
  }

  /**
   * Reload all providers from database
   */
  async reloadProviders(): Promise<void> {
    // Try to get from cache first
    const cached = await CacheManager.get<AuthProviderConfig[]>(CACHE_KEY_ALL_PROVIDERS);

    if (cached) {
      this.providers.clear();
      for (const config of cached) {
        try {
          const provider = createProvider(config);
          this.providers.set(config.slug, provider);
        } catch (error) {
          console.error(`Failed to create provider ${config.slug}:`, error);
        }
      }
      return;
    }

    // Load from database
    const rows = await db
      .selectFrom('auth_providers')
      .selectAll()
      .orderBy('display_order', 'asc')
      .execute();

    const configs = rows.map(toAuthProviderConfig);

    // Cache for 5 minutes
    await CacheManager.set(CACHE_KEY_ALL_PROVIDERS, configs, 300);

    // Create provider instances
    this.providers.clear();
    for (const config of configs) {
      try {
        const provider = createProvider(config);
        this.providers.set(config.slug, provider);
      } catch (error) {
        console.error(`Failed to create provider ${config.slug}:`, error);
      }
    }
  }

  /**
   * Get a provider by slug
   */
  async getProvider(slug: string): Promise<AuthProvider | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check in-memory cache
    if (this.providers.has(slug)) {
      const provider = this.providers.get(slug)!;
      // Only return if enabled
      return provider.config.enabled ? provider : null;
    }

    // Try to load from Redis cache
    const cacheKey = CACHE_KEY_PROVIDER_PREFIX + slug;
    const cached = await CacheManager.get<AuthProviderConfig>(cacheKey);

    if (cached && cached.enabled) {
      const provider = createProvider(cached);
      this.providers.set(slug, provider);
      return provider;
    }

    // Load from database
    const row = await db
      .selectFrom('auth_providers')
      .selectAll()
      .where('slug', '=', slug)
      .where('enabled', '=', true)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    const config = toAuthProviderConfig(row);
    await CacheManager.set(cacheKey, config, 300);

    const provider = createProvider(config);
    this.providers.set(slug, provider);
    return provider;
  }

  /**
   * Get a provider by ID
   */
  async getProviderById(id: string): Promise<AuthProvider | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check in-memory cache first
    for (const provider of this.providers.values()) {
      if (provider.config.id === id && provider.config.enabled) {
        return provider;
      }
    }

    // Load from database
    const row = await db
      .selectFrom('auth_providers')
      .selectAll()
      .where('id', '=', id)
      .where('enabled', '=', true)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    const config = toAuthProviderConfig(row);
    const provider = createProvider(config);
    this.providers.set(config.slug, provider);
    return provider;
  }

  /**
   * Get all enabled providers (for login page)
   */
  async getEnabledProviders(): Promise<AuthProvider[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    return Array.from(this.providers.values())
      .filter((p) => p.config.enabled)
      .sort((a, b) => a.config.displayOrder - b.config.displayOrder);
  }

  /**
   * Get all enabled providers as public info (safe for frontend)
   */
  async getPublicProviders(): Promise<PublicAuthProvider[]> {
    const providers = await this.getEnabledProviders();
    return providers.map((p) => ({
      id: p.config.id,
      type: p.config.type,
      name: p.config.name,
      slug: p.config.slug,
      icon: p.config.icon,
      isDefault: p.config.isDefault,
      displayOrder: p.config.displayOrder,
      supportsRedirect: p.supportsRedirect(),
    }));
  }

  /**
   * Get the local provider (always exists)
   */
  async getLocalProvider(): Promise<AuthProvider | null> {
    return this.getProvider('local');
  }

  /**
   * Invalidate cache (call after provider config changes)
   */
  async invalidateCache(): Promise<void> {
    await CacheManager.delete(CACHE_KEY_ALL_PROVIDERS);
    for (const slug of this.providers.keys()) {
      await CacheManager.delete(CACHE_KEY_PROVIDER_PREFIX + slug);
    }
    this.providers.clear();
    this.initialized = false;
  }
}

// Export singleton instance
export const providerRegistry = new ProviderRegistry();
