import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { usersService } from './service.js';
import { config } from '../../config/index.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').optional(),
});

const deleteUserSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export async function usersRoutes(fastify: FastifyInstance) {
  // Register new user
  fastify.post('/register', {
    config: {
      rateLimit: {
        max: config.AUTH_RATE_LIMIT_REGISTER, // Configurable via AUTH_RATE_LIMIT_REGISTER env var
        timeWindow: config.AUTH_RATE_LIMIT_WINDOW // Configurable via AUTH_RATE_LIMIT_WINDOW env var
      }
    },
    handler: async (request, reply) => {
      try {
        // Check if signup is enabled
        const signupEnabled = await settingsService.isSignupEnabled();
        if (!signupEnabled) {
          return reply.status(403).send({
            error: 'User registration is currently disabled',
            code: 'SIGNUP_DISABLED',
          });
        }

        const body = registerSchema.parse(request.body);

        const user = await usersService.createUser(body);

        // Automatically log in the new user
        const session = await usersService.login({
          email: body.email,
          password: body.password,
        });

        return reply.status(201).send({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            is_admin: user.is_admin,
          },
          session: {
            token: session.token,
            expiresAt: session.expiresAt,
          },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }

        if (error instanceof Error) {
          if (error.message.includes('already exists')) {
            return reply.status(409).send({
              error: error.message,
            });
          }
        }

        throw error;
      }
    }
  });

  // Login
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: config.AUTH_RATE_LIMIT_LOGIN, // Configurable via AUTH_RATE_LIMIT_LOGIN env var
        timeWindow: config.AUTH_RATE_LIMIT_WINDOW // Configurable via AUTH_RATE_LIMIT_WINDOW env var
      }
    },
    handler: async (request, reply) => {
      try {
        const body = loginSchema.parse(request.body);

        const session = await usersService.login(body);
        const user = await usersService.getUserById(session.userId);

        if (!user) {
          return reply.status(500).send({
            error: 'Internal server error',
          });
        }

        return reply.send({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            is_admin: user.is_admin,
          },
          session: {
            token: session.token,
            expiresAt: session.expiresAt,
          },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }

        if (error instanceof Error) {
          if (error.message.includes('Invalid')) {
            return reply.status(401).send({
              error: error.message,
            });
          }
        }

        throw error;
      }
    }
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return reply.status(401).send({
        error: 'No token provided',
      });
    }

    await usersService.logout(token);

    return reply.send({
      message: 'Logged out successfully',
    });
  });

  // Get current user (requires auth, or returns default user in auth-free mode)
  fastify.get('/me', async (request, reply) => {
    // Check for auth-free mode first
    const authMode = await settingsService.getAuthMode();

    if (authMode === 'none') {
      // Auth-free mode: return default user
      const defaultUser = await bootstrapService.getDefaultUser();

      if (!defaultUser) {
        return reply.status(503).send({
          error: 'Service not ready',
          message: 'Auth-free mode is enabled but default user not configured',
        });
      }

      return reply.send({
        user: {
          id: defaultUser.id,
          email: defaultUser.email,
          name: defaultUser.name,
          is_admin: defaultUser.is_admin,
          createdAt: defaultUser.createdAt,
          lastLogin: defaultUser.lastLogin,
        },
        authMode: 'none',
      });
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

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        is_admin: user.is_admin,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
      },
    });
  });

  // Update current user (requires auth)
  fastify.put('/me', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return reply.status(401).send({
          error: 'No token provided',
        });
      }

      const currentUser = await usersService.validateSession(token);

      if (!currentUser) {
        return reply.status(401).send({
          error: 'Invalid or expired session',
        });
      }

      const body = updateUserSchema.parse(request.body);

      // Validate password change logic
      if (body.newPassword && !body.currentPassword) {
        return reply.status(400).send({
          error: 'Current password is required to set a new password',
        });
      }

      const updatedUser = await usersService.updateUser(currentUser.id, body);

      return reply.send({
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          is_admin: updatedUser.is_admin,
          createdAt: updatedUser.createdAt,
          lastLogin: updatedUser.lastLogin,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('already in use')) {
          return reply.status(409).send({
            error: error.message,
          });
        }
        if (error.message.includes('incorrect') || error.message.includes('required')) {
          return reply.status(400).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Delete current user account (requires auth)
  fastify.delete('/me', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return reply.status(401).send({
          error: 'No token provided',
        });
      }

      const currentUser = await usersService.validateSession(token);

      if (!currentUser) {
        return reply.status(401).send({
          error: 'Invalid or expired session',
        });
      }

      const body = deleteUserSchema.parse(request.body);

      await usersService.deleteUser(currentUser.id, body.password);

      // Logout (delete session)
      await usersService.logout(token);

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('Invalid password')) {
          return reply.status(400).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });
}
