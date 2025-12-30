/**
 * Provider Service
 *
 * CRUD operations for authentication providers (admin only).
 * Handles configuration validation and cache invalidation.
 */

import { db } from '../../database/connection.js';
import { providerRegistry, type AuthProviderConfig, type OidcProviderConfig, type LdapProviderConfig } from './providers/index.js';

export interface CreateProviderInput {
  type: 'oidc' | 'ldap';
  name: string;
  slug: string;
  enabled?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  icon?: string;
  config: Record<string, unknown>; // Validated at runtime based on type
}

export interface UpdateProviderInput {
  name?: string;
  enabled?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  icon?: string | null;
  config?: Record<string, unknown>;
}

/**
 * Validate provider slug format
 */
function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length >= 2 && slug.length <= 50;
}

/**
 * Validate OIDC configuration
 */
function validateOidcConfig(config: OidcProviderConfig): string | null {
  if (!config.issuerUrl) return 'Issuer URL is required';
  if (!config.clientId) return 'Client ID is required';
  if (!config.clientSecret) return 'Client Secret is required';

  try {
    new URL(config.issuerUrl);
  } catch {
    return 'Invalid Issuer URL format';
  }

  return null;
}

/**
 * Validate LDAP configuration
 */
function validateLdapConfig(config: LdapProviderConfig): string | null {
  if (!config.url) return 'LDAP URL is required';
  if (!config.bindDn) return 'Bind DN is required';
  if (!config.bindPassword) return 'Bind Password is required';
  if (!config.searchBase) return 'Search Base is required';
  if (!config.searchFilter) return 'Search Filter is required';

  if (!config.searchFilter.includes('{{username}}')) {
    return 'Search Filter must contain {{username}} placeholder';
  }

  // Validate URL format
  if (!config.url.startsWith('ldap://') && !config.url.startsWith('ldaps://')) {
    return 'LDAP URL must start with ldap:// or ldaps://';
  }

  return null;
}

export class ProviderService {
  /**
   * Get all providers (admin view)
   */
  async getAllProviders(): Promise<AuthProviderConfig[]> {
    const rows = await db
      .selectFrom('auth_providers')
      .selectAll()
      .orderBy('display_order', 'asc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      slug: row.slug,
      enabled: row.enabled,
      isDefault: row.is_default,
      displayOrder: row.display_order,
      icon: row.icon,
      config: row.config as Record<string, unknown>,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Get a provider by ID
   */
  async getProviderById(id: string): Promise<AuthProviderConfig | null> {
    const row = await db
      .selectFrom('auth_providers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      name: row.name,
      slug: row.slug,
      enabled: row.enabled,
      isDefault: row.is_default,
      displayOrder: row.display_order,
      icon: row.icon,
      config: row.config as Record<string, unknown>,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Create a new provider
   */
  async createProvider(input: CreateProviderInput): Promise<AuthProviderConfig> {
    // Validate slug
    if (!validateSlug(input.slug)) {
      throw new Error('Slug must be lowercase alphanumeric with hyphens, 2-50 characters');
    }

    // Check slug uniqueness
    const existing = await db
      .selectFrom('auth_providers')
      .select('id')
      .where('slug', '=', input.slug)
      .executeTakeFirst();

    if (existing) {
      throw new Error(`Provider with slug '${input.slug}' already exists`);
    }

    // Validate config based on type
    if (input.type === 'oidc') {
      const error = validateOidcConfig(input.config as unknown as OidcProviderConfig);
      if (error) throw new Error(error);
    } else if (input.type === 'ldap') {
      const error = validateLdapConfig(input.config as unknown as LdapProviderConfig);
      if (error) throw new Error(error);
    }

    // Get next display order
    const maxOrder = await db
      .selectFrom('auth_providers')
      .select(db.fn.max('display_order').as('max'))
      .executeTakeFirst();

    const displayOrder = input.displayOrder ?? (Number(maxOrder?.max || 0) + 1);

    // Create provider
    const row = await db
      .insertInto('auth_providers')
      .values({
        type: input.type,
        name: input.name,
        slug: input.slug,
        enabled: input.enabled ?? true,
        is_default: input.isDefault ?? false,
        display_order: displayOrder,
        icon: input.icon || null,
        config: input.config,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Invalidate cache
    await providerRegistry.invalidateCache();

    return {
      id: row.id,
      type: row.type,
      name: row.name,
      slug: row.slug,
      enabled: row.enabled,
      isDefault: row.is_default,
      displayOrder: row.display_order,
      icon: row.icon,
      config: row.config as Record<string, unknown>,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Update an existing provider
   */
  async updateProvider(id: string, input: UpdateProviderInput): Promise<AuthProviderConfig> {
    // Get existing provider
    const existing = await this.getProviderById(id);
    if (!existing) {
      throw new Error('Provider not found');
    }

    // Cannot modify local provider type
    if (existing.slug === 'local') {
      if (input.enabled === false) {
        throw new Error('Cannot disable the local authentication provider');
      }
    }

    // Validate config if provided
    if (input.config) {
      if (existing.type === 'oidc') {
        const error = validateOidcConfig(input.config as unknown as OidcProviderConfig);
        if (error) throw new Error(error);
      } else if (existing.type === 'ldap') {
        const error = validateLdapConfig(input.config as unknown as LdapProviderConfig);
        if (error) throw new Error(error);
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;
    if (input.isDefault !== undefined) updateData.is_default = input.isDefault;
    if (input.displayOrder !== undefined) updateData.display_order = input.displayOrder;
    if (input.icon !== undefined) updateData.icon = input.icon;
    if (input.config !== undefined) updateData.config = input.config;

    // Update provider
    const row = await db
      .updateTable('auth_providers')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Invalidate cache
    await providerRegistry.invalidateCache();

    return {
      id: row.id,
      type: row.type,
      name: row.name,
      slug: row.slug,
      enabled: row.enabled,
      isDefault: row.is_default,
      displayOrder: row.display_order,
      icon: row.icon,
      config: row.config as Record<string, unknown>,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Delete a provider
   */
  async deleteProvider(id: string): Promise<void> {
    // Get existing provider
    const existing = await this.getProviderById(id);
    if (!existing) {
      throw new Error('Provider not found');
    }

    // Cannot delete local provider
    if (existing.slug === 'local') {
      throw new Error('Cannot delete the local authentication provider');
    }

    // Check if any users have identities with this provider
    const identityCount = await db
      .selectFrom('user_identities')
      .select(db.fn.countAll().as('count'))
      .where('provider_id', '=', id)
      .executeTakeFirst();

    if (identityCount && Number(identityCount.count) > 0) {
      throw new Error(
        `Cannot delete provider with ${identityCount.count} linked user(s). Unlink users first.`
      );
    }

    // Delete provider
    await db.deleteFrom('auth_providers').where('id', '=', id).execute();

    // Invalidate cache
    await providerRegistry.invalidateCache();
  }

  /**
   * Test a provider's connection
   */
  async testProviderConnection(id: string): Promise<{ success: boolean; message: string }> {
    const provider = await providerRegistry.getProviderById(id);
    if (!provider) {
      return { success: false, message: 'Provider not found' };
    }

    if (!provider.testConnection) {
      return { success: true, message: 'Connection test not available for this provider type' };
    }

    return provider.testConnection();
  }

  /**
   * Reorder providers
   */
  async reorderProviders(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .updateTable('auth_providers')
        .set({ display_order: i })
        .where('id', '=', orderedIds[i])
        .execute();
    }

    // Invalidate cache
    await providerRegistry.invalidateCache();
  }
}

// Export singleton instance
export const providerService = new ProviderService();
