import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { ProviderRegistry } from '../../../modules/auth/providers/registry.js';
import { CacheManager } from '../../../utils/cache.js';

describe('ProviderRegistry', () => {
    let registry: ProviderRegistry;
    let localProviderId: string;

    beforeEach(async () => {
        // Create fresh registry for each test
        registry = new ProviderRegistry();

        // Clear any cached data
        await CacheManager.delete('auth:providers:all').catch(() => {});
        await CacheManager.delete('auth:provider:local').catch(() => {});

        // Clean up auth providers (except local)
        await db.deleteFrom('user_identities').execute();
        await db.deleteFrom('oidc_states').execute();
        await db.deleteFrom('auth_providers').where('slug', '!=', 'local').execute();

        // Ensure local provider exists
        const localExists = await db.selectFrom('auth_providers')
            .select(['id'])
            .where('slug', '=', 'local')
            .executeTakeFirst();

        if (localExists) {
            localProviderId = localExists.id;
        } else {
            const result = await db.insertInto('auth_providers').values({
                type: 'local',
                name: 'Email & Password',
                slug: 'local',
                enabled: true,
                is_default: true,
                display_order: 0,
                icon: 'mail',
                config: {},
            }).returning(['id']).executeTakeFirstOrThrow();
            localProviderId = result.id;
        }
    });

    afterEach(async () => {
        await db.deleteFrom('user_identities').execute();
        await db.deleteFrom('oidc_states').execute();
        await db.deleteFrom('auth_providers').where('slug', '!=', 'local').execute();

        // Clear cache after each test
        await CacheManager.delete('auth:providers:all').catch(() => {});
    });

    describe('initialize', () => {
        it('should load providers from database', async () => {
            await registry.initialize();

            // Should be able to get the local provider after initialization
            const localProvider = await registry.getProvider('local');
            expect(localProvider).not.toBeNull();
            expect(localProvider?.config.slug).toBe('local');
        });

        it('should load multiple providers', async () => {
            // Create another OIDC provider for testing
            await db.insertInto('auth_providers').values({
                type: 'oidc',
                name: 'Test OIDC',
                slug: 'test-oidc',
                enabled: true,
                is_default: false,
                display_order: 1,
                config: {
                    issuerUrl: 'https://issuer.example.com',
                    clientId: 'test-client',
                    clientSecret: 'test-secret',
                },
            }).execute();

            await registry.initialize();

            const providers = await registry.getEnabledProviders();
            expect(providers.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('reloadProviders', () => {
        it('should reload providers from database', async () => {
            await registry.reloadProviders();

            const providers = await registry.getEnabledProviders();
            expect(providers.length).toBeGreaterThanOrEqual(1);
            expect(providers.some(p => p.config.slug === 'local')).toBe(true);
        });

        it('should handle provider creation errors gracefully', async () => {
            // Create a provider with an unknown type (will fail to create)
            await db.insertInto('auth_providers').values({
                type: 'unknown_type',
                name: 'Unknown Provider',
                slug: 'unknown',
                enabled: true,
                is_default: false,
                display_order: 99,
                config: {},
            }).execute();

            // Should not throw
            await expect(registry.reloadProviders()).resolves.not.toThrow();

            // Clean up
            await db.deleteFrom('auth_providers').where('slug', '=', 'unknown').execute();
        });
    });

    describe('getProvider', () => {
        it('should return null for non-existent provider', async () => {
            await registry.initialize();

            const provider = await registry.getProvider('nonexistent');
            expect(provider).toBeNull();
        });

        it('should return provider for valid slug', async () => {
            await registry.initialize();

            const provider = await registry.getProvider('local');
            expect(provider).not.toBeNull();
            expect(provider?.config.slug).toBe('local');
        });

        it('should return null for disabled provider', async () => {
            // Create a disabled provider
            await db.insertInto('auth_providers').values({
                type: 'oidc',
                name: 'Disabled OIDC',
                slug: 'disabled-oidc',
                enabled: false,
                is_default: false,
                display_order: 10,
                config: {
                    issuerUrl: 'https://disabled.example.com',
                    clientId: 'client',
                    clientSecret: 'secret',
                },
            }).execute();

            await registry.initialize();

            const provider = await registry.getProvider('disabled-oidc');
            expect(provider).toBeNull();

            // Clean up
            await db.deleteFrom('auth_providers').where('slug', '=', 'disabled-oidc').execute();
        });

        it('should initialize if not already initialized', async () => {
            // Don't call initialize() explicitly
            const provider = await registry.getProvider('local');
            expect(provider).not.toBeNull();
        });

        it('should use cached provider on subsequent calls', async () => {
            await registry.initialize();

            // First call
            const provider1 = await registry.getProvider('local');
            expect(provider1).not.toBeNull();

            // Second call should use cached version
            const provider2 = await registry.getProvider('local');
            expect(provider2).not.toBeNull();
            expect(provider2?.config.id).toBe(provider1?.config.id);
        });
    });

    describe('getProviderById', () => {
        it('should return null for non-existent provider ID', async () => {
            await registry.initialize();

            const provider = await registry.getProviderById('00000000-0000-0000-0000-000000000000');
            expect(provider).toBeNull();
        });

        it('should return provider for valid ID', async () => {
            await registry.initialize();

            const provider = await registry.getProviderById(localProviderId);
            expect(provider).not.toBeNull();
            expect(provider?.config.id).toBe(localProviderId);
        });

        it('should initialize if not already initialized', async () => {
            const provider = await registry.getProviderById(localProviderId);
            expect(provider).not.toBeNull();
        });

        it('should return null for disabled provider', async () => {
            // Create a disabled provider
            const result = await db.insertInto('auth_providers').values({
                type: 'oidc',
                name: 'Disabled OIDC',
                slug: 'disabled-by-id',
                enabled: false,
                is_default: false,
                display_order: 10,
                config: {
                    issuerUrl: 'https://disabled.example.com',
                    clientId: 'client',
                    clientSecret: 'secret',
                },
            }).returning(['id']).executeTakeFirstOrThrow();

            await registry.initialize();

            const provider = await registry.getProviderById(result.id);
            expect(provider).toBeNull();

            // Clean up
            await db.deleteFrom('auth_providers').where('id', '=', result.id).execute();
        });
    });

    describe('getEnabledProviders', () => {
        it('should return only enabled providers', async () => {
            // Create enabled and disabled providers
            await db.insertInto('auth_providers').values([
                {
                    type: 'oidc',
                    name: 'Enabled OIDC',
                    slug: 'enabled-oidc',
                    enabled: true,
                    is_default: false,
                    display_order: 2,
                    config: {
                        issuerUrl: 'https://enabled.example.com',
                        clientId: 'client',
                        clientSecret: 'secret',
                    },
                },
                {
                    type: 'oidc',
                    name: 'Disabled OIDC',
                    slug: 'disabled-oidc-2',
                    enabled: false,
                    is_default: false,
                    display_order: 3,
                    config: {
                        issuerUrl: 'https://disabled.example.com',
                        clientId: 'client',
                        clientSecret: 'secret',
                    },
                },
            ]).execute();

            await registry.initialize();

            const providers = await registry.getEnabledProviders();

            const slugs = providers.map(p => p.config.slug);
            expect(slugs).toContain('local');
            expect(slugs).toContain('enabled-oidc');
            expect(slugs).not.toContain('disabled-oidc-2');

            // Clean up
            await db.deleteFrom('auth_providers')
                .where('slug', 'in', ['enabled-oidc', 'disabled-oidc-2'])
                .execute();
        });

        it('should sort by display order', async () => {
            // Create providers with different display orders
            await db.insertInto('auth_providers').values([
                {
                    type: 'oidc',
                    name: 'Second',
                    slug: 'second',
                    enabled: true,
                    is_default: false,
                    display_order: 2,
                    config: {
                        issuerUrl: 'https://second.example.com',
                        clientId: 'client',
                        clientSecret: 'secret',
                    },
                },
                {
                    type: 'oidc',
                    name: 'First',
                    slug: 'first',
                    enabled: true,
                    is_default: false,
                    display_order: 1,
                    config: {
                        issuerUrl: 'https://first.example.com',
                        clientId: 'client',
                        clientSecret: 'secret',
                    },
                },
            ]).execute();

            await registry.initialize();

            const providers = await registry.getEnabledProviders();
            const slugs = providers.map(p => p.config.slug);

            // local has display_order 0, first has 1, second has 2
            expect(slugs.indexOf('local')).toBeLessThan(slugs.indexOf('first'));
            expect(slugs.indexOf('first')).toBeLessThan(slugs.indexOf('second'));

            // Clean up
            await db.deleteFrom('auth_providers')
                .where('slug', 'in', ['first', 'second'])
                .execute();
        });
    });

    describe('getPublicProviders', () => {
        it('should return public provider info', async () => {
            await registry.initialize();

            const publicProviders = await registry.getPublicProviders();

            expect(publicProviders.length).toBeGreaterThanOrEqual(1);

            const localPublic = publicProviders.find(p => p.slug === 'local');
            expect(localPublic).toBeDefined();
            expect(localPublic?.id).toBe(localProviderId);
            expect(localPublic?.type).toBe('local');
            expect(localPublic?.name).toBe('Email & Password');
            expect(localPublic?.supportsRedirect).toBe(false);
        });

        it('should include supportsRedirect for each provider', async () => {
            await db.insertInto('auth_providers').values({
                type: 'oidc',
                name: 'OIDC Provider',
                slug: 'oidc-redirect',
                enabled: true,
                is_default: false,
                display_order: 1,
                config: {
                    issuerUrl: 'https://oidc.example.com',
                    clientId: 'client',
                    clientSecret: 'secret',
                },
            }).execute();

            await registry.initialize();

            const publicProviders = await registry.getPublicProviders();

            const localProvider = publicProviders.find(p => p.slug === 'local');
            const oidcProvider = publicProviders.find(p => p.slug === 'oidc-redirect');

            expect(localProvider?.supportsRedirect).toBe(false);
            expect(oidcProvider?.supportsRedirect).toBe(true);

            // Clean up
            await db.deleteFrom('auth_providers').where('slug', '=', 'oidc-redirect').execute();
        });
    });

    describe('getLocalProvider', () => {
        it('should return the local provider', async () => {
            await registry.initialize();

            const provider = await registry.getLocalProvider();
            expect(provider).not.toBeNull();
            expect(provider?.config.slug).toBe('local');
            expect(provider?.type).toBe('local');
        });

        it('should return null if local provider is disabled', async () => {
            // Disable local provider temporarily
            await db.updateTable('auth_providers')
                .set({ enabled: false })
                .where('slug', '=', 'local')
                .execute();

            await registry.initialize();

            const provider = await registry.getLocalProvider();
            expect(provider).toBeNull();

            // Re-enable local provider
            await db.updateTable('auth_providers')
                .set({ enabled: true })
                .where('slug', '=', 'local')
                .execute();
        });
    });

    describe('invalidateCache', () => {
        it('should clear providers and allow reload', async () => {
            await registry.initialize();

            // Verify we have providers
            const providersBefore = await registry.getEnabledProviders();
            expect(providersBefore.length).toBeGreaterThan(0);

            await registry.invalidateCache();

            // After invalidation, getEnabledProviders should still work (will re-initialize)
            const providersAfter = await registry.getEnabledProviders();
            expect(providersAfter.length).toBeGreaterThan(0);
        });

        it('should pick up new providers after invalidation', async () => {
            await registry.initialize();

            const providersBefore = await registry.getEnabledProviders();
            const countBefore = providersBefore.length;

            // Add a new provider
            await db.insertInto('auth_providers').values({
                type: 'oidc',
                name: 'New OIDC',
                slug: 'new-oidc',
                enabled: true,
                is_default: false,
                display_order: 5,
                config: {
                    issuerUrl: 'https://new.example.com',
                    clientId: 'client',
                    clientSecret: 'secret',
                },
            }).execute();

            // Invalidate cache
            await registry.invalidateCache();

            // Get providers again
            const providersAfter = await registry.getEnabledProviders();
            expect(providersAfter.length).toBe(countBefore + 1);
            expect(providersAfter.some(p => p.config.slug === 'new-oidc')).toBe(true);

            // Clean up
            await db.deleteFrom('auth_providers').where('slug', '=', 'new-oidc').execute();
        });
    });
});
