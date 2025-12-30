import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { apiKeysService } from '../api-keys/service.js';
import { usersService } from '../users/service.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    authenticated: boolean;
    projectId?: string;
    organizationId?: string;
  }
}

/**
 * Authentication plugin for API routes.
 * Rate limiting note: This plugin handles authentication only.
 * Rate limiting is configured globally via @fastify/rate-limit in server.ts
 * with separate limits for auth endpoints (10 req/15min) and ingestion (200 req/min).
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('authenticated', false);
  fastify.decorateRequest('projectId', null);
  fastify.decorateRequest('organizationId', null);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public routes and session-based auth routes
    if (
      request.url === '/health' ||
      request.url.startsWith('/api/v1/auth') ||
      request.url.startsWith('/api/v1/organizations') ||
      request.url.startsWith('/api/v1/projects') ||
      request.url.startsWith('/api/v1/alerts') ||
      request.url.startsWith('/api/v1/notifications') ||
      request.url.startsWith('/api/v1/invitations')
    ) {
      return;
    }

    // Check for auth-free mode first
    const authMode = await settingsService.getAuthMode();
    if (authMode === 'none') {
      const defaultUser = await bootstrapService.getDefaultUser();
      if (defaultUser) {
        request.authenticated = true;
        // In auth-free mode, projectId comes from query params
        return;
      }
    }

    const apiKey = request.headers['x-api-key'] as string;
    const authHeader = request.headers['authorization'] as string;
    const tokenParam = (request.query as any)?.token as string | undefined;

    // Try token from query param first (for SSE - EventSource can't send headers)
    if (tokenParam) {
      const user = await usersService.validateSession(tokenParam);

      if (!user) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid or expired session token',
        });
        return;
      }

      request.authenticated = true;
      // Note: projectId will be extracted from query params in the route handler
      return;
    }

    // Try API key
    if (apiKey) {
      const result = await apiKeysService.verifyApiKey(apiKey);

      if (!result) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
        return;
      }

      // Decorate request with project and organization context
      request.authenticated = true;
      request.projectId = result.projectId;
      request.organizationId = result.organizationId;
      return;
    }

    // Try Bearer token (session-based auth) for UI
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      const user = await usersService.validateSession(token);

      if (!user) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid or expired session token',
        });
        return;
      }

      // Session is valid - projectId should come from query params
      request.authenticated = true;
      // Note: projectId will be extracted from query params in the route handler
      return;
    }

    // No auth provided
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing X-API-Key header or Authorization token',
    });
  });
};

export default fp(authPlugin, {
  name: 'auth',
  fastify: '4.x',
});
