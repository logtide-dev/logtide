import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { settingsService, SettingsService, SETTING_KEYS } from '../../../modules/settings/service.js';
import { CacheManager } from '../../../utils/cache.js';

describe('SettingsService', () => {
  beforeEach(async () => {
    // Clean up tables in correct order (respecting foreign keys)
    await db.deleteFrom('system_settings').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();
    // Clear cache
    await CacheManager.invalidateSettings();
  });

  afterEach(async () => {
    // Clean up after tests
    await db.deleteFrom('system_settings').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();
    await CacheManager.invalidateSettings();
  });

  describe('get', () => {
    it('should return default value when setting does not exist', async () => {
      const result = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(result).toBe(true); // Default value
    });

    it('should return stored value when setting exists', async () => {
      // Insert a setting
      await db
        .insertInto('system_settings')
        .values({
          key: SETTING_KEYS.AUTH_SIGNUP_ENABLED,
          value: JSON.stringify(false),
        })
        .execute();

      const result = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(result).toBe(false);
    });

    it('should return custom default value when provided', async () => {
      const result = await settingsService.get(SETTING_KEYS.AUTH_DEFAULT_USER_ID, 'custom-default');
      expect(result).toBe('custom-default');
    });

    it('should cache values after first read', async () => {
      // Insert a setting
      await db
        .insertInto('system_settings')
        .values({
          key: SETTING_KEYS.AUTH_SIGNUP_ENABLED,
          value: JSON.stringify(false),
        })
        .execute();

      // First read
      const result1 = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(result1).toBe(false);

      // Update in DB directly (bypassing cache)
      await db
        .updateTable('system_settings')
        .set({ value: JSON.stringify(true) })
        .where('key', '=', SETTING_KEYS.AUTH_SIGNUP_ENABLED)
        .execute();

      // Second read should still return cached value
      const result2 = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(result2).toBe(false);
    });

    it('should return correct auth mode default', async () => {
      const result = await settingsService.get(SETTING_KEYS.AUTH_MODE);
      expect(result).toBe('standard');
    });
  });

  describe('set', () => {
    it('should store a new setting', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      const result = await db
        .selectFrom('system_settings')
        .select('value')
        .where('key', '=', SETTING_KEYS.AUTH_SIGNUP_ENABLED)
        .executeTakeFirst();

      expect(result?.value).toBe(false);
    });

    it('should update an existing setting', async () => {
      // Insert initial value
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, true);

      // Update
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      const result = await db
        .selectFrom('system_settings')
        .select('value')
        .where('key', '=', SETTING_KEYS.AUTH_SIGNUP_ENABLED)
        .executeTakeFirst();

      expect(result?.value).toBe(false);
    });

    it('should invalidate cache after setting', async () => {
      // Set initial value
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, true);

      // Read to populate cache
      await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);

      // Update value
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      // Cache should be invalidated, so we need to clear and re-read
      await CacheManager.invalidateSettings();
      const result = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(result).toBe(false);
    });

    it('should store updated_by when provided', async () => {
      // Create a real user to satisfy foreign key constraint
      const { createTestUser } = await import('../../helpers/factories.js');
      const user = await createTestUser();

      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false, user.id);

      const result = await db
        .selectFrom('system_settings')
        .select('updated_by')
        .where('key', '=', SETTING_KEYS.AUTH_SIGNUP_ENABLED)
        .executeTakeFirst();

      expect(result?.updated_by).toBe(user.id);
    });

    it('should handle string values', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_MODE, 'none');

      const result = await settingsService.get(SETTING_KEYS.AUTH_MODE);
      expect(result).toBe('none');
    });

    it('should handle null values', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_DEFAULT_USER_ID, null);

      const result = await settingsService.get(SETTING_KEYS.AUTH_DEFAULT_USER_ID);
      expect(result).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return empty object when no settings exist', async () => {
      const result = await settingsService.getAll();
      expect(result).toEqual({});
    });

    it('should return all settings with metadata', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);
      await settingsService.set(SETTING_KEYS.AUTH_MODE, 'none');

      const result = await settingsService.getAll();

      expect(result[SETTING_KEYS.AUTH_SIGNUP_ENABLED]).toBeDefined();
      expect(result[SETTING_KEYS.AUTH_SIGNUP_ENABLED].value).toBe(false);
      expect(result[SETTING_KEYS.AUTH_SIGNUP_ENABLED].key).toBe(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(result[SETTING_KEYS.AUTH_SIGNUP_ENABLED].updated_at).toBeInstanceOf(Date);

      expect(result[SETTING_KEYS.AUTH_MODE]).toBeDefined();
      expect(result[SETTING_KEYS.AUTH_MODE].value).toBe('none');
    });
  });

  describe('getAllValues', () => {
    it('should return default values when no settings exist', async () => {
      const result = await settingsService.getAllValues();

      expect(result[SETTING_KEYS.AUTH_SIGNUP_ENABLED]).toBe(true);
      expect(result[SETTING_KEYS.AUTH_MODE]).toBe('standard');
      expect(result[SETTING_KEYS.AUTH_DEFAULT_USER_ID]).toBeNull();
    });

    it('should return stored values merged with defaults', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      const result = await settingsService.getAllValues();

      expect(result[SETTING_KEYS.AUTH_SIGNUP_ENABLED]).toBe(false);
      expect(result[SETTING_KEYS.AUTH_MODE]).toBe('standard'); // Default
    });
  });

  describe('setMany', () => {
    it('should update multiple settings at once', async () => {
      await settingsService.setMany({
        'auth.signup_enabled': false,
        'auth.mode': 'none',
      });

      const signupEnabled = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      const authMode = await settingsService.get(SETTING_KEYS.AUTH_MODE);

      expect(signupEnabled).toBe(false);
      expect(authMode).toBe('none');
    });

    it('should skip undefined values', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, true);

      await settingsService.setMany({
        'auth.signup_enabled': undefined,
        'auth.mode': 'none',
      });

      const signupEnabled = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      const authMode = await settingsService.get(SETTING_KEYS.AUTH_MODE);

      expect(signupEnabled).toBe(true); // Should remain unchanged
      expect(authMode).toBe('none');
    });

    it('should pass updatedBy to all settings', async () => {
      // Create a real user to satisfy foreign key constraint
      const { createTestUser } = await import('../../helpers/factories.js');
      const user = await createTestUser();

      await settingsService.setMany(
        {
          'auth.signup_enabled': false,
          'auth.mode': 'none',
        },
        user.id
      );

      const results = await db
        .selectFrom('system_settings')
        .select(['key', 'updated_by'])
        .execute();

      for (const result of results) {
        expect(result.updated_by).toBe(user.id);
      }
    });
  });

  describe('delete', () => {
    it('should delete an existing setting', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      await settingsService.delete(SETTING_KEYS.AUTH_SIGNUP_ENABLED);

      const result = await db
        .selectFrom('system_settings')
        .select('key')
        .where('key', '=', SETTING_KEYS.AUTH_SIGNUP_ENABLED)
        .executeTakeFirst();

      expect(result).toBeUndefined();
    });

    it('should not throw when deleting non-existent setting', async () => {
      await expect(settingsService.delete('non.existent.key')).resolves.not.toThrow();
    });

    it('should invalidate cache after delete', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);
      await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED); // Populate cache

      await settingsService.delete(SETTING_KEYS.AUTH_SIGNUP_ENABLED);

      // After delete, should return default
      const result = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(result).toBe(true);
    });
  });

  describe('helper methods', () => {
    describe('isSignupEnabled', () => {
      it('should return true by default', async () => {
        const result = await settingsService.isSignupEnabled();
        expect(result).toBe(true);
      });

      it('should return stored value', async () => {
        await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);
        const result = await settingsService.isSignupEnabled();
        expect(result).toBe(false);
      });
    });

    describe('getAuthMode', () => {
      it('should return standard by default', async () => {
        const result = await settingsService.getAuthMode();
        expect(result).toBe('standard');
      });

      it('should return stored value', async () => {
        await settingsService.set(SETTING_KEYS.AUTH_MODE, 'none');
        const result = await settingsService.getAuthMode();
        expect(result).toBe('none');
      });
    });

    describe('isAuthFreeMode', () => {
      it('should return false by default', async () => {
        const result = await settingsService.isAuthFreeMode();
        expect(result).toBe(false);
      });

      it('should return true when auth mode is none', async () => {
        await settingsService.set(SETTING_KEYS.AUTH_MODE, 'none');
        const result = await settingsService.isAuthFreeMode();
        expect(result).toBe(true);
      });

      it('should return false when auth mode is standard', async () => {
        await settingsService.set(SETTING_KEYS.AUTH_MODE, 'standard');
        const result = await settingsService.isAuthFreeMode();
        expect(result).toBe(false);
      });
    });

    describe('getDefaultUserId', () => {
      it('should return null by default', async () => {
        const result = await settingsService.getDefaultUserId();
        expect(result).toBeNull();
      });

      it('should return stored user ID', async () => {
        const userId = '00000000-0000-0000-0000-000000000001';
        await settingsService.set(SETTING_KEYS.AUTH_DEFAULT_USER_ID, userId);
        const result = await settingsService.getDefaultUserId();
        expect(result).toBe(userId);
      });
    });
  });

  describe('singleton and class', () => {
    it('should be a singleton export', () => {
      expect(settingsService).toBeInstanceOf(SettingsService);
    });

    it('should allow creating new instances', () => {
      const newService = new SettingsService();
      expect(newService).toBeInstanceOf(SettingsService);
    });
  });
});
