/**
 * Shared Authentication Middleware
 *
 * Handles session-based authentication with auth-free mode support.
 * Used by all session-based route handlers (organizations, projects, etc.)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { usersService, type UserProfile } from '../users/service.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: UserProfile;
  }
}

/**
 * Middleware to extract and validate session token
 * Supports auth-free mode where authentication is bypassed
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check for auth-free mode first
  const authMode = await settingsService.getAuthMode();

  if (authMode === 'none') {
    // Auth-free mode: use default user
    const defaultUser = await bootstrapService.getDefaultUser();

    if (!defaultUser) {
      // Bootstrap not initialized - this shouldn't happen
      // but handle gracefully
      return reply.status(503).send({
        error: 'Service not ready',
        message: 'Auth-free mode is enabled but default user not initialized',
      });
    }

    request.user = defaultUser;
    return;
  }

  // Standard mode: validate session token
  const token = request.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return reply.status(401).send({
      error: 'No token provided',
    });
  }

  const user = await usersService.validateSession(token);

  if (!user) {
    return reply.status(401).send({
      error: 'Invalid or expired session',
    });
  }

  // Attach user to request
  request.user = user;
}

/**
 * Middleware to check if user is an admin
 * Must be used after authenticate middleware
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({
      error: 'Not authenticated',
    });
  }

  if (!request.user.is_admin) {
    return reply.status(403).send({
      error: 'Admin access required',
    });
  }
}
