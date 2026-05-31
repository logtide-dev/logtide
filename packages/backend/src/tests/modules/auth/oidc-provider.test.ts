import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OidcProvider } from '../../../modules/auth/providers/oidc-provider.js';
import { AuthErrorCode } from '../../../modules/auth/providers/types.js';

// Mock openid-client module
vi.mock('openid-client', () => {
    const mockDiscovery = vi.fn();
    const mockBuildAuthorizationUrl = vi.fn();
    const mockAuthorizationCodeGrant = vi.fn();
    const mockRandomPKCECodeVerifier = vi.fn();
    const mockCalculatePKCECodeChallenge = vi.fn();
    const mockAllowInsecureRequests = vi.fn();
    const mockClientSecretPost = vi.fn();

    return {
        discovery: mockDiscovery,
        buildAuthorizationUrl: mockBuildAuthorizationUrl,
        authorizationCodeGrant: mockAuthorizationCodeGrant,
        randomPKCECodeVerifier: mockRandomPKCECodeVerifier,
        calculatePKCECodeChallenge: mockCalculatePKCECodeChallenge,
        allowInsecureRequests: mockAllowInsecureRequests,
        ClientSecretPost: mockClientSecretPost,
        __mockDiscovery: mockDiscovery,
        __mockBuildAuthorizationUrl: mockBuildAuthorizationUrl,
        __mockAuthorizationCodeGrant: mockAuthorizationCodeGrant,
        __mockRandomPKCECodeVerifier: mockRandomPKCECodeVerifier,
        __mockCalculatePKCECodeChallenge: mockCalculatePKCECodeChallenge,
        __mockAllowInsecureRequests: mockAllowInsecureRequests,
        __mockClientSecretPost: mockClientSecretPost,
    };
});

// Get the mock functions
async function getMocks() {
    const oidcClient = await import('openid-client');
    return {
        mockDiscovery: (oidcClient as any).__mockDiscovery,
        mockBuildAuthorizationUrl: (oidcClient as any).__mockBuildAuthorizationUrl,
        mockAuthorizationCodeGrant: (oidcClient as any).__mockAuthorizationCodeGrant,
        mockRandomPKCECodeVerifier: (oidcClient as any).__mockRandomPKCECodeVerifier,
        mockCalculatePKCECodeChallenge: (oidcClient as any).__mockCalculatePKCECodeChallenge,
        mockAllowInsecureRequests: (oidcClient as any).__mockAllowInsecureRequests,
        mockClientSecretPost: (oidcClient as any).__mockClientSecretPost,
    };
}

