import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { db } from '../../../database/index.js';
import { config, configSchema } from '../../../config/index.js';
import { usersRoutes } from '../../../modules/users/routes.js';
import { publicSettingsRoutes } from '../../../modules/settings/routes.js';
import { projectsRoutes } from '../../../modules/projects/routes.js';
import { apiKeysRoutes } from '../../../modules/api-keys/routes.js';
import { authenticationService } from '../../../modules/auth/authentication-service.js';
import { settingsService } from '../../../modules/settings/service.js';
import {
  emailVerificationService,
  hashVerificationToken,
  RESEND_COOLDOWN_MS,
} from '../../../modules/users/email-verification.js';
import { createTestUser, createTestOrganization, createTestProject } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

beforeEach(() => {
  vi.spyOn(settingsService, 'isSignupEnabled').mockResolvedValue(true);
  vi.spyOn(settingsService, 'getAuthMode').mockResolvedValue('standard');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const cfg = config as { REQUIRE_EMAIL_VERIFICATION: boolean; REGISTRATION_RATE_LIMIT_PER_HOUR?: number };
const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_KEY_SECRET: 'x'.repeat(32),
};

async function buildApp(opts: { withRateLimit?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  if (opts.withRateLimit) {
    await app.register(rateLimit, { max: 10000, timeWindow: 60000 });
  }
  await app.register(usersRoutes, { prefix: '/api/v1/auth' });
  await app.register(publicSettingsRoutes, { prefix: '/api/v1/auth' });
  await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
  await app.register(apiKeysRoutes, { prefix: '/api/v1/projects' });
  await app.ready();
  return app;
}

function uniqueEmail(tag: string): string {
  return `${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`;
}

async function register(app: FastifyInstance, email: string, remoteAddress = '127.0.0.1', headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress,
    headers,
    payload: { email, password: 'password123', name: 'Verify Me' },
  });
}

async function tokenFromMailhog(email: string): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
    const data = (await res.json()) as { items: Array<{ Content: { Body: string } }> };
    if (data.items.length > 0) {
      const body = data.items[0].Content.Body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
      const m = body.match(/verify-email\?token=([A-Za-z0-9_-]{43})/);
      return m ? m[1] : null;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function seedToken(userId: string, opts: { expired?: boolean } = {}): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await db
    .insertInto('email_verification_tokens')
    .values({
      user_id: userId,
      token_hash: hashVerificationToken(token),
      expires_at: new Date(Date.now() + (opts.expired ? -60_000 : 3_600_000)),
    })
    .execute();
  return token;
}

async function unverifiedUser(tag: string) {
  const user = await createTestUser({ email: uniqueEmail(tag) });
  await db.updateTable('users').set({ email_verified_at: null }).where('id', '=', user.id).execute();
  return user;
}

async function cleanDb() {
  await db.deleteFrom('api_keys').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('organization_members').execute();
  await db.deleteFrom('organizations').execute();
  await db.deleteFrom('sessions').execute();
  await db.deleteFrom('email_verification_tokens').execute();
  await db.deleteFrom('users').execute();
}

describe('email verification env validation', () => {
  const parse = (extra: Record<string, string>) => configSchema.safeParse({ ...base, ...extra });

  it('REQUIRE_EMAIL_VERIFICATION defaults to false', () => {
    const a = parse({});
    expect(a.success && a.data.REQUIRE_EMAIL_VERIFICATION).toBe(false);
    const b = parse({ REQUIRE_EMAIL_VERIFICATION: '' });
    expect(b.success && b.data.REQUIRE_EMAIL_VERIFICATION).toBe(false);
  });

  it('REQUIRE_EMAIL_VERIFICATION accepts true/false and rejects anything else', () => {
    const on = parse({ REQUIRE_EMAIL_VERIFICATION: 'true' });
    expect(on.success && on.data.REQUIRE_EMAIL_VERIFICATION).toBe(true);
    expect(parse({ REQUIRE_EMAIL_VERIFICATION: 'yes' }).success).toBe(false);
  });

  it('REGISTRATION_RATE_LIMIT_PER_HOUR is unset by default and must be a positive integer', () => {
    const a = parse({});
    expect(a.success && a.data.REGISTRATION_RATE_LIMIT_PER_HOUR).toBeUndefined();
    const b = parse({ REGISTRATION_RATE_LIMIT_PER_HOUR: '' });
    expect(b.success && b.data.REGISTRATION_RATE_LIMIT_PER_HOUR).toBeUndefined();
    const c = parse({ REGISTRATION_RATE_LIMIT_PER_HOUR: '5' });
    expect(c.success && c.data.REGISTRATION_RATE_LIMIT_PER_HOUR).toBe(5);
    for (const v of ['0', '-1', '1.5', 'abc']) {
      expect(parse({ REGISTRATION_RATE_LIMIT_PER_HOUR: v }).success).toBe(false);
    }
  });
});

