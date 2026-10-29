/**
 * Self-hosted invariance: with every hosting-seam env var unset, the REAL app
 * (the same builder server.ts uses, full plugin stack) behaves exactly like a
 * build without the seams. Any failure here means a seam leaked into OSS.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../database/index.js';
import { reservoirReady } from '../../database/reservoir.js';
import { config } from '../../config/index.js';
import { build } from '../../server.js';
import { CAPABILITIES, CAPABILITY_NAMES } from '../../capabilities/registry.js';
import { capabilities, quotaFlagCache } from '../../capabilities/index.js';
import { QuotaEvaluator } from '../../capabilities/quota-evaluator.js';
import { settingsService } from '../../modules/settings/index.js';
import { SETTING_KEYS } from '../../modules/settings/service.js';
import { createTestSession } from '../helpers/auth.js';
import { createTestApiKey, createTestContext } from '../helpers/factories.js';

const SEAM_ENV = [
  'CAPABILITY_DEFAULTS_JSON',
  'LOGTIDE_ADMIN_SERVICE_TOKEN',
  'LOGTIDE_UPGRADE_URL',
  'LOGTIDE_UPGRADE_SIGNING_SECRET',
  'MAX_ORGANIZATIONS_PER_USER',
  'MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH',
  'REQUIRE_EMAIL_VERIFICATION',
  'REGISTRATION_RATE_LIMIT_PER_HOUR',
  'LOGTIDE_TERMS_URL',
  'LOGTIDE_PRIVACY_URL',
  'LOGTIDE_TERMS_VERSION',
] as const;

const cfg = config as unknown as Record<string, unknown>;

describe('hosting seams with all env unset', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    quotaFlagCache.clear();
  });

  it('precondition: no seam env var is set', () => {
    for (const name of SEAM_ENV) {
      expect(process.env[name] ?? '', name).toBe('');
    }
    expect(cfg.CAPABILITY_DEFAULTS_JSON ?? undefined).toBeUndefined();
    expect(cfg.LOGTIDE_ADMIN_SERVICE_TOKEN).toBeUndefined();
    expect(cfg.LOGTIDE_UPGRADE_URL).toBeUndefined();
    expect(cfg.LOGTIDE_UPGRADE_SIGNING_SECRET).toBeUndefined();
    expect(cfg.MAX_ORGANIZATIONS_PER_USER).toBeUndefined();
    expect(cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH).toBeUndefined();
    expect(cfg.REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(cfg.REGISTRATION_RATE_LIMIT_PER_HOUR).toBeUndefined();
    expect(cfg.LOGTIDE_TERMS_URL).toBeUndefined();
    expect(cfg.LOGTIDE_PRIVACY_URL).toBeUndefined();
    expect(cfg.LOGTIDE_TERMS_VERSION).toBeUndefined();
  });

  it('registry defaults are unlimited / enabled', async () => {
    for (const name of CAPABILITY_NAMES) {
      const def = CAPABILITIES[name];
      if (def.kind === 'boolean') expect(def.defaultEnabled, name).toBe(true);
      else expect(def.defaultLimit, name).toBeNull();
    }
    const ctx = await createTestContext();
    const list = await capabilities.list(ctx.organization.id);
    for (const name of CAPABILITY_NAMES) {
      const v = list[name];
      if (v.kind === 'boolean') expect(v.enabled, name).toBe(true);
      else expect(v.limit, name).toBeNull();
    }
  });

  it('evaluator queries only orgs with non-null quota rows', async () => {
    const restricted = await createTestContext();
    const nullRow = await createTestContext();
    const noRows = await createTestContext();
    await db
      .insertInto('organization_entitlements')
      .values([
        { organization_id: restricted.organization.id, capability: 'ingestion.max_events_monthly', enabled: null, limit_value: 100 },
        { organization_id: nullRow.organization.id, capability: 'ingestion.max_events_monthly', enabled: null, limit_value: null },
      ])
      .execute();
    capabilities.invalidate(restricted.organization.id);
    capabilities.invalidate(nullRow.organization.id);

    const queried = new Set<string>();
    const stub = {
      async aggregate(params: { organizationId: string }) {
        queried.add(params.organizationId);
        return [];
      },
      async latestPointInTime(organizationId: string) {
        queried.add(organizationId);
        return 0;
      },
    };
    await new QuotaEvaluator(stub as any).runOnce();

    // Deferred Task 1 item: orgs WITH a non-null quota row are still evaluated.
    expect(queried.has(restricted.organization.id)).toBe(true);
    expect(queried.has(nullRow.organization.id)).toBe(false);
    expect(queried.has(noRows.organization.id)).toBe(false);
  });

  it('refuses any bearer on the service-token admin routes (401)', async () => {
    const ctx = await createTestContext();
    const token = crypto.randomBytes(32).toString('hex');
    const headers = { authorization: `Bearer ${token}` };
    const id = ctx.organization.id;
    const calls = [
      app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${id}/entitlements`, headers }),
      app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${id}/entitlements`,
        headers,
        payload: { entitlements: [{ capability: 'projects.max', limitValue: 1 }] },
      }),
      app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${id}/retention`, headers }),
      app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${id}/retention`,
        headers,
        payload: { retentionDays: 30 },
      }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(401);
    }
  });

  it('upgrade-handoff route does not exist (404)', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${ctx.organization.id}/upgrade-handoff`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { intent: 'upgrade' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('the removed in-app billing route is 404', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${ctx.organization.id}/billing/checkout`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('/auth/config has no seam keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty('upgradeEnabled');
    expect(body).not.toHaveProperty('emailVerificationRequired');
    expect(body).not.toHaveProperty('termsUrl');
    expect(body).not.toHaveProperty('privacyUrl');
    expect(body).not.toHaveProperty('termsVersion');
    expect(body).not.toHaveProperty('billingEnabled');
    expect(body).not.toHaveProperty('extensions');
  });

  it('terms acceptance is inert: no /me key, no accept-terms route', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    const headers = { authorization: `Bearer ${session.token}` };
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).not.toHaveProperty('termsAcceptanceRequired');
    const accept = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-terms',
      headers,
      payload: { version: 'anything' },
    });
    expect(accept.statusCode).toBe(404);
  });

  it('registration, auto-login, project and API key creation work without verification', async () => {
    const signupWasEnabled = await settingsService.isSignupEnabled();
    if (!signupWasEnabled) await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, true);
    try {
      const email = `seams-${crypto.randomBytes(4).toString('hex')}@example.com`;
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'password123', name: 'Seams' },
      });
      expect(reg.statusCode).toBe(201);
      const regBody = reg.json();
      expect(regBody.user).not.toHaveProperty('emailVerified');
      expect(regBody.session?.token).toBeTruthy();
      const auth = { authorization: `Bearer ${regBody.session.token}` };

      const user = await db
        .selectFrom('users')
        .select('email_verified_at')
        .where('id', '=', regBody.user.id)
        .executeTakeFirstOrThrow();
      expect(user.email_verified_at).not.toBeNull();

      // No verification email was ever issued.
      const tokens = await db
        .selectFrom('email_verification_tokens')
        .select('id')
        .where('user_id', '=', regBody.user.id)
        .execute();
      expect(tokens).toHaveLength(0);

      // No terms acceptance was recorded or required.
      const terms = await db
        .selectFrom('users')
        .select(['terms_accepted_at', 'terms_version'])
        .where('id', '=', regBody.user.id)
        .executeTakeFirstOrThrow();
      expect(terms.terms_accepted_at).toBeNull();
      expect(terms.terms_version).toBeNull();

      const org = await app.inject({
        method: 'POST',
        url: '/api/v1/organizations',
        headers: auth,
        payload: { name: `Seams Org ${Date.now()}` },
      });
      expect(org.statusCode).toBe(201);
      const orgId = org.json().organization.id;

      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: auth,
        payload: { organizationId: orgId, name: 'Seams Project' },
      });
      expect(project.statusCode).toBe(201);
      const projectId = project.json().project.id;

      const key = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/api-keys`,
        headers: auth,
        payload: { name: 'Seams Key' },
      });
      expect(key.statusCode).toBe(201);
    } finally {
      if (!signupWasEnabled) await settingsService.set(SETTING_KEYS.AUTH_SIGNUP_ENABLED, false);
    }
  });

  it('403 limit and 429 quota bodies carry no upgrade_available', async () => {
    const ctx = await createTestContext();
    const orgId = ctx.organization.id;
    const session = await createTestSession(ctx.user.id);

    // 403: projects.max reached (createTestContext made 1 project).
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'projects.max', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${session.token}` },
      payload: { organizationId: orgId, name: 'Over' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).not.toHaveProperty('upgrade_available');

    // 429: flagged over an ingestion quota.
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'ingestion.max_events_monthly', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);
    quotaFlagCache.setOrgFlags(orgId, { 'ingestion.max_events_monthly': true });
    const key = await createTestApiKey({ projectId: ctx.project.id });
    const over = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      headers: { 'x-api-key': key.plainKey, 'content-type': 'application/json' },
      payload: { logs: [{ time: new Date().toISOString(), service: 'api', level: 'info', message: 'x' }] },
    });
    expect(over.statusCode).toBe(429);
    expect(over.json()).not.toHaveProperty('upgrade_available');
  });
});

describe('boot with an invalid CAPABILITY_DEFAULTS_JSON', () => {
  it('fails loading the config (deferred Task 1 item)', async () => {
    const before = process.env.CAPABILITY_DEFAULTS_JSON;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const bad of ['{not json', '[]', '{"no.such.capability": 1}', '{"projects.max": "ten"}']) {
        vi.resetModules();
        process.env.CAPABILITY_DEFAULTS_JSON = bad;
        await expect(import('../../config/index.js'), bad).rejects.toThrow(/CAPABILITY_DEFAULTS_JSON/);
      }
    } finally {
      if (before === undefined) delete process.env.CAPABILITY_DEFAULTS_JSON;
      else process.env.CAPABILITY_DEFAULTS_JSON = before;
      errorSpy.mockRestore();
      vi.resetModules();
    }
  });
});