describe('OidcProvider', () => {
    let oidcProvider: OidcProvider;
    let mocks: Awaited<ReturnType<typeof getMocks>>;

    const validConfig = {
        id: 'oidc-test-id',
        type: 'oidc' as const,
        name: 'OIDC Provider',
        slug: 'oidc',
        enabled: true,
        isDefault: false,
        displayOrder: 1,
        icon: 'lock',
        config: {
            issuerUrl: 'https://auth.example.com',
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            scopes: ['openid', 'email', 'profile'],
            emailClaim: 'email',
            nameClaim: 'name',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockIssuerConfig = {
        serverMetadata: () => ({
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
        }),
    };

    beforeEach(async () => {
        mocks = await getMocks();
        vi.clearAllMocks();

        // Default mock implementations
        mocks.mockDiscovery.mockResolvedValue(mockIssuerConfig);
        mocks.mockRandomPKCECodeVerifier.mockReturnValue('test-code-verifier');
        mocks.mockCalculatePKCECodeChallenge.mockResolvedValue('test-code-challenge');
        mocks.mockClientSecretPost.mockReturnValue({});
        mocks.mockBuildAuthorizationUrl.mockReturnValue(new URL('https://auth.example.com/authorize?client_id=test'));

        oidcProvider = new OidcProvider(validConfig);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('should set type to oidc', () => {
            expect(oidcProvider.type).toBe('oidc');
        });

        it('should store config', () => {
            expect(oidcProvider.config).toEqual(validConfig);
        });
    });

    describe('authenticate', () => {
        it('should return error indicating redirect flow is required', async () => {
            const result = await oidcProvider.authenticate({ code: 'test-code' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('redirect-based authentication');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_ERROR);
        });
    });

    describe('supportsRedirect', () => {
        it('should return true', () => {
            expect(oidcProvider.supportsRedirect()).toBe(true);
        });
    });

    describe('validateConfig', () => {
        it('should return true for valid config', () => {
            expect(oidcProvider.validateConfig()).toBe(true);
        });

        it('should return false when issuerUrl is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, issuerUrl: '' },
            };
            const provider = new OidcProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });

        it('should return false when clientId is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, clientId: '' },
            };
            const provider = new OidcProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });

        it('should return false when clientSecret is missing', () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, clientSecret: '' },
            };
            const provider = new OidcProvider(invalidConfig);
            expect(provider.validateConfig()).toBe(false);
        });
    });

    describe('getAuthorizationUrl', () => {
        it('should return authorization URL with state and nonce', async () => {
            const result = await oidcProvider.getAuthorizationUrl('http://localhost/callback');

            expect(result.url).toContain('https://auth.example.com/authorize');
            expect(result.state).toBeDefined();
            expect(result.nonce).toBeDefined();
            expect(result.codeVerifier).toBe('test-code-verifier');
        });

        it('should call buildAuthorizationUrl with correct parameters', async () => {
            await oidcProvider.getAuthorizationUrl('http://localhost/callback');

            expect(mocks.mockBuildAuthorizationUrl).toHaveBeenCalledWith(
                mockIssuerConfig,
                expect.objectContaining({
                    redirect_uri: 'http://localhost/callback',
                    scope: 'openid email profile',
                    code_challenge: 'test-code-challenge',
                    code_challenge_method: 'S256',
                })
            );
        });

        it('should use default scopes if not configured', async () => {
            const configWithoutScopes = {
                ...validConfig,
                config: {
                    ...validConfig.config,
                    scopes: undefined,
                },
            };
            const provider = new OidcProvider(configWithoutScopes);

            await provider.getAuthorizationUrl('http://localhost/callback');

            expect(mocks.mockBuildAuthorizationUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    scope: 'openid email profile',
                })
            );
        });
    });

    describe('handleCallback', () => {
        const mockTokens = {
            claims: vi.fn().mockReturnValue({
                sub: 'user-123',
                email: 'user@example.com',
                name: 'Test User',
                email_verified: true,
            }),
        };

        beforeEach(() => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValue(mockTokens);
        });

        it('should return success with user info', async () => {
            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(true);
            expect(result.providerUserId).toBe('user-123');
            expect(result.email).toBe('user@example.com');
            expect(result.name).toBe('Test User');
        });

        it('should preserve full callback query params for authorizationCodeGrant', async () => {
            await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                    callbackQuery: {
                        code: 'auth-code',
                        state: 'test-state',
                        iss: 'https://auth.example.eu',
                        scope: 'openid email profile',
                    },
                },
                'expected-nonce'
            );

            expect(mocks.mockAuthorizationCodeGrant).toHaveBeenCalledTimes(1);
            const callbackUrl = mocks.mockAuthorizationCodeGrant.mock.calls[0][1] as URL;

            expect(callbackUrl.searchParams.get('code')).toBe('auth-code');
            expect(callbackUrl.searchParams.get('state')).toBe('test-state');
            expect(callbackUrl.searchParams.get('iss')).toBe('https://auth.example.eu');
            expect(callbackUrl.searchParams.get('scope')).toBe('openid email profile');
        });

        it('should return error when claims are not available', async () => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue(null),
            });

            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to get user claims');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_ERROR);
        });

        it('should return error when email is missing', async () => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue({
                    sub: 'user-123',
                    name: 'Test User',
                    // No email
                }),
            });

            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('did not return an email address');
            expect(result.errorCode).toBe(AuthErrorCode.MISSING_EMAIL);
        });

        it('should return error when email is not verified', async () => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue({
                    sub: 'user-123',
                    email: 'user@example.com',
                    name: 'Test User',
                    email_verified: false,
                }),
            });

            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('verify your email address');
            expect(result.errorCode).toBe(AuthErrorCode.EMAIL_NOT_VERIFIED);
        });

        it('should use preferred_username as name if name is not available', async () => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue({
                    sub: 'user-123',
                    email: 'user@example.com',
                    preferred_username: 'testuser',
                    // No name
                }),
            });

            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(true);
            expect(result.name).toBe('testuser');
        });

        it('should use email prefix as name if no name or username', async () => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue({
                    sub: 'user-123',
                    email: 'johndoe@example.com',
                    // No name or preferred_username
                }),
            });

            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(true);
            expect(result.name).toBe('johndoe');
        });

        it('should normalize email to lowercase', async () => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue({
                    sub: 'user-123',
                    email: 'USER@EXAMPLE.COM',
                    name: 'Test User',
                }),
            });

            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(true);
            expect(result.email).toBe('user@example.com');
        });

        it('should include metadata with claims', async () => {
            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue({
                    sub: 'user-123',
                    email: 'user@example.com',
                    name: 'Test User',
                    preferred_username: 'testuser',
                    groups: ['admins', 'users'],
                    roles: ['admin'],
                    picture: 'https://example.com/avatar.jpg',
                }),
            });

            const result = await oidcProvider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(true);
            expect(result.metadata).toEqual({
                sub: 'user-123',
                claims: {
                    preferred_username: 'testuser',
                    groups: ['admins', 'users'],
                    roles: ['admin'],
                    picture: 'https://example.com/avatar.jpg',
                },
            });
        });

        it('should handle token exchange errors', async () => {
            mocks.mockAuthorizationCodeGrant.mockRejectedValueOnce(
                new Error('Token exchange failed')
            );

            const result = await oidcProvider.handleCallback(
                {
                    code: 'invalid-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('SSO authentication failed');
            expect(result.errorCode).toBe(AuthErrorCode.PROVIDER_ERROR);
        });

        it('should use custom email claim if configured', async () => {
            const customClaimConfig = {
                ...validConfig,
                config: {
                    ...validConfig.config,
                    emailClaim: 'custom_email',
                },
            };
            const provider = new OidcProvider(customClaimConfig);

            mocks.mockAuthorizationCodeGrant.mockResolvedValueOnce({
                claims: vi.fn().mockReturnValue({
                    sub: 'user-123',
                    custom_email: 'custom@example.com',
                    name: 'Test User',
                }),
            });

            const result = await provider.handleCallback(
                {
                    code: 'auth-code',
                    state: 'test-state',
                    redirectUri: 'http://localhost/callback',
                    codeVerifier: 'test-code-verifier',
                },
                'expected-nonce'
            );

            expect(result.success).toBe(true);
            expect(result.email).toBe('custom@example.com');
        });
    });

    describe('testConnection', () => {
        it('should return success when discovery works', async () => {
            const result = await oidcProvider.testConnection();

            expect(result.success).toBe(true);
            expect(result.message).toBe('Successfully connected to https://auth.example.com');
        });

        it('should return failure for invalid config', async () => {
            const invalidConfig = {
                ...validConfig,
                config: { ...validConfig.config, issuerUrl: '' },
            };
            const provider = new OidcProvider(invalidConfig);

            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid configuration');
        });

        it('should return failure when discovery fails', async () => {
            mocks.mockDiscovery.mockRejectedValueOnce(new Error('Discovery failed'));

            const result = await oidcProvider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to connect: Discovery failed');
        });
    });
});
