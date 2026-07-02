import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiKeyType } from '@logtide/shared';
import { apiKeysService } from '../api-keys/service.js';
import { usersService } from '../users/service.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';
import { streamTicketService } from '../streaming/stream-ticket-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    authenticated: boolean;
    projectId?: string;
    organizationId?: string;
    apiKeyId?: string;
    apiKeyType?: ApiKeyType;
  }
}

/**
 * Check whether the request origin or IP is in the allowlist.
 * Returns true if the request is allowed, false if it must be rejected.
 *
 * - allowedOrigins null/empty → always allowed
 * - Origin header matched against list (browser requests)
 * - If no Origin header, request.ip is matched (server-side requests)
 */
function checkOriginAllowlist(
  request: FastifyRequest,
  allowedOrigins: string[] | null
): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true;

  const origin = request.headers['origin'] as string | undefined;

  if (origin) {
    // Browser request: extract hostname from Origin and match
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return false;
    }

    return allowedOrigins.some((allowed) => {
      const pattern = allowed.trim();
      if (pattern.startsWith('*.')) {
        const domainSuffix = pattern.slice(2); // "example.com"
        return hostname === domainSuffix || hostname.endsWith('.' + domainSuffix);
      }
      // Allow both exact origin match (https://example.com) and hostname-only match (example.com)
      return origin === pattern || hostname === pattern;
    });
  }

  // Server-side request: match IP
  const ip = request.ip;
  if (ip) {
    return allowedOrigins.some((allowed) => allowed.trim() === ip);
  }

  return false;
}

/**
 * Authentication plugin for API routes.
 * Rate limiting note: This plugin handles authentication only.
 * Rate limiting is configured globally via @fastify/rate-limit in server.ts
 * with separate limits for auth endpoints (10 req/15min) and ingestion (200 req/min).
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('authenticated', false);
  fastify.decorateRequest('projectId', undefined);
  fastify.decorateRequest('organizationId', undefined);
  fastify.decorateRequest('apiKeyId', undefined);
  fastify.decorateRequest('apiKeyType', undefined);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public routes and session-based auth routes
    if (
      request.url === '/health' ||
      request.url.startsWith('/api/v1/auth') ||
      request.url.startsWith('/api/v1/organizations') ||
      request.url.startsWith('/api/v1/projects') ||
      request.url.startsWith('/api/v1/alerts') ||
      request.url.startsWith('/api/v1/notifications') ||
      request.url.startsWith('/api/v1/invitations') ||
      request.url.startsWith('/api/v1/status') ||
      request.url.startsWith('/api/v1/status-incidents') ||
      request.url.startsWith('/api/v1/maintenances') ||
      // Inbound webhook receivers (#155): the URL token is the credential,
      // verified by the route itself.
      request.url.startsWith('/api/v1/receivers')
    ) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string;
    const authHeader = request.headers['authorization'] as string;
    const tokenParam = (request.query as any)?.token as string | undefined;
    const ticketParam = (request.query as any)?.ticket as string | undefined;

    // 0. Try a single-use stream ticket first (for WebSocket/SSE - the browser
    // cannot send headers, and this avoids putting the session token in the URL).
    if (ticketParam) {
      const userId = await streamTicketService.consumeTicket(ticketParam);
      if (!userId) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid or expired stream ticket',
        });
        return;
      }

      const user = await usersService.getUserById(userId);
      if (!user) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid or expired stream ticket',
        });
        return;
      }

      request.authenticated = true;
      (request as any).user = user;
      return;
    }

    // 1. Try token from query param first (for SSE - EventSource can't send headers)
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
      (request as any).user = user; // Set user for session-based routes
      // Note: projectId will be extracted from query params in the route handler
      return;
    }

    // 2. Try API key (priority for ingestion/machine-to-machine)
    if (apiKey) {
      const result = await apiKeysService.verifyApiKey(apiKey);

      if (!result) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
        return;
      }

      // Origin/IP allowlist check
      if (!checkOriginAllowlist(request, result.allowedOrigins)) {
        reply.code(403).send({
          error: 'Forbidden',
          message: 'Request origin or IP not in API key allowlist',
        });
        return;
      }

      // Decorate request with project and organization context
      request.authenticated = true;
      request.projectId = result.projectId;
      request.organizationId = result.organizationId;
      request.apiKeyId = result.id;
      request.apiKeyType = result.type;
      return;
    }

    // 3. Try Bearer token (session-based auth) for UI
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

      // Session is valid - set user and projectId comes from query params
      request.authenticated = true;
      (request as any).user = user; // Set user for session-based routes
      // Note: projectId will be extracted from query params in the route handler
      return;
    }

    // 4. Fallback to auth-free mode if enabled
    const authMode = await settingsService.getAuthMode();
    if (authMode === 'none') {
      const defaultUser = await bootstrapService.getDefaultUser();
      if (defaultUser) {
        request.authenticated = true;
        // In auth-free mode, projectId comes from query params
        return;
      }
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
  fastify: '5.x',
});
