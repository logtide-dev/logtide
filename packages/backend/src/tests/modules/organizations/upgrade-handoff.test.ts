import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { config, configSchema } from '../../../config/index.js';
import { CapabilityError, QuotaExceededError } from '../../../capabilities/errors.js';
import {
  signUpgradeToken,
  verifyUpgradeToken,
  buildUpgradeUrl,
  isUpgradeHandoffActive,
} from '../../../modules/organizations/upgrade-handoff.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';

const SECRET = 'u'.repeat(40);
const PORTAL = 'https://billing.example.com/portal';
const cfg = config as { LOGTIDE_UPGRADE_URL?: string; LOGTIDE_UPGRADE_SIGNING_SECRET?: string };

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_KEY_SECRET: 'x'.repeat(32),
};

async function session(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 86_400_000) })
    .execute();
  return token;
}

function activate() {
  cfg.LOGTIDE_UPGRADE_URL = PORTAL;
  cfg.LOGTIDE_UPGRADE_SIGNING_SECRET = SECRET;
}
function deactivate() {
  delete cfg.LOGTIDE_UPGRADE_URL;
  delete cfg.LOGTIDE_UPGRADE_SIGNING_SECRET;
}

describe('upgrade handoff env validation', () => {
  const parse = (extra: Record<string, string>) => configSchema.safeParse({ ...base, ...extra });

  it('is inert when both are unset or empty', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ LOGTIDE_UPGRADE_URL: '', LOGTIDE_UPGRADE_SIGNING_SECRET: '' }).success).toBe(true);
  });

  it('rejects exactly one of the two', () => {
    const a = parse({ LOGTIDE_UPGRADE_URL: PORTAL });
    expect(a.success).toBe(false);
    if (!a.success) expect(JSON.stringify(a.error.issues)).toContain('must be set together');
    expect(parse({ LOGTIDE_UPGRADE_SIGNING_SECRET: SECRET }).success).toBe(false);
  });

  it('rejects an invalid or non-https URL, allows local http', () => {
    expect(parse({ LOGTIDE_UPGRADE_URL: 'not a url', LOGTIDE_UPGRADE_SIGNING_SECRET: SECRET }).success).toBe(false);
    expect(parse({ LOGTIDE_UPGRADE_URL: 'http://billing.example.com', LOGTIDE_UPGRADE_SIGNING_SECRET: SECRET }).success).toBe(false);
    expect(parse({ LOGTIDE_UPGRADE_URL: 'http://localhost:4000/x', LOGTIDE_UPGRADE_SIGNING_SECRET: SECRET }).success).toBe(true);
    expect(parse({ LOGTIDE_UPGRADE_URL: 'http://127.0.0.1:4000/x', LOGTIDE_UPGRADE_SIGNING_SECRET: SECRET }).success).toBe(true);
    expect(parse({ LOGTIDE_UPGRADE_URL: PORTAL, LOGTIDE_UPGRADE_SIGNING_SECRET: SECRET }).success).toBe(true);
  });

  it('rejects a secret shorter than 32 characters', () => {
    expect(parse({ LOGTIDE_UPGRADE_URL: PORTAL, LOGTIDE_UPGRADE_SIGNING_SECRET: 's'.repeat(31) }).success).toBe(false);
    expect(parse({ LOGTIDE_UPGRADE_URL: PORTAL, LOGTIDE_UPGRADE_SIGNING_SECRET: 's'.repeat(32) }).success).toBe(true);
  });
});

