import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { sql } from 'kysely';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { usersRoutes } from '../../../modules/users/routes.js';
import { publicSettingsRoutes } from '../../../modules/settings/routes.js';
import { authenticationService } from '../../../modules/auth/authentication-service.js';
import { providerRegistry } from '../../../modules/auth/providers/registry.js';
import { usersService } from '../../../modules/users/service.js';
import { settingsService } from '../../../modules/settings/service.js';
import {
  passwordResetService,
  getPasswordResetConfig,
  hashResetToken,
  PASSWORD_RESET_TTL_MS,
} from '../../../modules/users/password-reset.js';
import { createTestUser } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const cfg = config as { SMTP_HOST?: string };

beforeEach(() => {
  vi.spyOn(settingsService, 'isSignupEnabled').mockResolvedValue(true);
  vi.spyOn(settingsService, 'getAuthMode').mockResolvedValue('standard');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function buildApp(opts: { withRateLimit?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  if (opts.withRateLimit) {
    await app.register(rateLimit, { max: 10000, timeWindow: 60000 });
  }
  await app.register(usersRoutes, { prefix: '/api/v1/auth' });
  await app.register(publicSettingsRoutes, { prefix: '/api/v1/auth' });
  await app.ready();
  return app;
}

function uniqueEmail(tag: string): string {
  return `${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`;
}

async function tokenFromMailhog(email: string): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
    const data = (await res.json()) as { items: Array<{ Content: { Body: string } }> };
    if (data.items.length > 0) {
      const body = data.items[0].Content.Body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
      const m = body.match(/reset-password\?token=([A-Za-z0-9_-]{43})/);
      return m ? m[1] : null;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function mailCount(email: string): Promise<number> {
  const res = await fetch(`http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
  const data = (await res.json()) as { total: number };
  return data.total;
}

async function tokenRows(userId: string) {
  return db.selectFrom('password_reset_tokens').selectAll().where('user_id', '=', userId).execute();
}

async function waitForTokens(userId: string, count: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if ((await tokenRows(userId)).length >= count) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Issue a token the way the service does and return the raw value. */
async function issueToken(userId: string, opts: { ageMs?: number; expiresInMs?: number } = {}): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await db
    .insertInto('password_reset_tokens')
    .values({
      user_id: userId,
      token_hash: hashResetToken(token),
      expires_at: sql<Date>`NOW() + (${opts.expiresInMs ?? PASSWORD_RESET_TTL_MS} * INTERVAL '1 millisecond')`,
      created_at: sql<Date>`NOW() - (${opts.ageMs ?? 0} * INTERVAL '1 millisecond')`,
    })
    .execute();
  return token;
}

function request(app: FastifyInstance, email: unknown, remoteAddress = '127.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/password-reset/request',
    remoteAddress,
    payload: { email },
  });
}

function confirm(app: FastifyInstance, token: string, password: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/password-reset/confirm',
    headers,
    payload: { token, password },
  });
}

describe('password reset', () => {
  let app: FastifyInstance;
  let smtpHost: string | undefined;

  beforeEach(async () => {
    smtpHost = cfg.SMTP_HOST;
    await db.deleteFrom('audit_log').execute();
    app = await buildApp();
  });

  afterEach(async () => {
    cfg.SMTP_HOST = smtpHost;
    await providerRegistry.invalidateCache();
    await app.close();
  });

  describe('request', () => {
    it('returns an identical 202 for unknown, SSO-only, disabled and eligible accounts', async () => {
      const eligible = await createTestUser({ email: uniqueEmail('eligible') });
      const sso = await createTestUser({ email: uniqueEmail('sso'), password: null });
      const disabled = await createTestUser({ email: uniqueEmail('disabled'), disabled: true });

      const responses = [];
      for (const email of [uniqueEmail('nobody'), sso.email, disabled.email, eligible.email]) {
        const res = await request(app, email);
        responses.push({ status: res.statusCode, body: res.json() });
      }

      for (const r of responses) {
        expect(r.status).toBe(202);
        expect(r.body).toEqual(responses[0].body);
      }
    });

    it('creates a hashed token for an eligible user and sends one email', async () => {
      const user = await createTestUser({ email: uniqueEmail('mail') });
      await request(app, user.email);

      const token = await tokenFromMailhog(user.email);
      expect(token).not.toBeNull();

      const rows = await tokenRows(user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(hashResetToken(token!));
      expect(rows[0].token_hash).not.toBe(token);
      expect(JSON.stringify(rows[0])).not.toContain(token!);
      const ttl = new Date(rows[0].expires_at).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(59 * 60_000);
      expect(ttl).toBeLessThanOrEqual(61 * 60_000);
      expect(await mailCount(user.email)).toBe(1);
    });

    it('normalises case and surrounding whitespace', async () => {
      const user = await createTestUser({ email: uniqueEmail('case') });
      await request(app, `  ${user.email.toUpperCase()} `);
      await waitForTokens(user.id, 1);
      expect(await tokenRows(user.id)).toHaveLength(1);
    });

    it('creates no token for unknown, SSO-only (null password_hash) or disabled users', async () => {
      const sso = await createTestUser({ email: uniqueEmail('sso2'), password: null });
      const disabled = await createTestUser({ email: uniqueEmail('dis2'), disabled: true });

      // Direct service call: deterministic, no background timing involved.
      await passwordResetService.requestForEmail(sso.email);
      await passwordResetService.requestForEmail(disabled.email);
      await passwordResetService.requestForEmail(uniqueEmail('ghost'));

      expect(await tokenRows(sso.id)).toHaveLength(0);
      expect(await tokenRows(disabled.id)).toHaveLength(0);
      expect(await db.selectFrom('password_reset_tokens').select('id').execute()).toHaveLength(0);
    });

    it('a second request inside the cooldown creates no new token and still returns 202', async () => {
      const user = await createTestUser({ email: uniqueEmail('cool') });
      const first = await request(app, user.email);
      await waitForTokens(user.id, 1);
      const second = await request(app, user.email);
      expect(second.statusCode).toBe(202);
      expect(second.json()).toEqual(first.json());
      await new Promise((r) => setTimeout(r, 300));

      expect(await tokenRows(user.id)).toHaveLength(1);
    });

    it('the fourth request inside an hour creates no token', async () => {
      const user = await createTestUser({ email: uniqueEmail('cap') });
      // Three earlier tokens, each older than the cooldown but inside the hour.
      await issueToken(user.id, { ageMs: 10 * 60_000 });
      await issueToken(user.id, { ageMs: 8 * 60_000 });
      await issueToken(user.id, { ageMs: 6 * 60_000 });

      await passwordResetService.requestForEmail(user.email);
      expect(await tokenRows(user.id)).toHaveLength(3);

      // Once the oldest falls out of the window a new one is allowed again.
      await db
        .updateTable('password_reset_tokens')
        .set({ created_at: sql<Date>`NOW() - INTERVAL '2 hours'` })
        .where('user_id', '=', user.id)
        .where('created_at', '<', sql<Date>`NOW() - INTERVAL '9 minutes'`)
        .execute();
      await passwordResetService.requestForEmail(user.email);
      expect(await tokenRows(user.id)).toHaveLength(4);
    });

    it('a newer request invalidates the older token', async () => {
      const user = await createTestUser({ email: uniqueEmail('newer') });
      const oldToken = await issueToken(user.id, { ageMs: 5 * 60_000 });

      await passwordResetService.requestForEmail(user.email);
      const newToken = await tokenFromMailhog(user.email);
      expect(newToken).not.toBeNull();

      const stale = await confirm(app, oldToken, 'brand-new-pass-1');
      expect(stale.statusCode).toBe(400);
      expect(stale.json()).toEqual({ error: 'invalid_or_expired_token' });

      const fresh = await confirm(app, newToken!, 'brand-new-pass-1');
      expect(fresh.statusCode).toBe(200);
    });

    it('does not log the token or the address', async () => {
      const spy = vi.spyOn(console, 'log');
      const user = await createTestUser({ email: uniqueEmail('quiet') });
      await passwordResetService.requestForEmail(user.email);
      const token = await tokenFromMailhog(user.email);
      const output = JSON.stringify(spy.mock.calls);
      expect(output).not.toContain(user.email);
      expect(output).not.toContain(token!);
    });
  });

  describe('confirm', () => {
    it('changes the password', async () => {
      const user = await createTestUser({ email: uniqueEmail('change'), password: 'old-password-1' });
      const token = await issueToken(user.id);

      const res = await confirm(app, token, 'new-password-1');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ reset: true });

      const good = await authenticationService.authenticateWithProvider('local', {
        email: user.email,
        password: 'new-password-1',
      });
      expect(good.user.id).toBe(user.id);
      await expect(
        authenticationService.authenticateWithProvider('local', { email: user.email, password: 'old-password-1' }),
      ).rejects.toBeDefined();
    });

    it('is single use', async () => {
      const user = await createTestUser({ email: uniqueEmail('once') });
      const token = await issueToken(user.id);
      expect((await confirm(app, token, 'new-password-1')).statusCode).toBe(200);
      const again = await confirm(app, token, 'another-password-2');
      expect(again.statusCode).toBe(400);
      expect(again.json()).toEqual({ error: 'invalid_or_expired_token' });
    });

    it('rejects an expired token', async () => {
      const user = await createTestUser({ email: uniqueEmail('exp') });
      const token = await issueToken(user.id);
      await db
        .updateTable('password_reset_tokens')
        .set({ expires_at: sql<Date>`NOW() - INTERVAL '1 minute'` })
        .where('user_id', '=', user.id)
        .execute();
      const res = await confirm(app, token, 'new-password-1');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_or_expired_token' });
    });

    it('returns the same 400 body for unknown and used tokens', async () => {
      const user = await createTestUser({ email: uniqueEmail('same') });
      const used = await issueToken(user.id);
      await confirm(app, used, 'new-password-1');

      const unknown = await confirm(app, crypto.randomBytes(32).toString('base64url'), 'new-password-1');
      const reused = await confirm(app, used, 'new-password-1');
      expect(unknown.statusCode).toBe(400);
      expect(reused.statusCode).toBe(400);
      expect(unknown.json()).toEqual(reused.json());
    });

    it('revokes every session including a cached one', async () => {
      const user = await createTestUser({ email: uniqueEmail('sess') });
      const s1 = await createTestSession(user.id);
      const s2 = await createTestSession(user.id);
      // Warm the cache for the first session.
      expect(await usersService.validateSession(s1.token)).not.toBeNull();

      const token = await issueToken(user.id);
      expect((await confirm(app, token, 'new-password-1')).statusCode).toBe(200);

      expect(await usersService.validateSession(s1.token)).toBeNull();
      expect(await usersService.validateSession(s2.token)).toBeNull();
      expect(await db.selectFrom('sessions').select('id').where('user_id', '=', user.id).execute()).toHaveLength(0);
    });

    it('marks the email verified when it was null', async () => {
      const user = await createTestUser({ email: uniqueEmail('verify') });
      await db.updateTable('users').set({ email_verified_at: null }).where('id', '=', user.id).execute();
      const token = await issueToken(user.id);
      await confirm(app, token, 'new-password-1');
      const row = await db.selectFrom('users').select('email_verified_at').where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(row.email_verified_at).not.toBeNull();
    });

    it('rejects a token of a disabled user and an SSO-only user', async () => {
      const disabled = await createTestUser({ email: uniqueEmail('dis3') });
      const token = await issueToken(disabled.id);
      await db.updateTable('users').set({ disabled: true }).where('id', '=', disabled.id).execute();
      expect((await confirm(app, token, 'new-password-1')).statusCode).toBe(400);

      const sso = await createTestUser({ email: uniqueEmail('sso3'), password: null });
      const ssoToken = await issueToken(sso.id);
      expect((await confirm(app, ssoToken, 'new-password-1')).statusCode).toBe(400);
      const row = await db.selectFrom('users').select('password_hash').where('id', '=', sso.id).executeTakeFirstOrThrow();
      expect(row.password_hash).toBeNull();
    });

    it('a short password returns 400 validation error and does not consume the token', async () => {
      const user = await createTestUser({ email: uniqueEmail('short') });
      const token = await issueToken(user.id);

      const res = await confirm(app, token, 'short');
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Validation error');

      const rows = await tokenRows(user.id);
      expect(rows[0].used_at).toBeNull();
      expect((await confirm(app, token, 'long-enough-pass')).statusCode).toBe(200);
    });

    it('a token opened while signed in as someone else is rejected and not consumed', async () => {
      const owner = await createTestUser({ email: uniqueEmail('owner') });
      const other = await createTestUser({ email: uniqueEmail('other') });
      const otherSession = await createTestSession(other.id);
      const token = await issueToken(owner.id);

      const res = await confirm(app, token, 'new-password-1', { authorization: `Bearer ${otherSession.token}` });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_or_expired_token' });
      expect((await tokenRows(owner.id))[0].used_at).toBeNull();

      expect((await confirm(app, token, 'new-password-1')).statusCode).toBe(200);
    });

    it('writes audit rows for requested, completed and session_revoked with reason password_reset', async () => {
      const user = await createTestUser({ email: uniqueEmail('audit') });
      await passwordResetService.requestForEmail(user.email);
      const token = await tokenFromMailhog(user.email);
      await confirm(app, token!, 'new-password-1');

      const rows = await db.selectFrom('audit_log').selectAll().execute();
      const actions = rows.map((r) => r.action);
      expect(actions).toContain('user.password_reset_requested');
      expect(actions).toContain('user.password_reset_completed');
      const revoked = rows.find((r) => r.action === 'auth.session_revoked');
      expect(revoked).toBeDefined();
      expect((revoked!.metadata as any).reason).toBe('password_reset');
    });
  });

  describe('availability', () => {
    it('both routes return 404 password_reset_unavailable when SMTP is unset', async () => {
      cfg.SMTP_HOST = undefined;
      const a = await request(app, 'a@example.com');
      const b = await confirm(app, 'x', 'long-enough-pass');
      expect(a.statusCode).toBe(404);
      expect(a.json()).toEqual({ error: 'password_reset_unavailable' });
      expect(b.statusCode).toBe(404);
      expect(await getPasswordResetConfig()).toEqual({});
      const conf = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
      expect('passwordResetEnabled' in conf).toBe(false);
    });

    it('both routes return 404 when the local provider is disabled', async () => {
      await db.updateTable('auth_providers').set({ enabled: false }).where('slug', '=', 'local').execute();
      await providerRegistry.invalidateCache();
      try {
        expect((await request(app, 'a@example.com')).statusCode).toBe(404);
        expect((await confirm(app, 'x', 'long-enough-pass')).statusCode).toBe(404);
        expect(await getPasswordResetConfig()).toEqual({});
      } finally {
        await db.updateTable('auth_providers').set({ enabled: true }).where('slug', '=', 'local').execute();
        await providerRegistry.invalidateCache();
      }
    });

    it('exposes passwordResetEnabled in the public config when available', async () => {
      expect(await getPasswordResetConfig()).toEqual({ passwordResetEnabled: true });
      const conf = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
      expect(conf.passwordResetEnabled).toBe(true);
    });
  });

  describe('rate limit', () => {
    it('returns 429 after AUTH_RATE_LIMIT_LOGIN calls from one IP', async () => {
      const limited = await buildApp({ withRateLimit: true });
      try {
        const max = config.AUTH_RATE_LIMIT_LOGIN;
        const email = uniqueEmail('rl-nobody');
        for (let i = 0; i < max; i++) {
          expect((await request(limited, email, '10.9.9.9')).statusCode).toBe(202);
        }
        expect((await request(limited, email, '10.9.9.9')).statusCode).toBe(429);
        // Another IP is unaffected.
        expect((await request(limited, email, '10.9.9.10')).statusCode).toBe(202);
      } finally {
        await limited.close();
      }
    });
  });
});
