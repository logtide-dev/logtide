import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { usersRoutes } from '../../../modules/users/routes.js';
import { usersService } from '../../../modules/users/service.js';
import { settingsService } from '../../../modules/settings/service.js';

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
          password: 'password123',
          name: 'New User',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('newuser@example.com');
      expect(body.user.name).toBe('New User');
      expect(body.session.token).toBeDefined();
    });

    it('should return 400 for invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'invalid-email',
          password: 'password123',
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
          password: 'password123',
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
          password: 'password123',
          name: 'First User',
        },
      });

      // Second registration with same email
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'password456',
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
          password: 'password123',
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
        password: 'password123',
        name: 'Login User',
      });
    });

    it('should login with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'login@example.com',
          password: 'password123',
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
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /logout', () => {
    it('should logout with valid token', async () => {
      const user = await usersService.createUser({
        email: 'logout@example.com',
        password: 'password123',
        name: 'Logout User',
      });

      const session = await usersService.login({
        email: 'logout@example.com',
        password: 'password123',
      });

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
        password: 'password123',
        name: 'Me User',
      });

      const session = await usersService.login({
        email: 'me@example.com',
        password: 'password123',
      });

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
      await usersService.createUser({
        email: 'update@example.com',
        password: 'password123',
        name: 'Old Name',
      });

      const session = await usersService.login({
        email: 'update@example.com',
        password: 'password123',
      });

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
      await usersService.createUser({
        email: 'oldemail@example.com',
        password: 'password123',
        name: 'Test User',
      });

      const session = await usersService.login({
        email: 'oldemail@example.com',
        password: 'password123',
      });

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
      await usersService.createUser({
        email: 'password@example.com',
        password: 'oldpassword',
        name: 'Test User',
      });

      const session = await usersService.login({
        email: 'password@example.com',
        password: 'oldpassword',
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          currentPassword: 'oldpassword',
          newPassword: 'newpassword123',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify can login with new password
      const newSession = await usersService.login({
        email: 'password@example.com',
        password: 'newpassword123',
      });
      expect(newSession.token).toBeDefined();
    });

    it('should return 400 when changing password without current password', async () => {
      await usersService.createUser({
        email: 'nopassword@example.com',
        password: 'password123',
        name: 'Test User',
      });

      const session = await usersService.login({
        email: 'nopassword@example.com',
        password: 'password123',
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          newPassword: 'newpassword123',
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
        password: 'password123',
        name: 'Existing User',
      });

      await usersService.createUser({
        email: 'changemail@example.com',
        password: 'password123',
        name: 'Change Mail User',
      });

      const session = await usersService.login({
        email: 'changemail@example.com',
        password: 'password123',
      });

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
      await usersService.createUser({
        email: 'delete@example.com',
        password: 'password123',
        name: 'Delete User',
      });

      const session = await usersService.login({
        email: 'delete@example.com',
        password: 'password123',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/me',
        headers: {
          authorization: `Bearer ${session.token}`,
        },
        payload: {
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(204);

      // Verify user is deleted
      const user = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'delete@example.com')
        .executeTakeFirst();
      expect(user).toBeUndefined();
    });

    it('should return 400 with incorrect password', async () => {
      await usersService.createUser({
        email: 'nodelete@example.com',
        password: 'password123',
        name: 'No Delete User',
      });

      const session = await usersService.login({
        email: 'nodelete@example.com',
        password: 'password123',
      });

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
      await usersService.createUser({
        email: 'needpassword@example.com',
        password: 'password123',
        name: 'Need Password User',
      });

      const session = await usersService.login({
        email: 'needpassword@example.com',
        password: 'password123',
      });

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
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
