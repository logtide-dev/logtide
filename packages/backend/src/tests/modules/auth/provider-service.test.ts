import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { providerService, ProviderService } from '../../../modules/auth/provider-service.js';
import { providerRegistry } from '../../../modules/auth/providers/index.js';
import { createTestUser } from '../../helpers/factories.js';

// Spy on the provider registry methods instead of mocking the entire module
const invalidateCacheSpy = vi.spyOn(providerRegistry, 'invalidateCache').mockResolvedValue(undefined);
const getProviderByIdSpy = vi.spyOn(providerRegistry, 'getProviderById');

describe('ProviderService', () => {
  beforeEach(async () => {
    // Clean up tables
    await db.deleteFrom('user_identities').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();

    // Delete non-local providers
    await db.deleteFrom('auth_providers').where('slug', '!=', 'local').execute();

    // Ensure local provider exists
    const localExists = await db.selectFrom('auth_providers')
      .select('id')
      .where('slug', '=', 'local')
      .executeTakeFirst();

    if (!localExists) {
      await db.insertInto('auth_providers').values({
        type: 'local',
        name: 'Email & Password',
        slug: 'local',
        enabled: true,
        is_default: true,
        display_order: 0,
        icon: 'mail',
        config: {},
      }).execute();
    }

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup
    await db.deleteFrom('user_identities').execute();
    await db.deleteFrom('auth_providers').where('slug', '!=', 'local').execute();
  });

  describe('getAllProviders', () => {
    it('should return all providers ordered by display_order', async () => {
      const providers = await providerService.getAllProviders();

      expect(Array.isArray(providers)).toBe(true);
      // Should at least have the local provider
      const localProvider = providers.find((p) => p.slug === 'local');
      expect(localProvider).toBeDefined();
    });

    it('should return providers with correct structure', async () => {
      const providers = await providerService.getAllProviders();

      for (const provider of providers) {
        expect(provider).toHaveProperty('id');
        expect(provider).toHaveProperty('type');
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('slug');
        expect(provider).toHaveProperty('enabled');
        expect(provider).toHaveProperty('isDefault');
        expect(provider).toHaveProperty('displayOrder');
        expect(provider).toHaveProperty('config');
        expect(provider).toHaveProperty('createdAt');
        expect(provider).toHaveProperty('updatedAt');
      }
    });
  });

  describe('getProviderById', () => {
    it('should return null for non-existent provider', async () => {
      const result = await providerService.getProviderById('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('should return provider by ID', async () => {
      const providers = await providerService.getAllProviders();
      const localProvider = providers.find((p) => p.slug === 'local');

      if (localProvider) {
        const result = await providerService.getProviderById(localProvider.id);
        expect(result).not.toBeNull();
        expect(result?.slug).toBe('local');
      }
    });
  });

  describe('createProvider', () => {
    describe('OIDC Provider', () => {
      it('should create a valid OIDC provider', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Test OIDC',
          slug: 'test-oidc',
          config: {
            issuerUrl: 'https://auth.example.com',
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
          },
        };

        const result = await providerService.createProvider(input);

        expect(result.name).toBe('Test OIDC');
        expect(result.slug).toBe('test-oidc');
        expect(result.type).toBe('oidc');
        expect(result.enabled).toBe(true);
        expect(invalidateCacheSpy).toHaveBeenCalled();
      });

      it('should reject OIDC without issuerUrl', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Invalid OIDC',
          slug: 'invalid-oidc',
          config: {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow('Issuer URL is required');
      });

      it('should reject OIDC without clientId', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Invalid OIDC',
          slug: 'invalid-oidc-2',
          config: {
            issuerUrl: 'https://auth.example.com',
            clientSecret: 'test-client-secret',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow('Client ID is required');
      });

      it('should reject OIDC without clientSecret', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Invalid OIDC',
          slug: 'invalid-oidc-3',
          config: {
            issuerUrl: 'https://auth.example.com',
            clientId: 'test-client-id',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow('Client Secret is required');
      });

      it('should reject OIDC with invalid issuerUrl', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Invalid OIDC',
          slug: 'invalid-oidc-4',
          config: {
            issuerUrl: 'not-a-valid-url',
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow('Invalid Issuer URL format');
      });
    });

    describe('LDAP Provider', () => {
      it('should create a valid LDAP provider', async () => {
        const input = {
          type: 'ldap' as const,
          name: 'Test LDAP',
          slug: 'test-ldap',
          config: {
            url: 'ldaps://ldap.example.com',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'secret',
            searchBase: 'ou=users,dc=example,dc=com',
            searchFilter: '(uid={{username}})',
          },
        };

        const result = await providerService.createProvider(input);

        expect(result.name).toBe('Test LDAP');
        expect(result.slug).toBe('test-ldap');
        expect(result.type).toBe('ldap');
      });

      it('should reject LDAP without url', async () => {
        const input = {
          type: 'ldap' as const,
          name: 'Invalid LDAP',
          slug: 'invalid-ldap',
          config: {
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'secret',
            searchBase: 'ou=users,dc=example,dc=com',
            searchFilter: '(uid={{username}})',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow('LDAP URL is required');
      });

      it('should reject LDAP without bindDn', async () => {
        const input = {
          type: 'ldap' as const,
          name: 'Invalid LDAP',
          slug: 'invalid-ldap-2',
          config: {
            url: 'ldaps://ldap.example.com',
            bindPassword: 'secret',
            searchBase: 'ou=users,dc=example,dc=com',
            searchFilter: '(uid={{username}})',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow('Bind DN is required');
      });

      it('should reject LDAP without searchFilter placeholder', async () => {
        const input = {
          type: 'ldap' as const,
          name: 'Invalid LDAP',
          slug: 'invalid-ldap-3',
          config: {
            url: 'ldaps://ldap.example.com',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'secret',
            searchBase: 'ou=users,dc=example,dc=com',
            searchFilter: '(uid=user)', // Missing {{username}} placeholder
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow(
          'Search Filter must contain {{username}} placeholder'
        );
      });

      it('should reject LDAP with invalid URL protocol', async () => {
        const input = {
          type: 'ldap' as const,
          name: 'Invalid LDAP',
          slug: 'invalid-ldap-4',
          config: {
            url: 'https://ldap.example.com', // Wrong protocol
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'secret',
            searchBase: 'ou=users,dc=example,dc=com',
            searchFilter: '(uid={{username}})',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow(
          'LDAP URL must start with ldap:// or ldaps://'
        );
      });
    });

    describe('Slug Validation', () => {
      it('should reject invalid slug format', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Test',
          slug: 'INVALID_SLUG!',
          config: {
            issuerUrl: 'https://auth.example.com',
            clientId: 'test',
            clientSecret: 'test',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow(
          'Slug must be lowercase alphanumeric with hyphens'
        );
      });

      it('should reject slug that is too short', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Test',
          slug: 'a', // Too short
          config: {
            issuerUrl: 'https://auth.example.com',
            clientId: 'test',
            clientSecret: 'test',
          },
        };

        await expect(providerService.createProvider(input)).rejects.toThrow(
          'Slug must be lowercase alphanumeric with hyphens'
        );
      });

      it('should reject duplicate slug', async () => {
        const input = {
          type: 'oidc' as const,
          name: 'Test',
          slug: 'unique-slug',
          config: {
            issuerUrl: 'https://auth.example.com',
            clientId: 'test',
            clientSecret: 'test',
          },
        };

        await providerService.createProvider(input);

        await expect(providerService.createProvider({ ...input, name: 'Test 2' })).rejects.toThrow(
          "Provider with slug 'unique-slug' already exists"
        );
      });
    });

    it('should set custom display order', async () => {
      const input = {
        type: 'oidc' as const,
        name: 'Test',
        slug: 'test-order',
        displayOrder: 100,
        config: {
          issuerUrl: 'https://auth.example.com',
          clientId: 'test',
          clientSecret: 'test',
        },
      };

      const result = await providerService.createProvider(input);

      expect(result.displayOrder).toBe(100);
    });

    it('should set enabled to false when specified', async () => {
      const input = {
        type: 'oidc' as const,
        name: 'Disabled Provider',
        slug: 'disabled-provider',
        enabled: false,
        config: {
          issuerUrl: 'https://auth.example.com',
          clientId: 'test',
          clientSecret: 'test',
        },
      };

      const result = await providerService.createProvider(input);

      expect(result.enabled).toBe(false);
    });
  });

  describe('updateProvider', () => {
    let testProviderId: string;

    beforeEach(async () => {
      // Create a test provider
      const provider = await providerService.createProvider({
        type: 'oidc',
        name: 'Update Test',
        slug: 'update-test',
        config: {
          issuerUrl: 'https://auth.example.com',
          clientId: 'test',
          clientSecret: 'test',
        },
      });
      testProviderId = provider.id;
    });

    it('should update provider name', async () => {
      const result = await providerService.updateProvider(testProviderId, {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(invalidateCacheSpy).toHaveBeenCalled();
    });

    it('should update provider enabled state', async () => {
      const result = await providerService.updateProvider(testProviderId, {
        enabled: false,
      });

      expect(result.enabled).toBe(false);
    });

    it('should update provider config', async () => {
      const result = await providerService.updateProvider(testProviderId, {
        config: {
          issuerUrl: 'https://new-auth.example.com',
          clientId: 'new-client',
          clientSecret: 'new-secret',
        },
      });

      expect(result.config).toHaveProperty('issuerUrl', 'https://new-auth.example.com');
    });

    it('should throw for non-existent provider', async () => {
      await expect(
        providerService.updateProvider('00000000-0000-0000-0000-000000000000', {
          name: 'Test',
        })
      ).rejects.toThrow('Provider not found');
    });

    it('should not allow disabling local provider', async () => {
      const providers = await providerService.getAllProviders();
      const localProvider = providers.find((p) => p.slug === 'local');

      if (localProvider) {
        await expect(
          providerService.updateProvider(localProvider.id, {
            enabled: false,
          })
        ).rejects.toThrow('Cannot disable the local authentication provider');
      }
    });

    it('should validate config on update', async () => {
      await expect(
        providerService.updateProvider(testProviderId, {
          config: {
            issuerUrl: 'invalid-url',
            clientId: 'test',
            clientSecret: 'test',
          },
        })
      ).rejects.toThrow('Invalid Issuer URL format');
    });
  });

  describe('deleteProvider', () => {
    let testProviderId: string;

    beforeEach(async () => {
      const provider = await providerService.createProvider({
        type: 'oidc',
        name: 'Delete Test',
        slug: 'delete-test',
        config: {
          issuerUrl: 'https://auth.example.com',
          clientId: 'test',
          clientSecret: 'test',
        },
      });
      testProviderId = provider.id;
    });

    it('should delete a provider', async () => {
      await providerService.deleteProvider(testProviderId);

      const result = await providerService.getProviderById(testProviderId);
      expect(result).toBeNull();
      expect(invalidateCacheSpy).toHaveBeenCalled();
    });

    it('should throw for non-existent provider', async () => {
      await expect(
        providerService.deleteProvider('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Provider not found');
    });

    it('should not allow deleting local provider', async () => {
      const providers = await providerService.getAllProviders();
      const localProvider = providers.find((p) => p.slug === 'local');

      if (localProvider) {
        await expect(providerService.deleteProvider(localProvider.id)).rejects.toThrow(
          'Cannot delete the local authentication provider'
        );
      }
    });

    it('should not allow deleting provider with linked users', async () => {
      // Create a user and link identity
      const user = await createTestUser();

      await db
        .insertInto('user_identities')
        .values({
          user_id: user.id,
          provider_id: testProviderId,
          provider_user_id: 'external-user-123',
          metadata: {},
        })
        .execute();

      await expect(providerService.deleteProvider(testProviderId)).rejects.toThrow(
        'Cannot delete provider with'
      );
    });
  });

  describe('testProviderConnection', () => {
    it('should return not found for non-existent provider', async () => {
      getProviderByIdSpy.mockResolvedValue(null);

      const result = await providerService.testProviderConnection(
        '00000000-0000-0000-0000-000000000000'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Provider not found');
    });

    it('should return success when testConnection is not available', async () => {
      getProviderByIdSpy.mockResolvedValue({
        config: { id: 'test', name: 'Test', slug: 'test', type: 'oidc' } as any,
        authenticate: vi.fn(),
        supportsRedirect: () => false,
      } as any);

      const result = await providerService.testProviderConnection('test-id');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection test not available for this provider type');
    });

    it('should call testConnection when available', async () => {
      const mockTestConnection = vi.fn().mockResolvedValue({
        success: true,
        message: 'Connection successful',
      });

      getProviderByIdSpy.mockResolvedValue({
        config: { id: 'test', name: 'Test', slug: 'test', type: 'ldap' } as any,
        authenticate: vi.fn(),
        supportsRedirect: () => false,
        testConnection: mockTestConnection,
      } as any);

      const result = await providerService.testProviderConnection('test-id');

      expect(mockTestConnection).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
    });
  });

  describe('reorderProviders', () => {
    it('should update display order for providers', async () => {
      // Create multiple providers
      const provider1 = await providerService.createProvider({
        type: 'oidc',
        name: 'Provider 1',
        slug: 'provider-1',
        config: {
          issuerUrl: 'https://auth1.example.com',
          clientId: 'test',
          clientSecret: 'test',
        },
      });

      const provider2 = await providerService.createProvider({
        type: 'oidc',
        name: 'Provider 2',
        slug: 'provider-2',
        config: {
          issuerUrl: 'https://auth2.example.com',
          clientId: 'test',
          clientSecret: 'test',
        },
      });

      // Reorder
      await providerService.reorderProviders([provider2.id, provider1.id]);

      expect(invalidateCacheSpy).toHaveBeenCalled();

      // Verify order
      const updated1 = await providerService.getProviderById(provider1.id);
      const updated2 = await providerService.getProviderById(provider2.id);

      expect(updated2?.displayOrder).toBe(0);
      expect(updated1?.displayOrder).toBe(1);
    });
  });

  describe('singleton and class', () => {
    it('should be a singleton export', () => {
      expect(providerService).toBeInstanceOf(ProviderService);
    });

    it('should allow creating new instances', () => {
      const newService = new ProviderService();
      expect(newService).toBeInstanceOf(ProviderService);
    });
  });
});
