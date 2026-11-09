import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { hub } from '@logtide/core';
import { db } from '../../../database/index.js';
import { usersRoutes } from '../../../modules/users/routes.js';
import { usersService } from '../../../modules/users/service.js';
import { settingsService } from '../../../modules/settings/service.js';
import { authenticationService } from '../../../modules/auth/authentication-service.js';
import { AuthError, AuthErrorCode } from '../../../modules/auth/providers/types.js';
import { createTestSession } from '../../helpers/auth.js';
import { STRONG_TEST_PASSWORD } from '../../helpers/factories.js';

// Mock internal observability so the auto-login failure path is fully
// exercised (isInternalLoggingEnabled is env-driven and off in tests)
vi.mock('@logtide/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@logtide/core')>()),
  hub: { captureLog: vi.fn() },
}));
vi.mock('../../../utils/internal-logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/internal-logger.js')>()),
  isInternalLoggingEnabled: () => true,
}));

// Mock settingsService
vi.mock('../../../modules/settings/service.js', () => ({
  settingsService: {
    isSignupEnabled: vi.fn().mockResolvedValue(true),
    getAuthMode: vi.fn().mockResolvedValue('local'),
  },
}));

// Mock bootstrapService
vi.mock('../../../modules/bootstrap/service.js', () => ({
  bootstrapService: {
    getDefaultUser: vi.fn().mockResolvedValue(null),
  },
}));

describe('Users Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();

    // Mock rate limit config
    app.decorateReply('rateLimit', null);
    app.addHook('onRequest', async (request) => {
      (request as any).rateLimit = { max: 100, timeWindow: '1 minute' };
    });

    // Clean up
    await db.deleteFrom('log_identifiers').execute();
    await db.deleteFrom('logs').execute();
    await db.deleteFrom('alert_history').execute();
    await db.deleteFrom('sigma_rules').execute();
    await db.deleteFrom('alert_rules').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('notifications').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();

    await app.register(usersRoutes);
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  describe('POST /register', () => {
    it('should register a new user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'newuser@example.com',
          password: STRONG_TEST_PASSWORD,
          name: 'New User',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('newuser@example.com');
      expect(body.user.name).toBe('New User');
      expect(body.session.token).toBeDefined();
    });

    it('returns 201 without a session and logs when auto-login fails', async () => {
      const authSpy = vi.spyOn(authenticationService, 'authenticateWithProvider')
        .mockRejectedValueOnce(new Error('session backend unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'no-session@example.com',
          password: STRONG_TEST_PASSWORD,
          name: 'No Session',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('no-session@example.com');
      expect(body.session).toBeUndefined();

      // The swallowed failure must be visible to operators
      expect(hub.captureLog).toHaveBeenCalledWith(
        'error',
        '[Auth] Post-registration auto-login failed',
        expect.objectContaining({ error: 'session backend unavailable' })
      );

      // Only the registration auto-login was forced to fail; the account exists
      // and is recoverable via a normal login through the provider path.
      authSpy.mockRestore();
      const result = await authenticationService.authenticateWithProvider('local', {
        email: 'no-session@example.com',
        password: STRONG_TEST_PASSWORD,
      });
      expect(result.session.token).toBeDefined();
    });

    it('should return 400 for invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'invalid-email',
          password: STRONG_TEST_PASSWORD,
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'test@example.com',
          password: 'short',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'test@example.com',
          password: STRONG_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 409 for duplicate email', async () => {
      // First registration
      await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'duplicate@example.com',
          password: STRONG_TEST_PASSWORD,
          name: 'First User',
        },
      });

      // Second registration with same email
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'orbit-Granite-Tidal-59',
          name: 'Second User',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 403 when signup is disabled', async () => {
      vi.mocked(settingsService.isSignupEnabled).mockResolvedValueOnce(false);

      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'test@example.com',
          password: STRONG_TEST_PASSWORD,
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('SIGNUP_DISABLED');
    });
  });

  describe('POST /login', () => {
    beforeEach(async () => {
      await usersService.createUser({
        email: 'login@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Login User',
      });
    });

    it('should login with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'login@example.com',
          password: STRONG_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('login@example.com');
      expect(body.session.token).toBeDefined();
    });

    it('should return 401 for invalid password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'login@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for non-existent user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'nonexistent@example.com',
          password: STRONG_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          password: STRONG_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 503 when the local provider is unavailable', async () => {
      const authSpy = vi.spyOn(authenticationService, 'authenticateWithProvider')
        .mockRejectedValueOnce(
          new AuthError("Authentication provider 'local' not found or disabled", AuthErrorCode.PROVIDER_UNAVAILABLE)
        );

      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'login@example.com',
          password: STRONG_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(503);
      authSpy.mockRestore();
    });
  });

  describe('POST /logout', () => {
    it('should logout with valid token', async () => {
      const user = await usersService.createUser({
        email: 'logout@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Logout User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'POST',
        url: '/logout',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Logged out successfully');
    });

    it('should return 401 without token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/logout',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /me', () => {
    it('should return user profile with valid token', async () => {
      const user = await usersService.createUser({
        email: 'me@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Me User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'GET',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('me@example.com');
      expect(body.user.name).toBe('Me User');
    });

    it('should return 401 without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/me',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('PUT /me', () => {
    it('should update user name', async () => {
      const user = await usersService.createUser({
        email: 'update@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Old Name',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          name: 'New Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.name).toBe('New Name');
    });

    it('should update email', async () => {
      const user = await usersService.createUser({
        email: 'oldemail@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Test User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          email: 'newemail@example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('newemail@example.com');
    });

    it('should update password with correct current password', async () => {
      const user = await usersService.createUser({
        email: 'password@example.com',
        password: 'oldpassword',
        name: 'Test User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          currentPassword: 'oldpassword',
          newPassword: 'granite-Tidal-Orbit-58',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the new password authenticates through the provider path
      const result = await authenticationService.authenticateWithProvider('local', {
        email: 'password@example.com',
        password: 'granite-Tidal-Orbit-58',
      });
      expect(result.session.token).toBeDefined();
    });

    it('should return 400 when changing password without current password', async () => {
      const user = await usersService.createUser({
        email: 'nopassword@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Test User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          newPassword: 'granite-Tidal-Orbit-58',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without token', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        payload: {
          name: 'New Name',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 409 when email already in use', async () => {
      await usersService.createUser({
        email: 'existing@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Existing User',
      });

      const user = await usersService.createUser({
        email: 'changemail@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Change Mail User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          email: 'existing@example.com',
        },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('DELETE /me', () => {
    it('should delete user with correct password', async () => {
      const user = await usersService.createUser({
        email: 'delete@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Delete User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'DELETE',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          password: STRONG_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(204);

      // Verify user is deleted
      const deletedUser = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'delete@example.com')
        .executeTakeFirst();
      expect(deletedUser).toBeUndefined();
    });

    it('should return 400 with incorrect password', async () => {
      const user = await usersService.createUser({
        email: 'nodelete@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'No Delete User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'DELETE',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 without password', async () => {
      const user = await usersService.createUser({
        email: 'needpassword@example.com',
        password: STRONG_TEST_PASSWORD,
        name: 'Need Password User',
      });

      const session = await createTestSession(user.id);

      const response = await app.inject({
        method: 'DELETE',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/me',
        payload: {
          password: STRONG_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
