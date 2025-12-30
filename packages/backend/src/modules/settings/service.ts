/**
 * Settings Service
 *
 * Manages system-wide runtime configuration stored in the database.
 * Settings are cached in Redis for performance.
 */

import { db } from '../../database/connection.js';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';
import { sql } from 'kysely';

// Known setting keys for type safety
export const SETTING_KEYS = {
  AUTH_SIGNUP_ENABLED: 'auth.signup_enabled',
  AUTH_MODE: 'auth.mode',
  AUTH_DEFAULT_USER_ID: 'auth.default_user_id',
} as const;

// Type for auth mode
export type AuthMode = 'standard' | 'none';

// Interface for a setting record
export interface SettingRecord {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: Date;
  updated_by: string | null;
}

// Interface for all settings as a flat object
export interface SystemSettings {
  'auth.signup_enabled': boolean;
  'auth.mode': AuthMode;
  'auth.default_user_id': string | null;
}

// Default values for settings
const DEFAULT_VALUES: SystemSettings = {
  'auth.signup_enabled': true,
  'auth.mode': 'standard',
  'auth.default_user_id': null,
};

export class SettingsService {
  /**
   * Get a single setting value with caching
   */
  async get<K extends keyof SystemSettings>(
    key: K,
    defaultValue?: SystemSettings[K]
  ): Promise<SystemSettings[K]> {
    // Try cache first
    const cacheKey = CacheManager.settingsKey(key);
    const cached = await CacheManager.get<SystemSettings[K]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Fallback to DB
    const result = await db
      .selectFrom('system_settings')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();

    const value = (result?.value ?? defaultValue ?? DEFAULT_VALUES[key]) as SystemSettings[K];

    // Cache the result
    await CacheManager.set(cacheKey, value, CACHE_TTL.SETTINGS);

    return value;
  }

  /**
   * Set a single setting value
   */
  async set<K extends keyof SystemSettings>(
    key: K,
    value: SystemSettings[K],
    updatedBy?: string
  ): Promise<void> {
    await db
      .insertInto('system_settings')
      .values({
        key,
        value: sql`${JSON.stringify(value)}::jsonb`,
        updated_by: updatedBy ?? null,
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value: sql`${JSON.stringify(value)}::jsonb`,
          updated_by: updatedBy ?? null,
        })
      )
      .execute();

    // Invalidate cache
    await CacheManager.invalidateSettings();
  }

  /**
   * Get all settings as a flat object
   */
  async getAll(): Promise<Record<string, SettingRecord>> {
    const results = await db
      .selectFrom('system_settings')
      .selectAll()
      .execute();

    const settings: Record<string, SettingRecord> = {};
    for (const row of results) {
      settings[row.key] = {
        key: row.key,
        value: row.value,
        description: row.description,
        updated_at: new Date(row.updated_at),
        updated_by: row.updated_by,
      };
    }

    return settings;
  }

  /**
   * Get all settings values only (for API response)
   */
  async getAllValues(): Promise<Record<string, unknown>> {
    const results = await db
      .selectFrom('system_settings')
      .select(['key', 'value'])
      .execute();

    const settings: Record<string, unknown> = {};
    for (const row of results) {
      settings[row.key] = row.value;
    }

    // Ensure all default keys exist
    for (const [key, defaultValue] of Object.entries(DEFAULT_VALUES)) {
      if (!(key in settings)) {
        settings[key] = defaultValue;
      }
    }

    return settings;
  }

  /**
   * Update multiple settings at once
   */
  async setMany(
    settings: Partial<SystemSettings>,
    updatedBy?: string
  ): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        await this.set(key as keyof SystemSettings, value as any, updatedBy);
      }
    }
  }

  /**
   * Delete a setting (resets to default)
   */
  async delete(key: string): Promise<void> {
    await db.deleteFrom('system_settings').where('key', '=', key).execute();
    await CacheManager.invalidateSettings();
  }

  // ============================================================================
  // HELPER METHODS FOR COMMON SETTINGS
  // ============================================================================

  /**
   * Check if user signup is enabled
   */
  async isSignupEnabled(): Promise<boolean> {
    return this.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
  }

  /**
   * Get the current auth mode
   */
  async getAuthMode(): Promise<AuthMode> {
    return this.get(SETTING_KEYS.AUTH_MODE);
  }

  /**
   * Check if running in auth-free mode
   */
  async isAuthFreeMode(): Promise<boolean> {
    const mode = await this.getAuthMode();
    return mode === 'none';
  }

  /**
   * Get default user ID for auth-free mode
   */
  async getDefaultUserId(): Promise<string | null> {
    return this.get(SETTING_KEYS.AUTH_DEFAULT_USER_ID);
  }
}

// Export singleton instance
export const settingsService = new SettingsService();
