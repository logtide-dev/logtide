import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { settingsRoutes, publicSettingsRoutes } from '../../../modules/settings/routes.js';
import { settingsService, SETTING_KEYS } from '../../../modules/settings/service.js';
import { createTestUser } from '../../helpers/factories.js';
import { CacheManager } from '../../../utils/cache.js';
import crypto from 'crypto';

// Helper to create a session for a user
async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db
    .insertInto('sessions')
    .values({
      user_id: userId,
      token,
      expires_at: expiresAt,
    })
    .execute();

  return { token, expiresAt };
}

// Helper to create an admin user
async function createAdminUser() {
  const user = await createTestUser({ email: `admin-${Date.now()}@test.com`, name: 'Admin User' });
  await db
    .updateTable('users')
    .set({ is_admin: true })
    .where('id', '=', user.id)
    .execute();
  return { ...user, is_admin: true };
}

describe('Settings Routes', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userToken: string;
  let adminUser: any;
  let regularUser: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(settingsRoutes, { prefix: '/api/v1/admin/settings' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up in correct order
    await db.deleteFrom('system_settings').execute();
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
    await CacheManager.invalidateSettings();

    // Create admin user
    adminUser = await createAdminUser();
    const adminSession = await createTestSession(adminUser.id);
    adminToken = adminSession.token;

    // Create regular user
    regularUser = await createTestUser({ email: 'regular@test.com' });
    const userSession = await createTestSession(regularUser.id);
    userToken = userSession.token;
  });

  describe('Authentication & Authorization', () => {
    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty('error');
    });

    it('should return 403 for non-admin users', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toHaveProperty('error', 'Admin access required');
    });

    it('should allow admin users', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/admin/settings', () => {
    it('should return all settings with defaults', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('settings');
      expect(body.settings).toHaveProperty(SETTING_KEYS.AUTH_SIGNUP_ENABLED, true);
      expect(body.settings).toHaveProperty(SETTING_KEYS.AUTH_MODE, 'standard');
    });

    it('should return stored settings', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.settings[SETTING_KEYS.AUTH_SIGNUP_ENABLED]).toBe(false);
    });
  });

  describe('GET /api/v1/admin/settings/:key', () => {
    it('should return a specific setting', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/settings/${SETTING_KEYS.AUTH_SIGNUP_ENABLED}`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('setting');
      expect(body.setting.value).toBe(false);
    });

    it('should return 404 for non-existent setting', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings/non.existent.key',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty('error', 'Setting not found');
    });
  });

  describe('PUT /api/v1/admin/settings/:key', () => {
    it('should update a valid setting', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/settings/${SETTING_KEYS.AUTH_SIGNUP_ENABLED}`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: { value: false },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.value).toBe(false);

      // Verify in database
      const stored = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(stored).toBe(false);
    });

    it('should reject invalid setting key', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/invalid.key',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: { value: 'test' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid setting key');
    });

    it('should update auth mode setting', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/settings/${SETTING_KEYS.AUTH_MODE}`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: { value: 'none' },
      });

      expect(response.statusCode).toBe(200);

      const stored = await settingsService.get(SETTING_KEYS.AUTH_MODE);
      expect(stored).toBe('none');
    });
  });

  describe('PATCH /api/v1/admin/settings', () => {
    it('should update multiple settings', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          'auth.signup_enabled': false,
          'auth.mode': 'none',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.settings[SETTING_KEYS.AUTH_SIGNUP_ENABLED]).toBe(false);
      expect(body.settings[SETTING_KEYS.AUTH_MODE]).toBe('none');
    });

    it('should reject invalid auth mode', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          'auth.mode': 'invalid-mode',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('error', 'Validation error');
    });

    it('should reject invalid signup_enabled type', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          'auth.signup_enabled': 'not-a-boolean',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/admin/settings/:key', () => {
    it('should delete a setting', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/${SETTING_KEYS.AUTH_SIGNUP_ENABLED}`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(204);

      // Verify it returns default now
      const stored = await settingsService.get(SETTING_KEYS.AUTH_SIGNUP_ENABLED);
      expect(stored).toBe(true); // Default value
    });

    it('should not fail when deleting non-existent setting', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/settings/non.existent.key',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });
  });
});

describe('Public Settings Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(publicSettingsRoutes, { prefix: '/api/v1/auth' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('system_settings').execute();
    await CacheManager.invalidateSettings();
  });

  describe('GET /api/v1/auth/config', () => {
    it('should return default auth config without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/config',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('authMode', 'standard');
      expect(body).toHaveProperty('signupEnabled', true);
      expect(body).toHaveProperty('requiresLogin', true);
    });

    it('should return stored auth config', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_MODE, 'none');
      await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/config',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.authMode).toBe('none');
      expect(body.signupEnabled).toBe(false);
      expect(body.requiresLogin).toBe(false);
    });

    it('should indicate login not required in auth-free mode', async () => {
      await settingsService.set(SETTING_KEYS.AUTH_MODE, 'none');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/config',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.requiresLogin).toBe(false);
    });
  });
});
