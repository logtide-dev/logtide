/**
 * Settings Routes
 *
 * Admin-only endpoints for managing system settings.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { settingsService, SETTING_KEYS } from './service.js';
import { usersService } from '../users/service.js';
import { bootstrapService } from '../bootstrap/service.js';
import type { UserProfile } from '../users/service.js';

// Validation schemas
const updateSettingSchema = z.object({
  value: z.unknown(),
});

const updateSettingsSchema = z.object({
  'auth.signup_enabled': z.boolean().optional(),
  'auth.mode': z.enum(['standard', 'none']).optional(),
  'auth.default_user_id': z.string().uuid().nullable().optional(),
});

// Rate limit config for admin routes
const rateLimitConfig = {
  max: 100,
  timeWindow: '1 minute',
};

/**
 * Admin settings routes (require admin privileges)
 */
export async function settingsRoutes(fastify: FastifyInstance) {
  // Add admin check hook with auth-free mode support
  fastify.addHook('onRequest', async (request, reply) => {
    // Check for auth-free mode first
    const authMode = await settingsService.getAuthMode();

    let user: UserProfile | null;
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

    // Attach user to request for audit trail
    (request as any).user = user;
  });

  // GET /api/v1/admin/settings - List all settings
  fastify.get('/', {
    config: { rateLimit: rateLimitConfig },
    handler: async (_request, reply) => {
      try {
        const settings = await settingsService.getAllValues();
        return reply.send({ settings });
      } catch (error) {
        console.error('Error fetching settings:', error);
        return reply.status(500).send({ error: 'Failed to fetch settings' });
      }
    },
  });

  // GET /api/v1/admin/settings/:key - Get single setting
  fastify.get<{
    Params: { key: string };
  }>('/:key', {
    config: { rateLimit: rateLimitConfig },
    handler: async (request, reply) => {
      try {
        const { key } = request.params;
        const allSettings = await settingsService.getAll();
        const setting = allSettings[key];

        if (!setting) {
          return reply.status(404).send({ error: 'Setting not found' });
        }

        return reply.send({ setting });
      } catch (error) {
        console.error('Error fetching setting:', error);
        return reply.status(500).send({ error: 'Failed to fetch setting' });
      }
    },
  });

  // PUT /api/v1/admin/settings/:key - Update single setting
  fastify.put<{
    Params: { key: string };
    Body: { value: unknown };
  }>('/:key', {
    config: { rateLimit: rateLimitConfig },
    handler: async (request, reply) => {
      try {
        const { key } = request.params;
        const body = updateSettingSchema.parse(request.body);
        const userId = (request as any).user?.id;

        // Validate the setting key
        const validKeys = Object.values(SETTING_KEYS);
        if (!validKeys.includes(key as any)) {
          return reply.status(400).send({ error: `Invalid setting key: ${key}` });
        }

        await settingsService.set(key as any, body.value as any, userId);

        return reply.send({
          success: true,
          key,
          value: body.value,
          updated_at: new Date(),
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }

        console.error('Error updating setting:', error);
        return reply.status(500).send({ error: 'Failed to update setting' });
      }
    },
  });

  // PATCH /api/v1/admin/settings - Update multiple settings
  fastify.patch('/', {
    config: { rateLimit: rateLimitConfig },
    handler: async (request, reply) => {
      try {
        const body = updateSettingsSchema.parse(request.body);
        const userId = (request as any).user?.id;

        await settingsService.setMany(body, userId);

        // Clear bootstrap cache if auth settings changed
        if ('auth.mode' in body || 'auth.default_user_id' in body) {
          bootstrapService.clearCache();
        }

        const settings = await settingsService.getAllValues();

        return reply.send({
          success: true,
          settings,
          updated_at: new Date(),
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }

        console.error('Error updating settings:', error);
        return reply.status(500).send({ error: 'Failed to update settings' });
      }
    },
  });

  // DELETE /api/v1/admin/settings/:key - Reset setting to default
  fastify.delete<{
    Params: { key: string };
  }>('/:key', {
    config: { rateLimit: rateLimitConfig },
    handler: async (request, reply) => {
      try {
        const { key } = request.params;

        await settingsService.delete(key);

        return reply.status(204).send();
      } catch (error) {
        console.error('Error deleting setting:', error);
        return reply.status(500).send({ error: 'Failed to delete setting' });
      }
    },
  });
}

/**
 * Public auth config endpoint (no auth required)
 * Returns auth mode and signup status for frontend
 */
export async function publicSettingsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/auth/config - Get public auth configuration
  fastify.get('/config', async (_request, reply) => {
    try {
      const [authMode, signupEnabled] = await Promise.all([
        settingsService.getAuthMode(),
        settingsService.isSignupEnabled(),
      ]);

      return reply.send({
        authMode,
        signupEnabled,
        requiresLogin: authMode !== 'none',
      });
    } catch (error) {
      console.error('Error fetching auth config:', error);
      // Return defaults on error
      return reply.send({
        authMode: 'standard',
        signupEnabled: true,
        requiresLogin: true,
      });
    }
  });
}