describe('email verification gate OFF (default)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    cfg.REQUIRE_EMAIL_VERIFICATION = false;
    await cleanDb();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers, auto-logs in and marks the user verified without a token or email', async () => {
    const email = uniqueEmail('off');
    const res = await register(app, email);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.session.token).toBeDefined();
    expect('emailVerified' in body.user).toBe(false);

    const row = await db.selectFrom('users').select('email_verified_at').where('email', '=', email).executeTakeFirstOrThrow();
    expect(row.email_verified_at).not.toBeNull();
    const tokens = await db.selectFrom('email_verification_tokens').selectAll().execute();
    expect(tokens).toHaveLength(0);
    expect(await tokenFromMailhogOnce(email)).toBe(0);

    const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${body.session.token}` } })).json();
    expect('emailVerified' in me.user).toBe(false);
  });

  it('does not expose the verification routes or the config key', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', payload: {} })).statusCode).toBe(404);
    const conf = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect('emailVerificationRequired' in conf).toBe(false);
  });

  it('never blocks project or API key creation, even for a null email_verified_at', async () => {
    const user = await unverifiedUser('off-null');
    const org = await createTestOrganization({ ownerId: user.id });
    const session = await createTestSession(user.id);
    const headers = { authorization: `Bearer ${session.token}` };
    const proj = await app.inject({ method: 'POST', url: '/api/v1/projects', headers, payload: { organizationId: org.id, name: 'P' } });
    expect(proj.statusCode).toBe(201);
    const key = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${proj.json().project.id}/api-keys`,
      headers,
      payload: { name: 'k' },
    });
    expect(key.statusCode).toBe(201);
  });
});