describe('upgrade token signer and reference verifier', () => {
  const input = { org: 'o1', user: 'u1', email: 'a@b.c', role: 'owner', intent: 'upgrade' as const };

  it('round-trips', () => {
    const token = signUpgradeToken(input, SECRET);
    const payload = verifyUpgradeToken(token, SECRET);
    expect(payload).toMatchObject({ v: 1, ...input });
    expect(payload!.nonce.length).toBeGreaterThanOrEqual(21);
    const now = Math.floor(Date.now() / 1000);
    expect(payload!.exp).toBeGreaterThan(now + 590);
    expect(payload!.exp).toBeLessThanOrEqual(now + 601);
  });

  it('uses a fresh nonce per token', () => {
    const a = verifyUpgradeToken(signUpgradeToken(input, SECRET), SECRET)!;
    const b = verifyUpgradeToken(signUpgradeToken(input, SECRET), SECRET)!;
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('rejects a tampered payload and writes evidence', () => {
    const token = signUpgradeToken(input, SECRET);
    const [enc, mac] = token.split('.');
    const forged = { ...JSON.parse(Buffer.from(enc, 'base64url').toString()), role: 'member', org: 'other' };
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`;
    const truncated = `${enc}.${mac.slice(0, -2)}AA`;
    expect(verifyUpgradeToken(tampered, SECRET)).toBeNull();
    expect(verifyUpgradeToken(token, 'w'.repeat(40))).toBeNull();
    expect(verifyUpgradeToken(truncated, SECRET)).toBeNull();
    expect(verifyUpgradeToken('garbage', SECRET)).toBeNull();
    expect(verifyUpgradeToken('', SECRET)).toBeNull();

    const dir = 'G:\\progetti\\logtide\\logtide\\.omo\\evidence';
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'w1-t3-tamper.txt'),
        [
          'valid token verifies: ' + (verifyUpgradeToken(token, SECRET) !== null),
          'tampered payload (role member, org other) verifies: ' + (verifyUpgradeToken(tampered, SECRET) !== null),
          'wrong secret verifies: ' + (verifyUpgradeToken(token, 'w'.repeat(40)) !== null),
          'altered mac verifies: ' + (verifyUpgradeToken(truncated, SECRET) !== null),
          'garbage verifies: ' + (verifyUpgradeToken('garbage', SECRET) !== null),
          '',
        ].join('\n')
      );
    } catch {
      /* evidence is best effort */
    }
  });

  it('rejects an expired token', () => {
    const t0 = Date.now() - 11 * 60 * 1000;
    const token = signUpgradeToken(input, SECRET, t0);
    expect(verifyUpgradeToken(token, SECRET)).toBeNull();
    expect(verifyUpgradeToken(token, SECRET, t0 + 9 * 60 * 1000)).not.toBeNull();
  });

  it('builds the url preserving an existing query string', () => {
    const url = new URL(buildUpgradeUrl('https://billing.example.com/p?plan=pro', 'TOK'));
    expect(url.searchParams.get('plan')).toBe('pro');
    expect(url.searchParams.get('t')).toBe('TOK');
  });
});

describe('upgrade handoff integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    app.get('/__cap', async () => {
      throw new CapabilityError('FEATURE_DISABLED', 'nope', 'alerts.max_rules');
    });
    app.get('/__quota', async () => {
      throw new QuotaExceededError('QUOTA_EXCEEDED', 'over', 'ingestion.max_events_monthly');
    });
    await app.ready();
  });

  afterAll(async () => {
    deactivate();
    await app.close();
  });

  afterEach(() => deactivate());

  async function fixture() {
    const owner = await createTestUser();
    const org = await createTestOrganization({ ownerId: owner.id });
    const member = await createTestUser();
    const admin = await createTestUser();
    await db
      .insertInto('organization_members')
      .values([
        { organization_id: org.id, user_id: member.id, role: 'member' },
        { organization_id: org.id, user_id: admin.id, role: 'admin' },
      ])
      .execute();
    return { owner, member, admin, org };
  }

  const post = (orgId: string, token: string | null, body: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${orgId}/upgrade-handoff`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body as any,
    });

  it('is not active by default', () => {
    expect(isUpgradeHandoffActive()).toBe(false);
  });

  it('404 when not configured, even for the owner', async () => {
    const f = await fixture();
    const res = await post(f.org.id, await session(f.owner.id), { intent: 'upgrade' });
    expect(res.statusCode).toBe(404);
  });

  it('is inactive when only one var is set', () => {
    cfg.LOGTIDE_UPGRADE_URL = PORTAL;
    expect(isUpgradeHandoffActive()).toBe(false);
  });

  it('owner and admin get a signed url, member gets 403', async () => {
    activate();
    const f = await fixture();

    const ownerRes = await post(f.org.id, await session(f.owner.id), { intent: 'upgrade' });
    expect(ownerRes.statusCode).toBe(200);
    const url = new URL(ownerRes.json().url);
    expect(url.origin + url.pathname).toBe(PORTAL);
    const payload = verifyUpgradeToken(url.searchParams.get('t')!, SECRET)!;
    expect(payload).toMatchObject({ org: f.org.id, user: f.owner.id, email: f.owner.email, role: 'owner', intent: 'upgrade' });

    const adminRes = await post(f.org.id, await session(f.admin.id), { intent: 'manage' });
    expect(adminRes.statusCode).toBe(200);
    const adminPayload = verifyUpgradeToken(new URL(adminRes.json().url).searchParams.get('t')!, SECRET)!;
    expect(adminPayload).toMatchObject({ role: 'admin', intent: 'manage' });

    const memberRes = await post(f.org.id, await session(f.member.id), { intent: 'upgrade' });
    expect(memberRes.statusCode).toBe(403);
  });

  it('never leaks the session token into the handoff url', async () => {
    activate();
    const f = await fixture();
    const sess = await session(f.owner.id);
    const res = await post(f.org.id, sess, { intent: 'upgrade' });
    expect(res.body).not.toContain(sess);
    const enc = new URL(res.json().url).searchParams.get('t')!.split('.')[0];
    expect(Buffer.from(enc, 'base64url').toString()).not.toContain(sess);
  });

  it('403 for a non-member, 401 unauthenticated, 400 bad intent', async () => {
    activate();
    const f = await fixture();
    const outsider = await createTestUser();
    expect((await post(f.org.id, await session(outsider.id), { intent: 'upgrade' })).statusCode).toBe(403);
    expect((await post(f.org.id, null, { intent: 'upgrade' })).statusCode).toBe(401);
    expect((await post(f.org.id, await session(f.owner.id), { intent: 'nope' })).statusCode).toBe(400);
  });

  it('auth config exposes upgradeEnabled only when active', async () => {
    const off = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect('upgradeEnabled' in off).toBe(false);
    activate();
    const on = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect(on.upgradeEnabled).toBe(true);
  });

  it('capability and quota errors carry upgrade_available only when active', async () => {
    const u = await createTestUser();
    const headers = { authorization: `Bearer ${await session(u.id)}` };
    for (const url of ['/__cap', '/__quota']) {
      const off = await app.inject({ method: 'GET', url, headers });
      expect([403, 429]).toContain(off.statusCode);
      expect('upgrade_available' in off.json()).toBe(false);
    }
    activate();
    const cap = await app.inject({ method: 'GET', url: '/__cap', headers });
    expect(cap.statusCode).toBe(403);
    expect(cap.json().upgrade_available).toBe(true);
    const quota = await app.inject({ method: 'GET', url: '/__quota', headers });
    expect(quota.statusCode).toBe(429);
    expect(quota.json().upgrade_available).toBe(true);
  });
});
