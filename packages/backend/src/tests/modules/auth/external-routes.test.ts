import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { createTestUser } from '../../helpers/factories.js';
import { CacheManager } from '../../../utils/cache.js';
import { publicAuthRoutes, authenticatedAuthRoutes, adminAuthRoutes } from '../../../modules/auth/external-routes.js';
import * as providerRegistryModule from '../../../modules/auth/providers/registry.js';
import * as authenticationServiceModule from '../../../modules/auth/authentication-service.js';
import crypto from 'crypto';

// Helper to create session
async function createTestSession(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.insertInto('sessions').values({
        user_id: userId,
        token,
        expires_at: expiresAt,
    }).execute();

    return { token, expiresAt };
}

describe('External Auth Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();

        // Register routes
        await app.register(async (fastify) => {
            await publicAuthRoutes(fastify);
        }, { prefix: '/api/v1/auth' });

        await app.register(async (fastify) => {
            await authenticatedAuthRoutes(fastify);
        }, { prefix: '/api/v1/auth' });

        await app.register(async (fastify) => {
            await adminAuthRoutes(fastify);
        }, { prefix: '/api/v1/admin/auth' });

        await app.ready();
    });

    beforeEach(async () => {
        // Reset system settings and cache
        await db.deleteFrom('system_settings').execute();
        await CacheManager.invalidateSettings();

        // Clean up
        await db.deleteFrom('oidc_states').execute();
        await db.deleteFrom('user_identities').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('users').execute();
        await db.deleteFrom('auth_providers').execute();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('Public Routes', () => {
        describe('GET /api/v1/auth/providers', () => {
            it('should return empty providers list', async () => {
                const getPublicProvidersSpy = vi.spyOn(providerRegistryModule.providerRegistry, 'getPublicProviders')
                    .mockResolvedValue([]);

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers',
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.payload);
                expect(body.providers).toEqual([]);

                getPublicProvidersSpy.mockRestore();
            });

            it('should return available providers', async () => {
                const mockProviders = [
                    { id: '1', type: 'local', name: 'Email', slug: 'local', icon: 'mail', isDefault: true, displayOrder: 0, supportsRedirect: false },
                    { id: '2', type: 'oidc', name: 'Google', slug: 'google', icon: 'google', isDefault: false, displayOrder: 1, supportsRedirect: true },
                ];

                const getPublicProvidersSpy = vi.spyOn(providerRegistryModule.providerRegistry, 'getPublicProviders')
                    .mockResolvedValue(mockProviders);

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers',
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.payload);
                expect(body.providers).toHaveLength(2);
                expect(body.providers[0].name).toBe('Email');
                expect(body.providers[1].name).toBe('Google');

                getPublicProvidersSpy.mockRestore();
            });
        });

        describe('GET /api/v1/auth/providers/:slug/authorize', () => {
            it('should return authorization URL', async () => {
                const mockProvider = {
                    config: { redirectUri: undefined },
                };

                const getProviderSpy = vi.spyOn(providerRegistryModule.providerRegistry, 'getProvider')
                    .mockResolvedValue(mockProvider as any);

                const getOidcAuthUrlSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'getOidcAuthorizationUrl')
                    .mockResolvedValue({
                        url: 'https://auth.example.com/authorize?client_id=test&state=abc123',
                        state: 'abc123',
                    });

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers/google/authorize',
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.payload);
                expect(body.url).toContain('https://auth.example.com/authorize');
                expect(body.state).toBe('abc123');
                expect(body.provider).toBe('google');

                getProviderSpy.mockRestore();
                getOidcAuthUrlSpy.mockRestore();
            });

            it('should return 400 on error', async () => {
                const getProviderSpy = vi.spyOn(providerRegistryModule.providerRegistry, 'getProvider')
                    .mockResolvedValue(null);

                const getOidcAuthUrlSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'getOidcAuthorizationUrl')
                    .mockRejectedValue(new Error('Provider not found'));

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers/nonexistent/authorize',
                });

                expect(response.statusCode).toBe(400);
                const body = JSON.parse(response.payload);
                expect(body.error).toContain('Provider not found');

                getProviderSpy.mockRestore();
                getOidcAuthUrlSpy.mockRestore();
            });
        });

        describe('GET /api/v1/auth/providers/:slug/callback', () => {
            it('should redirect with error when OIDC returns error', async () => {
                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers/google/callback?error=access_denied&error_description=User%20denied%20access',
                });

                expect(response.statusCode).toBe(302);
                expect(response.headers.location).toContain('error=User%20denied%20access');
            });

            it('should redirect with error when missing parameters', async () => {
                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers/google/callback',
                });

                expect(response.statusCode).toBe(302);
                expect(response.headers.location).toContain('error=Invalid%20callback%20parameters');
            });

            it('should redirect to frontend with token on success', async () => {
                const handleCallbackSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'handleOidcCallback')
                    .mockResolvedValue({
                        user: {
                            id: 'user-id',
                            email: 'test@example.com',
                            name: 'Test User',
                            is_admin: false,
                            disabled: false,
                            createdAt: new Date(),
                            lastLogin: null,
                        },
                        session: {
                            sessionId: 'session-id',
                            userId: 'user-id',
                            token: 'session-token-123',
                            expiresAt: new Date(Date.now() + 86400000),
                        },
                        isNewUser: false,
                    });

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers/google/callback?code=auth-code&state=state-123',
                });

                expect(response.statusCode).toBe(302);
                expect(response.headers.location).toContain('token=session-token-123');
                expect(response.headers.location).toContain('new_user=false');

                handleCallbackSpy.mockRestore();
            });

            it('should redirect with error on callback failure', async () => {
                const handleCallbackSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'handleOidcCallback')
                    .mockRejectedValue(new Error('Token exchange failed'));

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/providers/google/callback?code=bad-code&state=state-123',
                });

                expect(response.statusCode).toBe(302);
                expect(response.headers.location).toContain('error=Token%20exchange%20failed');

                handleCallbackSpy.mockRestore();
            });
        });

        describe('POST /api/v1/auth/providers/:slug/login', () => {
            it('should return 400 for invalid request body', async () => {
                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/providers/ldap/login',
                    payload: { username: '', password: '' },
                });

                expect(response.statusCode).toBe(400);
                const body = JSON.parse(response.payload);
                expect(body.error).toBe('Validation error');
            });

            it('should return 401 on authentication failure', async () => {
                const authSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'authenticateWithProvider')
                    .mockRejectedValue(new Error('Invalid credentials'));

                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/providers/ldap/login',
                    payload: { username: 'testuser', password: 'wrongpass' },
                });

                expect(response.statusCode).toBe(401);
                const body = JSON.parse(response.payload);
                expect(body.error).toContain('Invalid credentials');

                authSpy.mockRestore();
            });

            it('should return user and session on success', async () => {
                const authSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'authenticateWithProvider')
                    .mockResolvedValue({
                        user: {
                            id: 'user-id',
                            email: 'ldap@example.com',
                            name: 'LDAP User',
                            is_admin: false,
                            disabled: false,
                            createdAt: new Date(),
                            lastLogin: null,
                        },
                        session: {
                            sessionId: 'session-id',
                            userId: 'user-id',
                            token: 'ldap-session-token',
                            expiresAt: new Date(Date.now() + 86400000),
                        },
                        isNewUser: true,
                    });

                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/providers/ldap/login',
                    payload: { username: 'ldapuser', password: 'ldappass' },
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.payload);
                expect(body.user.email).toBe('ldap@example.com');
                expect(body.session.token).toBe('ldap-session-token');
                expect(body.isNewUser).toBe(true);

                authSpy.mockRestore();
            });
        });
    });

    describe('Authenticated Routes', () => {
        describe('GET /api/v1/auth/me/identities', () => {
            it('should return 401 without token', async () => {
                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/me/identities',
                });

                expect(response.statusCode).toBe(401);
            });

            it('should return identities for authenticated user', async () => {
                const user = await createTestUser();
                const session = await createTestSession(user.id);

                const getIdentitiesSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'getUserIdentities')
                    .mockResolvedValue([
                        {
                            id: 'identity-1',
                            userId: user.id,
                            providerId: 'provider-1',
                            providerUserId: 'ext-user-1',
                            metadata: {},
                            lastLoginAt: new Date(),
                            createdAt: new Date(),
                            updatedAt: new Date(),
                            provider: {
                                id: 'provider-1',
                                type: 'oidc',
                                name: 'Google',
                                slug: 'google',
                                icon: 'google',
                                isDefault: false,
                                displayOrder: 1,
                                supportsRedirect: true,
                            },
                        },
                    ]);

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/auth/me/identities',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.payload);
                expect(body.identities).toHaveLength(1);
                expect(body.identities[0].provider.name).toBe('Google');

                getIdentitiesSpy.mockRestore();
            });
        });

        describe('POST /api/v1/auth/me/identities/:slug', () => {
            it('should return 401 without token', async () => {
                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/me/identities/ldap',
                    payload: { username: 'test', password: 'test' },
                });

                expect(response.statusCode).toBe(401);
            });

            it('should link identity for authenticated user', async () => {
                const user = await createTestUser();
                const session = await createTestSession(user.id);

                const linkSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'linkIdentity')
                    .mockResolvedValue({
                        id: 'new-identity',
                        userId: user.id,
                        providerId: 'ldap-provider',
                        providerUserId: 'ldap-user-123',
                        metadata: {},
                        lastLoginAt: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });

                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/me/identities/ldap',
                    headers: { authorization: `Bearer ${session.token}` },
                    payload: { username: 'ldapuser', password: 'ldappass' },
                });

                expect(response.statusCode).toBe(201);
                const body = JSON.parse(response.payload);
                expect(body.identity).toBeDefined();

                linkSpy.mockRestore();
            });

            it('should return 400 on link failure', async () => {
                const user = await createTestUser();
                const session = await createTestSession(user.id);

                const linkSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'linkIdentity')
                    .mockRejectedValue(new Error('Already linked'));

                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/me/identities/ldap',
                    headers: { authorization: `Bearer ${session.token}` },
                    payload: { username: 'ldapuser', password: 'ldappass' },
                });

                expect(response.statusCode).toBe(400);
                const body = JSON.parse(response.payload);
                expect(body.error).toContain('Already linked');

                linkSpy.mockRestore();
            });
        });

        describe('DELETE /api/v1/auth/me/identities/:id', () => {
            it('should return 401 without token', async () => {
                const response = await app.inject({
                    method: 'DELETE',
                    url: '/api/v1/auth/me/identities/some-id',
                });

                expect(response.statusCode).toBe(401);
            });

            it('should unlink identity', async () => {
                const user = await createTestUser();
                const session = await createTestSession(user.id);

                const unlinkSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'unlinkIdentity')
                    .mockResolvedValue();

                const response = await app.inject({
                    method: 'DELETE',
                    url: '/api/v1/auth/me/identities/identity-to-unlink',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(204);

                unlinkSpy.mockRestore();
            });

            it('should return 400 on unlink failure', async () => {
                const user = await createTestUser();
                const session = await createTestSession(user.id);

                const unlinkSpy = vi.spyOn(authenticationServiceModule.authenticationService, 'unlinkIdentity')
                    .mockRejectedValue(new Error('Cannot unlink only identity'));

                const response = await app.inject({
                    method: 'DELETE',
                    url: '/api/v1/auth/me/identities/only-identity',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(400);
                const body = JSON.parse(response.payload);
                expect(body.error).toContain('Cannot unlink');

                unlinkSpy.mockRestore();
            });
        });
    });

    describe('Admin Routes', () => {
        describe('Admin authentication', () => {
            it('should return 401 without token', async () => {
                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/admin/auth/providers',
                });

                expect(response.statusCode).toBe(401);
            });

            it('should return 403 for non-admin user', async () => {
                const user = await db.insertInto('users').values({
                    email: 'nonadmin@example.com',
                    name: 'Non Admin',
                    password_hash: 'hash',
                    is_admin: false,
                }).returningAll().executeTakeFirstOrThrow();

                const session = await createTestSession(user.id);

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/admin/auth/providers',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(403);
            });

            it('should allow admin user', async () => {
                const adminUser = await db.insertInto('users').values({
                    email: 'admin@example.com',
                    name: 'Admin User',
                    password_hash: 'hash',
                    is_admin: true,
                }).returningAll().executeTakeFirstOrThrow();

                const session = await createTestSession(adminUser.id);

                // Mock the provider service
                const getAllProvidersSpy = vi.spyOn(
                    await import('../../../modules/auth/provider-service.js').then(m => m.providerService),
                    'getAllProviders'
                ).mockResolvedValue([]);

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/admin/auth/providers',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(200);

                getAllProvidersSpy.mockRestore();
            });
        });

        describe('GET /api/v1/admin/auth/providers/:id', () => {
            it('should return 404 for nonexistent provider', async () => {
                const adminUser = await db.insertInto('users').values({
                    email: 'admin2@example.com',
                    name: 'Admin',
                    password_hash: 'hash',
                    is_admin: true,
                }).returningAll().executeTakeFirstOrThrow();

                const session = await createTestSession(adminUser.id);

                const getProviderByIdSpy = vi.spyOn(
                    await import('../../../modules/auth/provider-service.js').then(m => m.providerService),
                    'getProviderById'
                ).mockResolvedValue(null);

                const response = await app.inject({
                    method: 'GET',
                    url: '/api/v1/admin/auth/providers/nonexistent-id',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(404);

                getProviderByIdSpy.mockRestore();
            });
        });

        describe('POST /api/v1/admin/auth', () => {
            it('should validate provider creation', async () => {
                const adminUser = await db.insertInto('users').values({
                    email: 'admin3@example.com',
                    name: 'Admin',
                    password_hash: 'hash',
                    is_admin: true,
                }).returningAll().executeTakeFirstOrThrow();

                const session = await createTestSession(adminUser.id);

                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/admin/auth',
                    headers: { authorization: `Bearer ${session.token}` },
                    payload: {
                        type: 'invalid-type',
                        name: 'Test',
                        slug: 'test',
                        config: {},
                    },
                });

                expect(response.statusCode).toBe(400);
                const body = JSON.parse(response.payload);
                expect(body.error).toBe('Validation error');
            });
        });

        describe('DELETE /api/v1/admin/auth/providers/:id', () => {
            it('should delete provider', async () => {
                const adminUser = await db.insertInto('users').values({
                    email: 'admin4@example.com',
                    name: 'Admin',
                    password_hash: 'hash',
                    is_admin: true,
                }).returningAll().executeTakeFirstOrThrow();

                const session = await createTestSession(adminUser.id);

                const deleteProviderSpy = vi.spyOn(
                    await import('../../../modules/auth/provider-service.js').then(m => m.providerService),
                    'deleteProvider'
                ).mockResolvedValue();

                const response = await app.inject({
                    method: 'DELETE',
                    url: '/api/v1/admin/auth/providers/provider-to-delete',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(204);

                deleteProviderSpy.mockRestore();
            });
        });

        describe('POST /api/v1/admin/auth/providers/:id/test', () => {
            it('should test provider connection', async () => {
                const adminUser = await db.insertInto('users').values({
                    email: 'admin5@example.com',
                    name: 'Admin',
                    password_hash: 'hash',
                    is_admin: true,
                }).returningAll().executeTakeFirstOrThrow();

                const session = await createTestSession(adminUser.id);

                const testConnectionSpy = vi.spyOn(
                    await import('../../../modules/auth/provider-service.js').then(m => m.providerService),
                    'testProviderConnection'
                ).mockResolvedValue({ success: true, message: 'Connection successful' });

                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/admin/auth/providers/test-provider/test',
                    headers: { authorization: `Bearer ${session.token}` },
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);

                testConnectionSpy.mockRestore();
            });
        });

        describe('POST /api/v1/admin/auth/providers/reorder', () => {
            it('should reorder providers', async () => {
                const adminUser = await db.insertInto('users').values({
                    email: 'admin6@example.com',
                    name: 'Admin',
                    password_hash: 'hash',
                    is_admin: true,
                }).returningAll().executeTakeFirstOrThrow();

                const session = await createTestSession(adminUser.id);

                const reorderSpy = vi.spyOn(
                    await import('../../../modules/auth/provider-service.js').then(m => m.providerService),
                    'reorderProviders'
                ).mockResolvedValue();

                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/admin/auth/providers/reorder',
                    headers: { authorization: `Bearer ${session.token}` },
                    payload: { order: ['id1', 'id2', 'id3'] },
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);

                reorderSpy.mockRestore();
            });
        });
    });
});