async function tokenFromMailhogOnce(email: string): Promise<number> {
  const res = await fetch(`http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
  const data = (await res.json()) as { total: number };
  return data.total;
}

describe('email verification gate ON', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    cfg.REQUIRE_EMAIL_VERIFICATION = true;
    await cleanDb();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    cfg.REQUIRE_EMAIL_VERIFICATION = false;
  });

  it('auth config exposes emailVerificationRequired', async () => {
    const conf = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect(conf.emailVerificationRequired).toBe(true);
  });

  it('full flow: register sends a mail, gates projects and API keys, verify unlocks them', async () => {
    const email = uniqueEmail('on');
    const res = await register(app, email);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.session.token).toBeDefined(); // login is still allowed
    expect(body.user.emailVerified).toBe(false);
    const headers = { authorization: `Bearer ${body.session.token}` };

    const row = await db.selectFrom('users').select(['id', 'email_verified_at']).where('email', '=', email).executeTakeFirstOrThrow();
    expect(row.email_verified_at).toBeNull();

    // Email delivered to mailhog, token stored only as a sha256 hash
    const token = await tokenFromMailhog(email);
    expect(token).not.toBeNull();
    const stored = await db.selectFrom('email_verification_tokens').selectAll().where('user_id', '=', row.id).execute();
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).toBe(hashVerificationToken(token!));
    expect(stored[0].token_hash).not.toContain(token!);
    const ttl = new Date(stored[0].expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000);

    const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers })).json();
    expect(me.user.emailVerified).toBe(false);

    const org = await createTestOrganization({ ownerId: row.id });
    const blockedProject = await app.inject({ method: 'POST', url: '/api/v1/projects', headers, payload: { organizationId: org.id, name: 'P' } });
    expect(blockedProject.statusCode).toBe(403);
    expect(blockedProject.json()).toEqual({ error: 'email_not_verified' });

    // A project created out of band (e.g. by another org admin) still cannot get keys
    const existing = await createTestProject({ organizationId: org.id, userId: row.id, name: 'Existing' });
    const blockedKey = await app.inject({ method: 'POST', url: `/api/v1/projects/${existing.id}/api-keys`, headers, payload: { name: 'k' } });
    expect(blockedKey.statusCode).toBe(403);
    expect(blockedKey.json()).toEqual({ error: 'email_not_verified' });

    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ verified: true });

    const meAfter = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers })).json();
    expect(meAfter.user.emailVerified).toBe(true);

    const key = await app.inject({ method: 'POST', url: `/api/v1/projects/${existing.id}/api-keys`, headers, payload: { name: 'k' } });
    expect(key.statusCode).toBe(201);
    const proj = await app.inject({ method: 'POST', url: '/api/v1/projects', headers, payload: { organizationId: org.id, name: 'P2' } });
    expect(proj.statusCode).toBe(201);

    // Single use
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toEqual({ error: 'invalid_or_expired_token' });
  });

  it('rejects an expired token with 400', async () => {
    const user = await unverifiedUser('expired');
    const token = await seedToken(user.id, { expired: true });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
    expect(res.statusCode).toBe(400);
    expect(await emailVerificationService.isVerified(user.id)).toBe(false);
  });

  it('rejects unknown and malformed tokens with 400', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token: 'nope' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: {} })).statusCode).toBe(400);
  });

  it("rejects another user's token when signed in, without consuming it", async () => {
    const alice = await unverifiedUser('alice');
    const bob = await unverifiedUser('bob');
    const bobToken = await seedToken(bob.id);
    const aliceSession = await createTestSession(alice.id);

    const cross = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      headers: { authorization: `Bearer ${aliceSession.token}` },
      payload: { token: bobToken },
    });
    expect(cross.statusCode).toBe(400);
    expect(await emailVerificationService.isVerified(alice.id)).toBe(false);
    expect(await emailVerificationService.isVerified(bob.id)).toBe(false);

    // Bob can still use his own link
    const own = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token: bobToken } });
    expect(own.statusCode).toBe(200);
    expect(await emailVerificationService.isVerified(bob.id)).toBe(true);
    expect(await emailVerificationService.isVerified(alice.id)).toBe(false);
  });

  it('does not block pre-existing (backfilled / default verified) users', async () => {
    const user = await createTestUser({ email: uniqueEmail('legacy') });
    const org = await createTestOrganization({ ownerId: user.id });
    const session = await createTestSession(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${session.token}` },
      payload: { organizationId: org.id, name: 'Legacy' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('resend always answers 202 and only mails unverified accounts', async () => {
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', payload: { email: uniqueEmail('ghost') } });
    expect(unknown.statusCode).toBe(202);

    const verified = await createTestUser({ email: uniqueEmail('verified') });
    const v = await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', payload: { email: verified.email } });
    expect(v.statusCode).toBe(202);
    expect(v.json()).toEqual(unknown.json());
    expect(await db.selectFrom('email_verification_tokens').selectAll().where('user_id', '=', verified.id).execute()).toHaveLength(0);

    const pending = await unverifiedUser('pending');
    const p = await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', payload: { email: pending.email } });
    expect(p.statusCode).toBe(202);
    expect(p.json()).toEqual(unknown.json());
    expect(await tokenFromMailhog(pending.email)).not.toBeNull();
  });

  it('resend for the signed-in user replaces the previous token after the cooldown', async () => {
    const user = await unverifiedUser('resend');
    const session = await createTestSession(user.id);
    const headers = { authorization: `Bearer ${session.token}` };

    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', headers })).statusCode).toBe(202);
    const first = await db.selectFrom('email_verification_tokens').selectAll().where('user_id', '=', user.id).execute();
    expect(first).toHaveLength(1);

    // Inside the cooldown: no new token
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', headers })).statusCode).toBe(202);
    const same = await db.selectFrom('email_verification_tokens').selectAll().where('user_id', '=', user.id).execute();
    expect(same.map((t) => t.id)).toEqual(first.map((t) => t.id));

    // Age the token past the cooldown: the old token is replaced
    await db
      .updateTable('email_verification_tokens')
      .set({ created_at: new Date(Date.now() - RESEND_COOLDOWN_MS - 1000) })
      .where('user_id', '=', user.id)
      .execute();
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', headers })).statusCode).toBe(202);
    const after = await db.selectFrom('email_verification_tokens').selectAll().where('user_id', '=', user.id).execute();
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(first[0].id);
  });

  it('changing the email address requires verifying again', async () => {
    const user = await createTestUser({ email: uniqueEmail('change') });
    const session = await createTestSession(user.id);
    const headers = { authorization: `Bearer ${session.token}` };
    const newEmail = uniqueEmail('changed');
    const res = await app.inject({ method: 'PUT', url: '/api/v1/auth/me', headers, payload: { email: newEmail } });
    expect(res.statusCode).toBe(200);
    expect(await emailVerificationService.isVerified(user.id)).toBe(false);
    expect(await tokenFromMailhog(newEmail)).not.toBeNull();
  });
});

