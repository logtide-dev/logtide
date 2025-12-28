/**
 * External Authentication Routes
 *
 * API endpoints for:
 * - Listing available providers (public)
 * - OIDC authorization and callback
 * - LDAP authentication
 * - User identity management (link/unlink)
 * - Admin provider management
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { providerRegistry } from './providers/index.js';
import { authenticationService } from './authentication-service.js';
import { providerService } from './provider-service.js';
import { usersService } from '../users/service.js';
import { config } from '../../config/index.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';

// Validation schemas
const ldapLoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const createProviderSchema = z.object({
  type: z.enum(['oidc', 'ldap']),
  name: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(50),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  icon: z.string().max(100).optional(),
  config: z.record(z.unknown()),
});

const updateProviderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  icon: z.string().max(100).nullable().optional(),
  config: z.record(z.unknown()).optional(),
});

const linkIdentitySchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Public routes (no auth required)
 */
export async function publicAuthRoutes(fastify: FastifyInstance) {
  // List available auth providers (for login page)
  fastify.get('/providers', async (_request, reply) => {
    const providers = await providerRegistry.getPublicProviders();
    return reply.send({ providers });
  });

  // OIDC: Get authorization URL
  fastify.get<{
    Params: { slug: string };
    Querystring: { redirect_uri?: string };
  }>('/providers/:slug/authorize', {
    config: {
      rateLimit: {
        max: config.AUTH_RATE_LIMIT_LOGIN, // Same limit as login attempts
        timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
      },
    },
    handler: async (request, reply) => {
      try {
        const { slug } = request.params;
        // redirect_uri is available for future use (e.g., post-auth redirect)
        const { redirect_uri: _redirectUri } = request.query;

        // Get provider to check for configured redirectUri
        const provider = await providerRegistry.getProvider(slug);
        const providerConfig = provider?.config.config as { redirectUri?: string } | undefined;

        // Use configured redirectUri or auto-generate callback URL
        let callbackUrl: string;
        if (providerConfig?.redirectUri) {
          callbackUrl = providerConfig.redirectUri;
        } else {
          // Build callback URL from request
          // request.hostname may include port, so we extract just the hostname
          const hostname = request.hostname.split(':')[0];
          const baseUrl = config.NODE_ENV === 'production'
            ? `https://${hostname}`
            : `http://${hostname}:${config.PORT}`;
          callbackUrl = `${baseUrl}/api/v1/auth/providers/${slug}/callback`;
        }

        const { url, state } = await authenticationService.getOidcAuthorizationUrl(
          slug,
          callbackUrl
        );

        // Store the final redirect URI in state if provided
        // This will be used after successful auth

        return reply.send({
          url,
          state,
          provider: slug,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get authorization URL';
        return reply.status(400).send({ error: message });
      }
    },
  });

  // OIDC: Handle callback
  fastify.get<{
    Params: { slug: string };
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>('/providers/:slug/callback', async (request, reply) => {
    // Frontend URL for redirects (defaults to localhost:3000 in development)
    const frontendUrl = config.FRONTEND_URL || (config.NODE_ENV === 'production' ? '' : 'http://localhost:3000');

    try {
      const { code, state, error, error_description } = request.query;

      if (error) {
        const errorMessage = error_description || error;
        // Redirect to frontend with error
        return reply.redirect(`${frontendUrl}/login?error=${encodeURIComponent(errorMessage)}`);
      }

      if (!code || !state) {
        return reply.redirect(`${frontendUrl}/login?error=Invalid%20callback%20parameters`);
      }

      const result = await authenticationService.handleOidcCallback(code, state);

      // Redirect to frontend with session token
      // The frontend will store the token and redirect to dashboard
      const redirectUrl = `${frontendUrl}/auth/callback?token=${result.session.token}&expires=${result.session.expiresAt.toISOString()}&new_user=${result.isNewUser}`;
      return reply.redirect(redirectUrl);
    } catch (error) {
      console.error('OIDC callback error:', error);
      const message = error instanceof Error ? error.message : 'Authentication failed';
      return reply.redirect(`${frontendUrl}/login?error=${encodeURIComponent(message)}`);
    }
  });

  // LDAP: Login with username/password
  fastify.post<{
    Params: { slug: string };
    Body: { username: string; password: string };
  }>('/providers/:slug/login', {
    config: {
      rateLimit: {
        max: config.AUTH_RATE_LIMIT_LOGIN,
        timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
      },
    },
    handler: async (request, reply) => {
      try {
        const { slug } = request.params;
        const body = ldapLoginSchema.parse(request.body);

        const result = await authenticationService.authenticateWithProvider(slug, body);

        return reply.send({
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            is_admin: result.user.is_admin,
          },
          session: {
            token: result.session.token,
            expiresAt: result.session.expiresAt,
          },
          isNewUser: result.isNewUser,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }

        const message = error instanceof Error ? error.message : 'Authentication failed';
        return reply.status(401).send({ error: message });
      }
    },
  });
}

/**
 * Helper to get authenticated user (supports auth-free mode)
 */
async function getAuthenticatedUser(request: any): Promise<{ id: string; email: string; name: string; is_admin: boolean } | null> {
  const authMode = await settingsService.getAuthMode();

  if (authMode === 'none') {
    return await bootstrapService.getDefaultUser();
  }

  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return null;
  }

  return await usersService.validateSession(token);
}

/**
 * Authenticated routes (require session)
 */
export async function authenticatedAuthRoutes(fastify: FastifyInstance) {
  // Get current user's linked identities
  fastify.get('/me/identities', async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return reply.status(401).send({ error: 'No token provided or invalid session' });
    }

    const identities = await authenticationService.getUserIdentities(user.id);

    return reply.send({
      identities: identities.map((i) => ({
        id: i.id,
        provider: i.provider,
        providerUserId: i.providerUserId,
        lastLoginAt: i.lastLoginAt,
        createdAt: i.createdAt,
      })),
    });
  });

  // Link a new identity (for LDAP-type providers that use credentials)
  fastify.post<{
    Params: { slug: string };
    Body: { username?: string; password?: string };
  }>('/me/identities/:slug', async (request, reply) => {
    try {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return reply.status(401).send({ error: 'No token provided or invalid session' });
      }

      const { slug } = request.params;
      const body = linkIdentitySchema.parse(request.body);

      const identity = await authenticationService.linkIdentity(user.id, slug, body);

      return reply.status(201).send({ identity });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Failed to link identity';
      return reply.status(400).send({ error: message });
    }
  });

  // Unlink an identity
  fastify.delete<{
    Params: { id: string };
  }>('/me/identities/:id', async (request, reply) => {
    try {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return reply.status(401).send({ error: 'No token provided or invalid session' });
      }

      const { id } = request.params;
      await authenticationService.unlinkIdentity(user.id, id);

      return reply.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to unlink identity';
      return reply.status(400).send({ error: message });
    }
  });
}

