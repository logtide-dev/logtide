import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { sql } from 'kysely';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { usersRoutes } from '../../../modules/users/routes.js';
import { settingsService } from '../../../modules/settings/service.js';
import { hashResetToken, PASSWORD_RESET_TTL_MS } from '../../../modules/users/password-reset.js';
import { createTestUser, STRONG_TEST_PASSWORD } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const cfg = config as { SMTP_HOST?: string };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(usersRoutes, { prefix: '/api/v1/auth' });
  await app.ready();
  return app;
}

function uniqueEmail(tag: string): string {
  return `${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`;
}

async function issueToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await db
    .insertInto('password_reset_tokens')
    .values({
      user_id: userId,
      token_hash: hashResetToken(token),
      expires_at: sql<Date>`NOW() + (${PASSWORD_RESET_TTL_MS} * INTERVAL '1 millisecond')`,
    })
    .execute();
  return token;
}

describe('password strength on auth routes', () => {
  let app: FastifyInstance;
  let smtpHost: string | undefined;

  beforeEach(async () => {
    vi.spyOn(settingsService, 'isSignupEnabled').mockResolvedValue(true);
    vi.spyOn(settingsService, 'getAuthMode').mockResolvedValue('standard');
    smtpHost = cfg.SMTP_HOST;
    cfg.SMTP_HOST = 'localhost';
    app = await buildApp();
  });

  afterEach(async () => {
    cfg.SMTP_HOST = smtpHost;
    vi.restoreAllMocks();
    await app.close();
  });

  const register = (email: string, password: string, name = 'Alex Rossi') =>
    app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, password, name } });

  describe('register', () => {
    it('refuses a short password', async () => {
      const res = await register(uniqueEmail('short'), '12345678');
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Validation error');
      expect(body.details[0]).toMatchObject({ path: ['password'], code: 'weak_password', reason: 'too_short' });
    });

    it('refuses a long but guessable password', async () => {
      const res = await register(uniqueEmail('seq'), '123456789012');
      expect(res.statusCode).toBe(400);
      expect(res.json().details[0]).toMatchObject({ code: 'weak_password', reason: 'too_weak' });
    });

    it('refuses a password built from the email', async () => {
      const email = `alex.rossi${crypto.randomBytes(2).toString('hex')}@northwind.example`;
      const local = email.split('@')[0];
      const res = await register(email, `${local}!`);
      expect(res.statusCode).toBe(400);
    });

    it('accepts a strong password', async () => {
      const res = await register(uniqueEmail('strong'), STRONG_TEST_PASSWORD);
      expect(res.statusCode).toBe(201);
    });
  });

  describe('change password', () => {
    const change = (token: string, newPassword: string, currentPassword: string) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
        payload: { currentPassword, newPassword },
      });

    it('refuses a weak new password', async () => {
      const user = await createTestUser();
      const { token } = await createTestSession(user.id);
      const res = await change(token, '123456789012', user.plainPassword);
      expect(res.statusCode).toBe(400);
      expect(res.json().details[0]).toMatchObject({ path: ['newPassword'], code: 'weak_password' });
    });

    it('accepts a strong new password', async () => {
      const user = await createTestUser();
      const { token } = await createTestSession(user.id);
      const res = await change(token, STRONG_TEST_PASSWORD, user.plainPassword);
      expect(res.statusCode).toBe(200);
    });

    it('accepts a strong new password for a user without a name', async () => {
      const user = await createTestUser();
      await db.updateTable('users').set({ name: '' }).where('id', '=', user.id).execute();
      const { token } = await createTestSession(user.id);
      const res = await change(token, STRONG_TEST_PASSWORD, user.plainPassword);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('reset confirm', () => {
    const confirm = (token: string, password: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/password-reset/confirm', payload: { token, password } });

    it('refuses a weak password without consuming the token', async () => {
      const user = await createTestUser();
      const token = await issueToken(user.id);

      const weak = await confirm(token, '123456789012');
      expect(weak.statusCode).toBe(400);
      expect(weak.json().details[0]).toMatchObject({ path: ['password'], code: 'weak_password' });

      const strong = await confirm(token, STRONG_TEST_PASSWORD);
      expect(strong.statusCode).toBe(200);
      expect(strong.json()).toEqual({ reset: true });
    });

    it('still answers invalid_or_expired_token for an unknown token', async () => {
      const res = await confirm(crypto.randomBytes(32).toString('base64url'), '123456789012');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_or_expired_token' });
    });
  });
});