describe('OIDC email verification', () => {
  let providerId: string;
  const provider = () => ({ config: { id: providerId, type: 'oidc', name: 'OIDC', slug: 'verify-oidc', enabled: true, config: {} } });
  const result = (email: string, emailVerified: boolean) => ({
    success: true,
    providerUserId: `sub-${crypto.randomBytes(4).toString('hex')}`,
    email,
    emailVerified,
    name: 'Oidc User',
  });
  const findOrCreate = (p: unknown, r: unknown) =>
    (authenticationService as any).findOrCreateUser(p, r) as Promise<{ user: { id: string } }>;

  beforeEach(async () => {
    await cleanDb();
    await db.deleteFrom('auth_providers').where('slug', '=', 'verify-oidc').execute();
    providerId = crypto.randomUUID();
    await db
      .insertInto('auth_providers')
      .values({ id: providerId, type: 'oidc', name: 'OIDC', slug: 'verify-oidc', enabled: true, config: {} })
      .execute();
  });

  afterEach(async () => {
    cfg.REQUIRE_EMAIL_VERIFICATION = false;
    await db.deleteFrom('user_identities').where('provider_id', '=', providerId).execute();
    await db.deleteFrom('auth_providers').where('id', '=', providerId).execute();
  });

  it('gate on: new user is verified only when the IdP asserts email_verified: true', async () => {
    cfg.REQUIRE_EMAIL_VERIFICATION = true;
    const yes = await findOrCreate(provider(), result(uniqueEmail('oidc-yes'), true));
    expect(await emailVerificationService.isVerified(yes.user.id)).toBe(true);
    const no = await findOrCreate(provider(), result(uniqueEmail('oidc-no'), false));
    expect(await emailVerificationService.isVerified(no.user.id)).toBe(false);
  });

  it('a later login with email_verified: true verifies an unverified OIDC user', async () => {
    cfg.REQUIRE_EMAIL_VERIFICATION = true;
    const r = result(uniqueEmail('oidc-later'), false);
    const first = await findOrCreate(provider(), r);
    expect(await emailVerificationService.isVerified(first.user.id)).toBe(false);
    await findOrCreate(provider(), { ...r, emailVerified: true });
    expect(await emailVerificationService.isVerified(first.user.id)).toBe(true);
  });

  it('gate off: OIDC users are verified regardless of the claim', async () => {
    const no = await findOrCreate(provider(), result(uniqueEmail('oidc-off'), false));
    expect(await emailVerificationService.isVerified(no.user.id)).toBe(true);
  });

  it('local logins never flip the verification state', async () => {
    cfg.REQUIRE_EMAIL_VERIFICATION = true;
    const user = await unverifiedUser('local-login');
    await authenticationService.authenticateWithProvider('local', { email: user.email, password: 'password123' });
    expect(await emailVerificationService.isVerified(user.id)).toBe(false);
  });
});

describe('REGISTRATION_RATE_LIMIT_PER_HOUR', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
    delete cfg.REGISTRATION_RATE_LIMIT_PER_HOUR;
  });

  beforeEach(async () => {
    cfg.REQUIRE_EMAIL_VERIFICATION = false;
    await cleanDb();
  });

  it('caps registrations per IP per hour, keyed by IP only', async () => {
    cfg.REGISTRATION_RATE_LIMIT_PER_HOUR = 2;
    app = await buildApp({ withRateLimit: true });
    const ip = `10.9.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;
    expect((await register(app, uniqueEmail('rl1'), ip)).statusCode).toBe(201);
    // A forged Authorization header must not rotate the key
    expect((await register(app, uniqueEmail('rl2'), ip, { authorization: 'Bearer forged-1' })).statusCode).toBe(201);
    const third = await register(app, uniqueEmail('rl3'), ip, { authorization: 'Bearer forged-2' });
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    // Another address is unaffected
    expect((await register(app, uniqueEmail('rl4'), '10.8.0.1')).statusCode).toBe(201);
  });

  it('unset = only the existing limits apply', async () => {
    app = await buildApp({ withRateLimit: true });
    const ip = '10.7.0.1';
    for (let i = 0; i < 4; i++) {
      expect((await register(app, uniqueEmail(`nolimit${i}`), ip)).statusCode).toBe(201);
    }
  });
});
