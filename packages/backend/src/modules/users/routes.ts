import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hub } from '@logtide/core';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import { AuthError, AuthErrorCode } from '../auth/providers/types.js';
import { usersService } from './service.js';
import { authenticationService } from '../auth/authentication-service.js';
import { config } from '../../config/index.js';
import { isEmailVerificationRequired } from './email-verification-flag.js';
import { emailVerificationService } from './email-verification.js';
import { getActiveTerms, termsAcceptanceService } from './terms.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';
import { auditLogService } from '../audit-log/index.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  // Must be exactly true only when the terms seam is active. Typed unknown so
  // an inactive seam never rejects a body it used to accept (unknown keys were
  // stripped before this field existed).
  acceptTerms: z.unknown().optional(),
});

const acceptTermsSchema = z.object({
  version: z.string().max(64),
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

const verifyEmailSchema = z.object({
  token: z.string().min(1).max(200),
});

const resendVerificationSchema = z.object({
  email: z.string().email().optional(),
});

const ONE_HOUR_MS = 60 * 60 * 1000;

function logVerificationError(message: string, userId: string | null, error: unknown): void {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', message, {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const deleteUserSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export async function usersRoutes(fastify: FastifyInstance) {
  // Optional hourly per-IP cap on registrations, layered on top of the
  // AUTH_RATE_LIMIT_REGISTER route limit. Keyed by IP only (the global key
  // generator would let a forged Authorization header rotate the key) and
  // prefixed so it never shares a counter with the other limiters.
  const registrationHourlyLimit = config.REGISTRATION_RATE_LIMIT_PER_HOUR;
  const hourlyLimiter =
    registrationHourlyLimit && fastify.hasDecorator('createRateLimit')
      ? (fastify as any).createRateLimit({
          max: registrationHourlyLimit,
          timeWindow: ONE_HOUR_MS,
          keyGenerator: (request: { ip: string }) => `registration-hourly:${request.ip}`,
        })
      : null;
  if (registrationHourlyLimit && !hourlyLimiter) {
    console.warn('[RateLimit] REGISTRATION_RATE_LIMIT_PER_HOUR is set but the rate-limit plugin is not registered');
  }

  // Register new user
  fastify.post('/register', {
    ...(hourlyLimiter
      ? {
          onRequest: async (request: any, reply: any) => {
            const result = await hourlyLimiter(request);
            if (!result.isAllowed && result.isExceeded) {
              reply.header('retry-after', result.ttlInSeconds);
              return reply.status(429).send({
                statusCode: 429,
                error: 'Too Many Requests',
                message: 'Too many registrations from this address, please try again later',
              });
            }
          },
        }
      : {}),
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

        // Terms seam: when active, the Terms and Privacy Policy must be
        // accepted explicitly; acceptance is stored with the new user.
        const terms = getActiveTerms();
        if (terms && body.acceptTerms !== true) {
          return reply.status(400).send({ error: 'terms_not_accepted' });
        }

        const user = await usersService.createUser({
          email: body.email,
          password: body.password,
          name: body.name,
          ...(terms ? { termsVersion: terms.termsVersion } : {}),
        });

        // Gate on: email the verification link, fire and forget so the response
        // never depends on SMTP latency. A send failure never fails the
        // registration (the user can request a resend from the app).
        if (isEmailVerificationRequired()) {
          void emailVerificationService
            .issueAndSend(user)
            .catch((verificationError) =>
              logVerificationError('[Auth] Failed to issue email verification token', user.id, verificationError)
            );
        }

        // Automatically log in the new user through the provider registry.
        // This also creates the user_identities link for the local provider.
        // If this fails for a transient reason the user row is already committed,
        // so we return 201 with no session instead of propagating a 500. The
        // account is fully recoverable via a subsequent /login.
        let session: { token: string; expiresAt: Date } | null = null;
        try {
          const result = await authenticationService.authenticateWithProvider('local', {
            email: body.email,
            password: body.password,
          });
          session = result.session;
        } catch (autoLoginError) {
          // The user row is already committed, so this stays a 201 without a
          // session (recoverable via /login), but the cause must be visible to
          // operators: a persistent failure here silently degrades every signup.
          if (isInternalLoggingEnabled()) {
            hub.captureLog('error', '[Auth] Post-registration auto-login failed', {
              userId: user.id,
              error: autoLoginError instanceof Error ? autoLoginError.message : String(autoLoginError),
            });
          }
        }

        await auditLogService.record({
          action: 'user.registered',
          target: { type: 'user', id: user.id },
          organizationId: null,
          actor: { type: 'user', id: user.id, label: user.email },
        });

        return reply.status(201).send({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            is_admin: user.is_admin,
            ...(isEmailVerificationRequired() ? { emailVerified: false } : {}),
          },
          ...(session ? {
            session: {
              token: session.token,
              expiresAt: session.expiresAt,
            },
          } : {}),
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
      let parsedBody: { email: string; password: string } | undefined;
      try {
        parsedBody = loginSchema.parse(request.body);

        const { user, session } = await authenticationService.authenticateWithProvider('local', parsedBody);

        await auditLogService.record({
          action: 'auth.login_succeeded',
          organizationId: null,
          actor: { type: 'user', id: user.id, label: user.email },
          metadata: { method: 'local' },
        });

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

        if (error instanceof AuthError) {
          // Classify by the provider's typed code, not the message string, so a
          // reword of a user-facing message can never silently turn a login
          // failure into a 500 or drop its audit row.
          const mapping: Partial<Record<AuthErrorCode, { status: number; reason: string }>> = {
            [AuthErrorCode.INVALID_CREDENTIALS]: { status: 401, reason: 'invalid_credentials' },
            [AuthErrorCode.SSO_REQUIRED]: { status: 401, reason: 'sso_required' },
            [AuthErrorCode.USER_DISABLED]: { status: 401, reason: 'account_disabled' },
            [AuthErrorCode.PROVIDER_UNAVAILABLE]: { status: 503, reason: 'provider_unavailable' },
          };
          const mapped = mapping[error.code];

          if (mapped) {
            // parsedBody is defined here (zod succeeded before the service threw).
            // The reason lands only in the audit log, never in the HTTP response,
            // so recording it does not weaken the anti-enumeration behavior.
            await auditLogService.record({
              action: 'auth.login_failed',
              outcome: 'failure',
              organizationId: null,
              actor: { type: 'user', id: null, label: parsedBody?.email ?? null },
              metadata: { method: 'local', reason: mapped.reason },
            });
            return reply.status(mapped.status).send({
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

    const user = await usersService.validateSession(token);
    await usersService.logout(token);

    await auditLogService.record({
      action: 'auth.session_revoked',
      organizationId: null,
      actor: { type: 'user', id: user?.id ?? null, label: user?.email ?? null },
      metadata: { reason: 'logout' },
    });

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

    // Read fresh from the DB (the session cache would lag behind a verify).
    const emailVerified = isEmailVerificationRequired()
      ? await emailVerificationService.isVerified(user.id)
      : undefined;
    // Terms seam: key present (true) only while the current version is not accepted.
    const termsPending = await termsAcceptanceService.isPending(user.id);

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        is_admin: user.is_admin,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        ...(emailVerified !== undefined ? { emailVerified } : {}),
        ...(termsPending ? { termsAcceptanceRequired: true } : {}),
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

      // Gate on: a changed address must be confirmed again (updateUser already
      // cleared email_verified_at in the same UPDATE that changed the email).
      if (isEmailVerificationRequired() && updatedUser.email !== currentUser.email) {
        try {
          await emailVerificationService.issueAndSend(updatedUser);
        } catch (verificationError) {
          logVerificationError('[Auth] Failed to issue email verification token', updatedUser.id, verificationError);
        }
      }

      await auditLogService.record({
        action: 'user.profile_updated',
        organizationId: null,
        target: { type: 'user', id: updatedUser.id },
        // field names only, never values (currentPassword/newPassword are in body)
        metadata: { fields: Object.keys(body) },
      });

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

      await auditLogService.record({
        action: 'user.deleted',
        target: { type: 'user', id: currentUser.id },
        organizationId: null,
      });

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
  // Terms acceptance route exists only when the terms seam is active. It covers
  // users who never saw the registration checkbox (pre-existing, SSO) and
  // re-acceptance after LOGTIDE_TERMS_VERSION changes.
  if (getActiveTerms()) {
    fastify.post('/accept-terms', {
      config: {
        rateLimit: {
          max: config.AUTH_RATE_LIMIT_LOGIN,
          timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
        },
      },
      handler: async (request, reply) => {
        const token = request.headers.authorization?.replace('Bearer ', '');
        if (!token) {
          return reply.status(401).send({ error: 'No token provided' });
        }
        const user = await usersService.validateSession(token);
        if (!user) {
          return reply.status(401).send({ error: 'Invalid or expired session' });
        }

        // Read at call time: a version bump must be accepted explicitly, an
        // acceptance of a stale version is refused.
        const terms = getActiveTerms();
        const parsed = acceptTermsSchema.safeParse(request.body ?? {});
        if (!terms || !parsed.success || parsed.data.version !== terms.termsVersion) {
          return reply.status(409).send({ error: 'terms_version_mismatch' });
        }

        await termsAcceptanceService.accept(user.id, terms.termsVersion);

        await auditLogService.record({
          action: 'user.terms_accepted',
          target: { type: 'user', id: user.id },
          organizationId: null,
          actor: { type: 'user', id: user.id, label: user.email },
          metadata: { version: terms.termsVersion },
        });

        return reply.send({ accepted: true, termsVersion: terms.termsVersion });
      },
    });
  }

  // Email verification routes exist only when the gate is on.
  if (isEmailVerificationRequired()) {
    // Consume a verification token. The token is the credential; when the
    // caller is also signed in, a token belonging to another user is rejected
    // without being consumed.
    fastify.post('/verify-email', {
      config: {
        rateLimit: {
          max: config.AUTH_RATE_LIMIT_LOGIN,
          timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
          keyGenerator: (request: { ip: string }) => request.ip,
        },
      },
      handler: async (request, reply) => {
        const parsed = verifyEmailSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: 'invalid_or_expired_token' });
        }

        const bearer = request.headers.authorization?.replace('Bearer ', '');
        const sessionUser = bearer ? await usersService.validateSession(bearer) : null;

        const result = await emailVerificationService.verify(parsed.data.token, sessionUser?.id);
        if (!result.ok) {
          return reply.status(400).send({ error: 'invalid_or_expired_token' });
        }

        await auditLogService.record({
          action: 'user.email_verified',
          target: { type: 'user', id: result.userId },
          organizationId: null,
          actor: { type: 'user', id: result.userId, label: null },
        });

        return reply.send({ verified: true });
      },
    });

    // Resend the verification email. Signed-in callers resend for themselves;
    // otherwise an email in the body is looked up. The answer is always 202 so
    // it never reveals whether an address is registered or already verified.
    fastify.post('/resend-verification', {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: ONE_HOUR_MS,
          keyGenerator: (request: { ip: string }) => request.ip,
        },
      },
      handler: async (request, reply) => {
        const bearer = request.headers.authorization?.replace('Bearer ', '');
        const sessionUser = bearer ? await usersService.validateSession(bearer) : null;

        // Fire and forget: the lookup, token write and SMTP send all run after
        // the response, so its timing never reveals whether the address exists.
        let work: Promise<void> | null = null;
        if (sessionUser) {
          work = emailVerificationService.resendForUser(sessionUser.id);
        } else {
          const parsed = resendVerificationSchema.safeParse(request.body ?? {});
          if (parsed.success && parsed.data.email) {
            work = emailVerificationService.resendForEmail(parsed.data.email);
          }
        }
        if (work) {
          void work.catch((error) =>
            logVerificationError('[Auth] Resend verification failed', sessionUser?.id ?? null, error)
          );
        }

        return reply.status(202).send({
          message: 'If the account exists and is not verified yet, a new verification email has been sent.',
        });
      },
    });
  }
}
