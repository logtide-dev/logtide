/**
 * Terms and Privacy acceptance (hosting seam). Active only when
 * LOGTIDE_TERMS_URL, LOGTIDE_PRIVACY_URL and LOGTIDE_TERMS_VERSION are all set.
 * Every HTTP test runs against the REAL app builder from server.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { reservoirReady } from '../../../database/reservoir.js';
import { config, configSchema } from '../../../config/index.js';
import { settingsService } from '../../../modules/settings/index.js';
import { SETTING_KEYS } from '../../../modules/settings/service.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const TERMS_URL = 'https://logtide.example.com/terms';
const PRIVACY_URL = 'https://logtide.example.com/privacy';
const VERSION = '2026-10-19';

const cfg = config as unknown as {
  LOGTIDE_TERMS_URL?: string;
  LOGTIDE_PRIVACY_URL?: string;
  LOGTIDE_TERMS_VERSION?: string;
};

function activate(version = VERSION) {
  cfg.LOGTIDE_TERMS_URL = TERMS_URL;
  cfg.LOGTIDE_PRIVACY_URL = PRIVACY_URL;
  cfg.LOGTIDE_TERMS_VERSION = version;
}
function deactivate() {
  delete cfg.LOGTIDE_TERMS_URL;
  delete cfg.LOGTIDE_PRIVACY_URL;
  delete cfg.LOGTIDE_TERMS_VERSION;
}

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_KEY_SECRET: 'x'.repeat(32),
};

let ipCounter = 1;
function nextIp(): string {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

function uniqueEmail(tag: string): string {
  return `${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`;
}

async function register(app: FastifyInstance, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: nextIp(),
    payload: { email: uniqueEmail('terms'), password: 'password123', name: 'Terms User', ...extra },
  });
}

async function termsColumns(userId: string) {
  return db
    .selectFrom('users')
    .select(['terms_accepted_at', 'terms_version'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
}

async function withSignup<T>(fn: () => Promise<T>): Promise<T> {
  const was = await settingsService.isSignupEnabled();
  if (!was) await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, true);
  try {
    return await fn();
  } finally {
    if (!was) await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);
  }
}

describe('terms acceptance env validation', () => {
  const parse = (extra: Record<string, string>) => configSchema.safeParse({ ...base, ...extra });
  const all = { LOGTIDE_TERMS_URL: TERMS_URL, LOGTIDE_PRIVACY_URL: PRIVACY_URL, LOGTIDE_TERMS_VERSION: VERSION };

  it('is inert when all three are unset or empty', () => {
    const a = parse({});
    expect(a.success).toBe(true);
    if (a.success) {
      expect(a.data.LOGTIDE_TERMS_URL).toBeUndefined();
      expect(a.data.LOGTIDE_PRIVACY_URL).toBeUndefined();
      expect(a.data.LOGTIDE_TERMS_VERSION).toBeUndefined();
    }
    expect(parse({ LOGTIDE_TERMS_URL: '', LOGTIDE_PRIVACY_URL: '', LOGTIDE_TERMS_VERSION: '' }).success).toBe(true);
  });

  it('accepts all three set', () => {
    expect(parse(all).success).toBe(true);
  });

  it('rejects a partial set with a clear message', () => {
    const partials: Array<Record<string, string>> = [
      { LOGTIDE_TERMS_URL: TERMS_URL },
      { LOGTIDE_PRIVACY_URL: PRIVACY_URL },
      { LOGTIDE_TERMS_VERSION: VERSION },
      { LOGTIDE_TERMS_URL: TERMS_URL, LOGTIDE_PRIVACY_URL: PRIVACY_URL },
      { LOGTIDE_TERMS_URL: TERMS_URL, LOGTIDE_TERMS_VERSION: VERSION },
      { LOGTIDE_PRIVACY_URL: PRIVACY_URL, LOGTIDE_TERMS_VERSION: VERSION },
    ];
    for (const p of partials) {
      const r = parse(p);
      expect(r.success, JSON.stringify(p)).toBe(false);
      if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('must be set together');
    }
  });

  it('rejects non-https URLs except localhost http', () => {
    expect(parse({ ...all, LOGTIDE_TERMS_URL: 'not a url' }).success).toBe(false);
    expect(parse({ ...all, LOGTIDE_TERMS_URL: 'http://logtide.example.com/terms' }).success).toBe(false);
    expect(parse({ ...all, LOGTIDE_PRIVACY_URL: 'http://logtide.example.com/privacy' }).success).toBe(false);
    expect(parse({ ...all, LOGTIDE_PRIVACY_URL: 'ftp://logtide.example.com/privacy' }).success).toBe(false);
    expect(parse({ ...all, LOGTIDE_TERMS_URL: 'http://localhost:4321/terms' }).success).toBe(true);
    expect(parse({ ...all, LOGTIDE_PRIVACY_URL: 'http://127.0.0.1:4321/privacy' }).success).toBe(true);
  });

  it('rejects a version longer than 64 characters or made of spaces', () => {
    expect(parse({ ...all, LOGTIDE_TERMS_VERSION: 'v'.repeat(65) }).success).toBe(false);
    expect(parse({ ...all, LOGTIDE_TERMS_VERSION: 'v'.repeat(64) }).success).toBe(true);
    expect(parse({ ...all, LOGTIDE_TERMS_VERSION: '   ' }).success).toBe(false);
  });

  it('a partial env fails the boot', async () => {
    const before = process.env.LOGTIDE_TERMS_URL;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.resetModules();
      process.env.LOGTIDE_TERMS_URL = TERMS_URL;
      await expect(import('../../../config/index.js')).rejects.toThrow(/Invalid configuration/);
      const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('LOGTIDE_TERMS_URL');
      expect(printed).toContain('must be set together');
    } finally {
      if (before === undefined) delete process.env.LOGTIDE_TERMS_URL;
      else process.env.LOGTIDE_TERMS_URL = before;
      errorSpy.mockRestore();
      vi.resetModules();
    }
  });
});

describe('terms acceptance inactive (real app)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    deactivate();
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registration without acceptTerms works and leaves the columns NULL', async () => {
    await withSignup(async () => {
      const res = await register(app);
      expect(res.statusCode).toBe(201);
      const cols = await termsColumns(res.json().user.id);
      expect(cols.terms_accepted_at).toBeNull();
      expect(cols.terms_version).toBeNull();
    });
  });

  it('acceptTerms is ignored (any value) and the columns stay NULL', async () => {
    await withSignup(async () => {
      for (const acceptTerms of [true, false, 'yes']) {
        const res = await register(app, { acceptTerms });
        expect(res.statusCode, String(acceptTerms)).toBe(201);
        const cols = await termsColumns(res.json().user.id);
        expect(cols.terms_accepted_at).toBeNull();
        expect(cols.terms_version).toBeNull();
      }
    });
  });

  it('/auth/config and /me carry no terms keys, accept-terms does not exist', async () => {
    const conf = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect(conf).not.toHaveProperty('termsUrl');
    expect(conf).not.toHaveProperty('privacyUrl');
    expect(conf).not.toHaveProperty('termsVersion');

    const user = await createTestUser({ email: uniqueEmail('inactive') });
    const session = await createTestSession(user.id);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).not.toHaveProperty('termsAcceptanceRequired');

    const accept = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-terms',
      headers: { authorization: `Bearer ${session.token}` },
      payload: { version: VERSION },
    });
    expect(accept.statusCode).toBe(404);
  });

  it('a user with NULL terms can create organizations, projects and API keys', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    const headers = { authorization: `Bearer ${session.token}` };
    const org = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers,
      payload: { name: `Inactive Org ${Date.now()}` },
    });
    expect(org.statusCode).toBe(201);
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: { organizationId: ctx.organization.id, name: 'Inactive Project' },
    });
    expect(project.statusCode).toBe(201);
    const key = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${ctx.project.id}/api-keys`,
      headers,
      payload: { name: 'Inactive Key' },
    });
    expect(key.statusCode).toBe(201);
  });
});

describe('terms acceptance active (real app)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    activate();
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    deactivate();
  });

  beforeEach(() => {
    activate();
  });

  afterEach(() => {
    activate();
  });

  async function pendingUser() {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    return { ctx, headers: { authorization: `Bearer ${session.token}` } };
  }

  async function me(headers: Record<string, string>) {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    expect(res.statusCode).toBe(200);
    return res.json().user;
  }

  it('/auth/config exposes the terms keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ termsUrl: TERMS_URL, privacyUrl: PRIVACY_URL, termsVersion: VERSION });
  });

  it('registration without acceptTerms (or with false) is 400 terms_not_accepted', async () => {
    await withSignup(async () => {
      const email = uniqueEmail('noaccept');
      const missing = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: nextIp(),
        payload: { email, password: 'password123', name: 'No Accept' },
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({ error: 'terms_not_accepted' });

      const falsy = await register(app, { email, acceptTerms: false });
      expect(falsy.statusCode).toBe(400);
      expect(falsy.json()).toEqual({ error: 'terms_not_accepted' });

      const stringy = await register(app, { email, acceptTerms: 'true' });
      expect(stringy.statusCode).toBe(400);

      // No user row was created.
      const row = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
      expect(row).toBeUndefined();
    });
  });

  it('registration with acceptTerms: true is 201 and stores the version and time', async () => {
    await withSignup(async () => {
      const before = Date.now();
      const res = await register(app, { acceptTerms: true });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      const cols = await termsColumns(body.user.id);
      expect(cols.terms_version).toBe(VERSION);
      expect(cols.terms_accepted_at).not.toBeNull();
      expect(new Date(cols.terms_accepted_at as Date).getTime()).toBeGreaterThan(before - 60_000);

      // Freshly accepted: not pending, can create an organization.
      const headers = { authorization: `Bearer ${body.session.token}` };
      expect(await me(headers)).not.toHaveProperty('termsAcceptanceRequired');
      const org = await app.inject({
        method: 'POST',
        url: '/api/v1/organizations',
        headers,
        payload: { name: `Accepted Org ${Date.now()}` },
      });
      expect(org.statusCode).toBe(201);
    });
  });

  it('an existing user with NULL terms is pending and blocked from creating resources', async () => {
    const { ctx, headers } = await pendingUser();
    expect((await me(headers)).termsAcceptanceRequired).toBe(true);

    const org = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers,
      payload: { name: `Pending Org ${Date.now()}` },
    });
    expect(org.statusCode).toBe(403);
    expect(org.json()).toEqual({ error: 'terms_not_accepted' });

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: { organizationId: ctx.organization.id, name: 'Pending Project' },
    });
    expect(project.statusCode).toBe(403);
    expect(project.json()).toEqual({ error: 'terms_not_accepted' });

    const key = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${ctx.project.id}/api-keys`,
      headers,
      payload: { name: 'Pending Key' },
    });
    expect(key.statusCode).toBe(403);
    expect(key.json()).toEqual({ error: 'terms_not_accepted' });

    // Nothing was created.
    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', ctx.organization.id)
      .execute();
    expect(projects).toHaveLength(1);
  });

  it('ingestion with an existing API key is never blocked while pending', async () => {
    const { ctx, headers } = await pendingUser();
    expect((await me(headers)).termsAcceptanceRequired).toBe(true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      headers: { 'x-api-key': ctx.apiKey.plainKey, 'content-type': 'application/json' },
      payload: { logs: [{ time: new Date().toISOString(), service: 'api', level: 'info', message: 'still flowing' }] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
  });

  it('accept-terms requires a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-terms',
      payload: { version: VERSION },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accept-terms with a wrong or missing version is 409 and changes nothing', async () => {
    const { ctx, headers } = await pendingUser();
    for (const payload of [{ version: '2020-01-01' }, {}]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-terms', headers, payload });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'terms_version_mismatch' });
    }
    const cols = await termsColumns(ctx.user.id);
    expect(cols.terms_version).toBeNull();
    expect(cols.terms_accepted_at).toBeNull();
    expect((await me(headers)).termsAcceptanceRequired).toBe(true);
  });

  it('accept-terms with the current version clears the pending state', async () => {
    const { ctx, headers } = await pendingUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-terms',
      headers,
      payload: { version: VERSION },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, termsVersion: VERSION });

    const cols = await termsColumns(ctx.user.id);
    expect(cols.terms_version).toBe(VERSION);
    expect(cols.terms_accepted_at).not.toBeNull();
    expect(await me(headers)).not.toHaveProperty('termsAcceptanceRequired');

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: { organizationId: ctx.organization.id, name: 'After Accept' },
    });
    expect(project.statusCode).toBe(201);
  });

  it('a version bump makes accepted users pending again', async () => {
    const { headers } = await pendingUser();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-terms',
      headers,
      payload: { version: VERSION },
    });
    expect(ok.statusCode).toBe(200);
    expect(await me(headers)).not.toHaveProperty('termsAcceptanceRequired');

    activate('2026-12-01');
    expect((await me(headers)).termsAcceptanceRequired).toBe(true);
    const conf = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect(conf.termsVersion).toBe('2026-12-01');

    const org = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers,
      payload: { name: `Bumped Org ${Date.now()}` },
    });
    expect(org.statusCode).toBe(403);
    expect(org.json()).toEqual({ error: 'terms_not_accepted' });

    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-terms',
      headers,
      payload: { version: VERSION },
    });
    expect(stale.statusCode).toBe(409);

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-terms',
      headers,
      payload: { version: '2026-12-01' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(await me(headers)).not.toHaveProperty('termsAcceptanceRequired');
  });
});
