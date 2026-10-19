import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LdapProvider } from '../../../modules/auth/providers/ldap-provider.js';
import { AuthErrorCode } from '../../../modules/auth/providers/types.js';

// Mock ldapts module
vi.mock('ldapts', () => {
    const mockBind = vi.fn();
    const mockUnbind = vi.fn();
    const mockSearch = vi.fn();

    return {
        Client: vi.fn().mockImplementation(function () { return {
            bind: mockBind,
            unbind: mockUnbind,
            search: mockSearch,
        }; }),
        __mockBind: mockBind,
        __mockUnbind: mockUnbind,
        __mockSearch: mockSearch,
    };
});

// Get the mock functions
async function getMocks() {
    const ldapts = await import('ldapts');
    return {
        Client: ldapts.Client,
        mockBind: (ldapts as any).__mockBind,
        mockUnbind: (ldapts as any).__mockUnbind,
        mockSearch: (ldapts as any).__mockSearch,
    };
}

describe('LdapProvider', () => {
    let ldapProvider: LdapProvider;
    let mocks: Awaited<ReturnType<typeof getMocks>>;

    const validConfig = {
        id: 'ldap-test-id',
        type: 'ldap' as const,
        name: 'LDAP Server',
        slug: 'ldap',
        enabled: true,
        isDefault: false,
        displayOrder: 1,
        icon: 'server',
        config: {
            url: 'ldap://ldap.example.com:389',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'adminpassword',
            searchBase: 'ou=users,dc=example,dc=com',
            searchFilter: '(uid={{username}})',
            userAttributes: {
                email: 'mail',
                name: 'cn',
            },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        mocks = await getMocks();
        vi.clearAllMocks();

        // Default mock implementations
        mocks.mockBind.mockResolvedValue(undefined);
        mocks.mockUnbind.mockResolvedValue(undefined);
        mocks.mockSearch.mockResolvedValue({
            searchEntries: [{
                dn: 'uid=testuser,ou=users,dc=example,dc=com',
                mail: 'testuser@example.com',
                cn: 'Test User',
            }],
        });

        ldapProvider = new LdapProvider(validConfig);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('should set type to ldap', () => {
            expect(ldapProvider.type).toBe('ldap');
        });

        it('should store config', () => {
            expect(ldapProvider.config).toEqual(validConfig);
        });
    });

    describe('authenticate', () => {
        it('should return error when username is missing', async () => {
            const result = await ldapProvider.authenticate({ password: 'test123' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Username and password are required');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when password is missing', async () => {
            const result = await ldapProvider.authenticate({ username: 'testuser' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Username and password are required');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when both username and password are missing', async () => {
            const result = await ldapProvider.authenticate({});

            expect(result.success).toBe(false);
            expect(result.error).toBe('Username and password are required');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when user not found in LDAP', async () => {
            mocks.mockSearch.mockResolvedValueOnce({ searchEntries: [] });

            const result = await ldapProvider.authenticate({
                username: 'nonexistent',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid username or password');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when user DN cannot be determined', async () => {
            mocks.mockSearch.mockResolvedValueOnce({
                searchEntries: [{
                    mail: 'testuser@example.com',
                    cn: 'Test User',
                    // No dn or distinguishedName
                }],
            });

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Could not determine user DN');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_ERROR);
        });

        it('should return error when user bind fails (wrong password)', async () => {
            // First bind (service account) succeeds
            mocks.mockBind.mockResolvedValueOnce(undefined);
            // Second bind (user) fails
            mocks.mockBind.mockRejectedValueOnce(new Error('Invalid credentials'));

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'wrongpassword',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid username or password');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when user has no email', async () => {
            mocks.mockSearch.mockResolvedValueOnce({
                searchEntries: [{
                    dn: 'uid=testuser,ou=users,dc=example,dc=com',
                    cn: 'Test User',
                    // No mail attribute
                }],
            });

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('User account does not have an email address configured');
            expect(result.errorCode).toBe(AuthErrorCode.MISSING_EMAIL);
        });

        it('should return success with valid credentials', async () => {
            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'correctpassword',
            });

            expect(result.success).toBe(true);
            expect(result.providerUserId).toBe('uid=testuser,ou=users,dc=example,dc=com');
            expect(result.email).toBe('testuser@example.com');
            expect(result.name).toBe('Test User');
            expect(result.metadata).toEqual({
                dn: 'uid=testuser,ou=users,dc=example,dc=com',
                username: 'testuser',
                attributes: {
                    email: 'testuser@example.com',
                    name: 'Test User',
                },
            });
        });

        it('should use distinguishedName if dn is not present', async () => {
            mocks.mockSearch.mockResolvedValueOnce({
                searchEntries: [{
                    distinguishedName: 'CN=Test User,OU=Users,DC=example,DC=com',
                    mail: 'testuser@example.com',
                    cn: 'Test User',
                }],
            });

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(true);
            expect(result.providerUserId).toBe('CN=Test User,OU=Users,DC=example,DC=com');
        });

        it('should handle array email attribute', async () => {
            mocks.mockSearch.mockResolvedValueOnce({
                searchEntries: [{
                    dn: 'uid=testuser,ou=users,dc=example,dc=com',
                    mail: ['primary@example.com', 'alias@example.com'],
                    cn: 'Test User',
                }],
            });

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(true);
            expect(result.email).toBe('primary@example.com');
        });

        it('should use username as name if name attribute not present', async () => {
            mocks.mockSearch.mockResolvedValueOnce({
                searchEntries: [{
                    dn: 'uid=testuser,ou=users,dc=example,dc=com',
                    mail: 'testuser@example.com',
                    // No cn attribute
                }],
            });

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(true);
            expect(result.name).toBe('testuser');
        });

        it('should normalize email to lowercase', async () => {
            mocks.mockSearch.mockResolvedValueOnce({
                searchEntries: [{
                    dn: 'uid=testuser,ou=users,dc=example,dc=com',
                    mail: 'TestUser@EXAMPLE.COM',
                    cn: 'Test User',
                }],
            });

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(true);
            expect(result.email).toBe('testuser@example.com');
        });

        it('should escape LDAP filter special characters', async () => {
            await ldapProvider.authenticate({
                username: 'test*user()',
                password: 'password123',
            });

            // Check that search was called with escaped username
            expect(mocks.mockSearch).toHaveBeenCalledWith(
                'ou=users,dc=example,dc=com',
                expect.objectContaining({
                    filter: '(uid=test\\2auser\\28\\29)',
                })
            );
        });

        it('should handle connection errors', async () => {
            mocks.mockBind.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Directory service is unavailable');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_UNAVAILABLE);
        });

        it('should handle timeout errors', async () => {
            mocks.mockBind.mockRejectedValueOnce(new Error('timeout'));

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Directory service is unavailable');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_UNAVAILABLE);
        });

        it('should handle invalid service account credentials', async () => {
            mocks.mockBind.mockRejectedValueOnce(new Error('Invalid credentials (49)'));

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid service account credentials. Please contact your administrator.');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_ERROR);
        });

        it('should handle generic LDAP errors', async () => {
            mocks.mockBind.mockRejectedValueOnce(new Error('Some LDAP error'));

            const result = await ldapProvider.authenticate({
                username: 'testuser',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('LDAP error: Some LDAP error');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_ERROR);
        });
    });

    describe('supportsRedirect', () => {
        it('should return false', () => {
            expect(ldapProvider.supportsRedirect()).toBe(false);
        });
    });

    describe('validateConfig', () => {
        it('should return true for valid config', () => {
            expect(ldapProvider.validateConfig()).toBe(true);
        });

        it('should return false when url is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, url: '' },
            };
            const provider = new LdapProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });

        it('should return false when bindDn is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, bindDn: '' },
            };
            const provider = new LdapProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });

        it('should return false when bindPassword is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, bindPassword: '' },
            };
            const provider = new LdapProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });

        it('should return false when searchBase is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, searchBase: '' },
            };
            const provider = new LdapProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });

        it('should return false when searchFilter is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, searchFilter: '' },
            };
            const provider = new LdapProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });
    });

    describe('testConnection', () => {
        it('should return success when connection works', async () => {
            const result = await ldapProvider.testConnection();

            expect(result.success).toBe(true);
            expect(result.message).toBe('Successfully connected to ldap://ldap.example.com:389');
        });

        it('should return failure for invalid config', async () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, url: '' },
            };
            const provider = new LdapProvider(invalidConfig);

            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid configuration');
        });

        it('should return failure when bind fails', async () => {
            mocks.mockBind.mockRejectedValueOnce(new Error('Connection refused'));

            const result = await ldapProvider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to connect: Connection refused');
        });
    });
});