/**
 * Admin routes (require admin privileges)
 */
export async function adminAuthRoutes(fastify: FastifyInstance) {
  // Add admin check hook with auth-free mode support
  fastify.addHook('onRequest', async (request, reply) => {
    // Check for auth-free mode first
    const authMode = await settingsService.getAuthMode();

    let user;
    if (authMode === 'none') {
      user = await bootstrapService.getDefaultUser();
      if (!user) {
        return reply.status(503).send({ error: 'Auth-free mode enabled but default user not configured' });
      }
    } else {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      user = await usersService.validateSession(token);
      if (!user) {
        return reply.status(401).send({ error: 'Invalid or expired session' });
      }
    }

    if (!user.is_admin) {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    // Attach user to request for later use
    (request as any).user = user;
  });

  // List all providers (admin view with full config)
  fastify.get('/providers', async (_request, reply) => {
    const providers = await providerService.getAllProviders();

    // Mask sensitive config fields
    const safeProviders = providers.map((p) => ({
      ...p,
      config: maskSensitiveConfig(p.type, p.config),
    }));

    return reply.send({ providers: safeProviders });
  });

  // Get single provider
  fastify.get<{ Params: { id: string } }>('/providers/:id', async (request, reply) => {
    const { id } = request.params;
    const provider = await providerService.getProviderById(id);

    if (!provider) {
      return reply.status(404).send({ error: 'Provider not found' });
    }

    return reply.send({
      provider: {
        ...provider,
        config: maskSensitiveConfig(provider.type, provider.config),
      },
    });
  });

  // Create provider
  fastify.post('/', async (request, reply) => {
    try {
      const body = createProviderSchema.parse(request.body);
      const provider = await providerService.createProvider(body);

      return reply.status(201).send({ provider });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Failed to create provider';
      return reply.status(400).send({ error: message });
    }
  });

  // Update provider
  fastify.put<{ Params: { id: string } }>('/providers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = updateProviderSchema.parse(request.body);

      const provider = await providerService.updateProvider(id, body);

      return reply.send({ provider });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Failed to update provider';
      return reply.status(400).send({ error: message });
    }
  });

  // Delete provider
  fastify.delete<{ Params: { id: string } }>('/providers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      await providerService.deleteProvider(id);

      return reply.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete provider';
      return reply.status(400).send({ error: message });
    }
  });

  // Test provider connection
  fastify.post<{ Params: { id: string } }>('/providers/:id/test', async (request, reply) => {
    const { id } = request.params;
    const result = await providerService.testProviderConnection(id);

    return reply.send(result);
  });

  // Reorder providers
  fastify.post<{ Body: { order: string[] } }>('/providers/reorder', async (request, reply) => {
    try {
      const { order } = request.body as { order: string[] };
      await providerService.reorderProviders(order);

      return reply.send({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reorder providers';
      return reply.status(400).send({ error: message });
    }
  });
}

/**
 * Mask sensitive config fields for API responses
 */
function maskSensitiveConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };

  if (type === 'oidc') {
    if (masked.clientSecret) {
      masked.clientSecret = '••••••••';
    }
  } else if (type === 'ldap') {
    if (masked.bindPassword) {
      masked.bindPassword = '••••••••';
    }
  }

  return masked;
}
