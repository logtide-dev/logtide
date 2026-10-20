import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { forwardToBilling } from '../../../modules/billing/proxy.js';
import { setBillingTimeoutForTests } from '../../../modules/billing/routes.js';
import { createTestSession } from '../../helpers/auth.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';

const TOKEN = 'b'.repeat(40);
const cfg = config as { LOGTIDE_BILLING_API_URL?: string; LOGTIDE_BILLING_API_TOKEN?: string };

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const okHandler: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
};

let seen: Seen[] = [];
let handler: Handler = okHandler;
let server: http.Server;
let fakeUrl: string;
let app: FastifyInstance;

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

async function call(userId: string, method: 'GET' | 'POST', orgId: string, tail: string, payload?: unknown) {
  const s = await createTestSession(userId);
  return app.inject({
    method,
    url: `/api/v1/organizations/${orgId}/billing${tail}`,
    headers: { authorization: `Bearer ${s.token}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

describe('billing proxy', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() });
        handler(req, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    fakeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // trailing slash on purpose: the proxy must tolerate it
    cfg.LOGTIDE_BILLING_API_URL = `${fakeUrl}/`;
    cfg.LOGTIDE_BILLING_API_TOKEN = TOKEN;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    delete cfg.LOGTIDE_BILLING_API_URL;
    delete cfg.LOGTIDE_BILLING_API_TOKEN;
    setBillingTimeoutForTests(undefined);
    await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    seen = [];
    setBillingTimeoutForTests(undefined);
    handler = okHandler;
  });

  it('owner GET billing is forwarded', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"checkoutEnabled":true}');
    };
    const res = await call(f.owner.id, 'GET', f.org.id, '');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ checkoutEnabled: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('GET');
    expect(seen[0].url).toBe(`/api/v1/orgs/${f.org.id}/billing`);
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].headers['x-logtide-user-id']).toBe(f.owner.id);
    expect(seen[0].headers['x-logtide-user-email']).toBe(f.owner.email);
    expect(seen[0].headers['x-logtide-user-role']).toBe('owner');
  });

  it('admin can POST checkout with a valid body', async () => {
    const f = await fixture();
    const res = await call(f.admin.id, 'POST', f.org.id, '/checkout', { plan: 'pro', interval: 'year' });
    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`/api/v1/orgs/${f.org.id}/billing/checkout`);
    expect(seen[0].headers['x-logtide-user-role']).toBe('admin');
    expect(JSON.parse(seen[0].body)).toEqual({ plan: 'pro', interval: 'year' });
  });

  it('invalid body is 400 and not forwarded', async () => {
    const f = await fixture();
    const payloads = [{ plan: 'free', interval: 'month' }, { plan: 'pro', interval: 'month', extra: 1 }, {}];
    for (const payload of payloads) {
      for (const tail of ['/checkout', '/preview', '/change']) {
        const res = await call(f.owner.id, 'POST', f.org.id, tail, payload);
        expect(res.statusCode, tail).toBe(400);
      }
    }
    expect(seen).toHaveLength(0);
  });

  it('member gets 403 and nothing is forwarded', async () => {
    const f = await fixture();
    const res = await call(f.member.id, 'GET', f.org.id, '');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('billing_forbidden');
    const post = await call(f.member.id, 'POST', f.org.id, '/cancel');
    expect(post.statusCode).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('non-member gets 404', async () => {
    const f = await fixture();
    const stranger = await createTestUser();
    const res = await call(stranger.id, 'GET', f.org.id, '');
    expect(res.statusCode).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('owner of org A cannot reach org B billing', async () => {
    const a = await fixture();
    const b = await fixture();
    const res = await call(a.owner.id, 'GET', b.org.id, '/invoices');
    expect(res.statusCode).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('unauthenticated gets 401', async () => {
    const f = await fixture();
    const res = await app.inject({ method: 'GET', url: `/api/v1/organizations/${f.org.id}/billing` });
    expect(res.statusCode).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('billing 409 passes through', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end('{"error":"subscription_exists","message":"already subscribed"}');
    };
    const res = await call(f.owner.id, 'POST', f.org.id, '/checkout', { plan: 'pro', interval: 'month' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'subscription_exists', message: 'already subscribed' });
  });

  it('upstream 401 maps to 502 and does not log the user out', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"unauthorized","message":"bad token"}');
    };
    const res = await call(f.owner.id, 'GET', f.org.id, '');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'billing_unavailable', message: 'Billing is temporarily unavailable' });
  });

  it('upstream 403 maps to 502', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{"error":"forbidden","message":"nope"}');
    };
    const res = await call(f.owner.id, 'POST', f.org.id, '/cancel');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('billing_unavailable');
  });

  it('billing 500 maps to 502 billing_unavailable', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"boom","message":"internal detail leaked"}');
    };
    const res = await call(f.owner.id, 'GET', f.org.id, '');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('billing_unavailable');
    expect(res.body).not.toContain('leaked');
  });

  it('503 checkout_disabled passes through', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"checkout_disabled","message":"Paid plans are opening soon."}');
    };
    const res = await call(f.owner.id, 'POST', f.org.id, '/checkout', { plan: 'pro', interval: 'month' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'checkout_disabled', message: 'Paid plans are opening soon.' });
  });

  it('503 billing_not_configured passes through', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"billing_not_configured","message":"Card updates are not available right now."}');
    };
    const res = await call(f.owner.id, 'POST', f.org.id, '/payment-method');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: 'billing_not_configured',
      message: 'Card updates are not available right now.',
    });
  });

  it('503 with another code maps to 502', async () => {
    const f = await fixture();
    const bodies = [
      '{"error":"maintenance","message":"internal detail leaked"}',
      'Service Unavailable',
      '',
      '{"error":["checkout_disabled"]}',
    ];
    for (const body of bodies) {
      handler = (_r, res) => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(body);
      };
      const res = await call(f.owner.id, 'GET', f.org.id, '');
      expect(res.statusCode, body).toBe(502);
      expect(res.json()).toEqual({ error: 'billing_unavailable', message: 'Billing is temporarily unavailable' });
    }
  });

  it('500 with a contract code still maps to 502', async () => {
    const f = await fixture();
    handler = (_r, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"checkout_disabled","message":"x"}');
    };
    const res = await call(f.owner.id, 'POST', f.org.id, '/checkout', { plan: 'pro', interval: 'month' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('billing_unavailable');
  });

  it('timeout maps to 502', async () => {
    const f = await fixture();
    setBillingTimeoutForTests(150);
    handler = () => {
      /* never answers */
    };
    const res = await call(f.owner.id, 'GET', f.org.id, '');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('billing_unavailable');
  });

  it('connection refused maps to 502', async () => {
    const dead = http.createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const port = (dead.address() as AddressInfo).port;
    await new Promise((r) => dead.close(r));
    cfg.LOGTIDE_BILLING_API_URL = `http://127.0.0.1:${port}`;
    try {
      const f = await fixture();
      const res = await call(f.owner.id, 'GET', f.org.id, '');
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('billing_unavailable');
    } finally {
      cfg.LOGTIDE_BILLING_API_URL = `${fakeUrl}/`;
    }
  });

  it('bad session id is 400, valid one is forwarded', async () => {
    const f = await fixture();
    const bad = await call(f.owner.id, 'GET', f.org.id, '/checkout/..%2Fx');
    expect(bad.statusCode).toBe(400);
    const bad2 = await call(f.owner.id, 'GET', f.org.id, '/checkout/notasession');
    expect(bad2.statusCode).toBe(400);
    expect(seen).toHaveLength(0);
    const ok = await call(f.owner.id, 'GET', f.org.id, '/checkout/cs_test_123');
    expect(ok.statusCode).toBe(200);
    expect(seen[0].url).toBe(`/api/v1/orgs/${f.org.id}/billing/checkout/cs_test_123`);
  });

  it.each([
    ['GET', '', undefined],
    ['GET', '/invoices', undefined],
    ['POST', '/checkout', { plan: 'pro', interval: 'month' }],
    ['GET', '/checkout/cs_abc', undefined],
    ['POST', '/preview', { plan: 'pro_plus', interval: 'year' }],
    ['POST', '/change', { plan: 'pro_plus', interval: 'month' }],
    ['POST', '/cancel', undefined],
    ['POST', '/resume', undefined],
    ['POST', '/payment-method', undefined],
  ] as const)('forwards %s %s', async (method, tail, payload) => {
    const f = await fixture();
    const res = await call(f.owner.id, method, f.org.id, tail, payload);
    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe(method);
    expect(seen[0].url).toBe(`/api/v1/orgs/${f.org.id}/billing${tail}`);
  });
});

describe('forwardToBilling', () => {
  const caller = { id: 'u1', email: 'a@b.c', role: 'owner' as const };

  beforeAll(() => {
    cfg.LOGTIDE_BILLING_API_URL = 'http://127.0.0.1:1/';
    cfg.LOGTIDE_BILLING_API_TOKEN = TOKEN;
  });
  afterAll(() => {
    delete cfg.LOGTIDE_BILLING_API_URL;
    delete cfg.LOGTIDE_BILLING_API_TOKEN;
  });

  it('maps a network error to 502', async () => {
    const r = await forwardToBilling({ method: 'GET', orgId: 'o', tail: '', caller, timeoutMs: 500 });
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: 'billing_unavailable', message: 'Billing is temporarily unavailable' });
  });
});
