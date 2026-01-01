import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { BootstrapService } from '../../../modules/bootstrap/service.js';
import { CacheManager } from '../../../utils/cache.js';
import { settingsService } from '../../../modules/settings/service.js';
import { createTestUser } from '../../helpers/factories.js';
import { config } from '../../../config/index.js';

describe('BootstrapService', () => {
    let bootstrapService: BootstrapService;

    beforeEach(async () => {
        // Create fresh instance for each test
        bootstrapService = new BootstrapService();
        bootstrapService.clearCache();

        // Reset system settings and cache
        await db.deleteFrom('system_settings').execute();
        await CacheManager.invalidateSettings();

        // Clean up users
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('users').execute();
    });

    afterAll(async () => {
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('users').execute();
    });

    describe('ensureInitialAdmin', () => {
        it('should skip when env vars not set', async () => {
            // Mock config without initial admin
            const originalEmail = config.INITIAL_ADMIN_EMAIL;
            const originalPassword = config.INITIAL_ADMIN_PASSWORD;

            (config as any).INITIAL_ADMIN_EMAIL = undefined;
            (config as any).INITIAL_ADMIN_PASSWORD = undefined;

            await bootstrapService.ensureInitialAdmin();

            // No users should be created
            const users = await db.selectFrom('users').selectAll().execute();
            expect(users).toHaveLength(0);

            // Restore
            (config as any).INITIAL_ADMIN_EMAIL = originalEmail;
            (config as any).INITIAL_ADMIN_PASSWORD = originalPassword;
        });

        it('should skip when users already exist', async () => {
            // Create existing user with password
            await createTestUser({ email: 'existing@example.com' });

            const originalEmail = config.INITIAL_ADMIN_EMAIL;
            const originalPassword = config.INITIAL_ADMIN_PASSWORD;

            (config as any).INITIAL_ADMIN_EMAIL = 'admin@example.com';
            (config as any).INITIAL_ADMIN_PASSWORD = 'adminpass123';

            await bootstrapService.ensureInitialAdmin();

            // Only the existing user should be present
            const users = await db.selectFrom('users').selectAll().execute();
            expect(users).toHaveLength(1);
            expect(users[0].email).toBe('existing@example.com');

            // Restore
            (config as any).INITIAL_ADMIN_EMAIL = originalEmail;
            (config as any).INITIAL_ADMIN_PASSWORD = originalPassword;
        });

        it('should create initial admin when no users exist', async () => {
            const originalEmail = config.INITIAL_ADMIN_EMAIL;
            const originalPassword = config.INITIAL_ADMIN_PASSWORD;
            const originalName = config.INITIAL_ADMIN_NAME;

            (config as any).INITIAL_ADMIN_EMAIL = 'newadmin@example.com';
            (config as any).INITIAL_ADMIN_PASSWORD = 'securepassword123';
            (config as any).INITIAL_ADMIN_NAME = 'New Admin';

            await bootstrapService.ensureInitialAdmin();

            // Verify admin was created
            const users = await db.selectFrom('users').selectAll().execute();
            expect(users).toHaveLength(1);
            expect(users[0].email).toBe('newadmin@example.com');
            expect(users[0].name).toBe('New Admin');
            expect(users[0].is_admin).toBe(true);
            expect(users[0].password_hash).toBeTruthy();

            // Verify default user setting was set
            const defaultUserId = await settingsService.getDefaultUserId();
            expect(defaultUserId).toBe(users[0].id);

            // Restore
            (config as any).INITIAL_ADMIN_EMAIL = originalEmail;
            (config as any).INITIAL_ADMIN_PASSWORD = originalPassword;
            (config as any).INITIAL_ADMIN_NAME = originalName;
        });

        it('should use default name when INITIAL_ADMIN_NAME not set', async () => {
            const originalEmail = config.INITIAL_ADMIN_EMAIL;
            const originalPassword = config.INITIAL_ADMIN_PASSWORD;
            const originalName = config.INITIAL_ADMIN_NAME;

            (config as any).INITIAL_ADMIN_EMAIL = 'defaultname@example.com';
            (config as any).INITIAL_ADMIN_PASSWORD = 'password123';
            (config as any).INITIAL_ADMIN_NAME = undefined;

            await bootstrapService.ensureInitialAdmin();

            const user = await db.selectFrom('users').selectAll().executeTakeFirst();
            expect(user?.name).toBe('Admin');

            // Restore
            (config as any).INITIAL_ADMIN_EMAIL = originalEmail;
            (config as any).INITIAL_ADMIN_PASSWORD = originalPassword;
            (config as any).INITIAL_ADMIN_NAME = originalName;
        });
    });

    describe('ensureDefaultSetup', () => {
        it('should log warning when no default user selected', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await bootstrapService.ensureDefaultSetup();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('no default user selected')
            );

            consoleSpy.mockRestore();
        });

        it('should log warning when selected user not found', async () => {
            // Use a valid UUID format that doesn't exist in the database
            await settingsService.set('auth.default_user_id', '00000000-0000-0000-0000-000000000000');

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await bootstrapService.ensureDefaultSetup();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('not found in database')
            );

            consoleSpy.mockRestore();
        });

        it('should cache default user when found', async () => {
            const user = await createTestUser({ email: 'default@example.com' });
            await settingsService.set('auth.default_user_id', user.id);

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await bootstrapService.ensureDefaultSetup();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Default user: default@example.com')
            );

            // Verify cache is populated
            expect(bootstrapService.isInitialized()).toBe(true);

            consoleSpy.mockRestore();
        });
    });

    describe('getDefaultUser', () => {
        it('should return null when no default user configured', async () => {
            const user = await bootstrapService.getDefaultUser();
            expect(user).toBeNull();
        });

        it('should return null when default user not found', async () => {
            // Use a valid UUID format that doesn't exist in the database
            await settingsService.set('auth.default_user_id', '00000000-0000-0000-0000-000000000001');

            const user = await bootstrapService.getDefaultUser();
            expect(user).toBeNull();
        });

        it('should return cached user on subsequent calls', async () => {
            const testUser = await createTestUser({ email: 'cached@example.com' });
            await settingsService.set('auth.default_user_id', testUser.id);

            // First call - loads from DB
            const user1 = await bootstrapService.getDefaultUser();
            expect(user1).toBeDefined();
            expect(user1?.email).toBe('cached@example.com');

            // Second call - should use cache
            const user2 = await bootstrapService.getDefaultUser();
            expect(user2).toBeDefined();
            expect(user2?.id).toBe(user1?.id);
        });

        it('should return user with correct profile structure', async () => {
            const testUser = await createTestUser({
                email: 'profile@example.com',
                name: 'Profile Test',
            });
            await settingsService.set('auth.default_user_id', testUser.id);

            const user = await bootstrapService.getDefaultUser();

            expect(user).toBeDefined();
            expect(user?.id).toBe(testUser.id);
            expect(user?.email).toBe('profile@example.com');
            expect(user?.name).toBe('Profile Test');
            expect(user?.is_admin).toBeDefined();
            expect(user?.disabled).toBeDefined();
            expect(user?.createdAt).toBeInstanceOf(Date);
        });
    });

    describe('clearCache', () => {
        it('should clear the cached default user', async () => {
            const testUser = await createTestUser({ email: 'toclear@example.com' });
            await settingsService.set('auth.default_user_id', testUser.id);

            // Populate cache
            await bootstrapService.getDefaultUser();
            expect(bootstrapService.isInitialized()).toBe(true);

            // Clear cache
            bootstrapService.clearCache();

            // Verify cache is cleared
            expect(bootstrapService.isInitialized()).toBe(false);
        });
    });

    describe('isInitialized', () => {
        it('should return false initially', () => {
            expect(bootstrapService.isInitialized()).toBe(false);
        });

        it('should return true after loading default user', async () => {
            const testUser = await createTestUser();
            await settingsService.set('auth.default_user_id', testUser.id);

            await bootstrapService.getDefaultUser();

            expect(bootstrapService.isInitialized()).toBe(true);
        });

        it('should return false after clearing cache', async () => {
            const testUser = await createTestUser();
            await settingsService.set('auth.default_user_id', testUser.id);

            await bootstrapService.getDefaultUser();
            expect(bootstrapService.isInitialized()).toBe(true);

            bootstrapService.clearCache();
            expect(bootstrapService.isInitialized()).toBe(false);
        });
    });

    describe('runInitialBootstrap', () => {
        it('should call ensureInitialAdmin', async () => {
            const ensureInitialAdminSpy = vi.spyOn(bootstrapService, 'ensureInitialAdmin')
                .mockResolvedValue();

            await bootstrapService.runInitialBootstrap();

            expect(ensureInitialAdminSpy).toHaveBeenCalled();

            ensureInitialAdminSpy.mockRestore();
        });
    });
});
