import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { contextPlugin } from '../../../context/index.js';
import { publicStatusRoutes, settleSubscribeWork } from '../../../modules/monitoring/routes.js';
import { rateLimitKeyGenerator } from '../../../server.js';
import { statusPageRoutes } from '../../../modules/monitoring/status-page-routes.js';
import {
  makeUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../../../modules/monitoring/subscribers.js';
import { createTestContext, createTestSession, createTestUser } from '../../helpers/index.js';

const sendMail = vi.fn().mockResolvedValue({});

vi.mock('../../../lib/mailer.js', () => ({
  getMailer: () => ({ sendMail }),
}));
vi.mock('../../../queue/jobs/monitor-notification.js', () => ({
  monitorNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../database/reservoir.js', () => ({ reservoir: {} }));

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let ipSeq = 0;

const base = () => `/status/${ctx.organization.slug}/${ctx.project.slug}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makePublic() {
  await db.updateTable('projects').set({ status_page_visibility: 'public' }).where('id', '=', ctx.project.id).execute();
}

/** Every call uses a fresh source address so the per-IP limit only bites when asked to. */
async function post(path: string, payload: unknown, ip?: string, headers?: Record<string, string>) {
  ipSeq += 1;
  const res = await app.inject({
    method: 'POST',
    url: `${base()}${path}`,
    payload: payload as any,
    headers,
    remoteAddress: ip ?? `10.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}.7`,
  });
  // subscribe does its work after the response; let it finish before asserting
  await settleSubscribeWork();
  return res;
}

function lastToken(): string {
  const call = sendMail.mock.calls[sendMail.mock.calls.length - 1][0];
  const match = /confirm\?token=([^\s"&]+)/.exec(call.text);
  if (!match) throw new Error('no token in mail');
  return decodeURIComponent(match[1]);
}

async function rowFor(email: string) {
  return db
    .selectFrom('status_page_subscribers')
    .selectAll()
    .where('project_id', '=', ctx.project.id)
    .where('email_normalized', '=', email.toLowerCase())
    .executeTakeFirst();
}

beforeAll(async () => {
  app = Fastify();
  await app.register(contextPlugin);
  // Same global key generator as the real server, so the credential-header
  // bypass is exercised.
  await app.register(rateLimit, { global: false, keyGenerator: rateLimitKeyGenerator });
  await app.register(publicStatusRoutes, { prefix: '/status' });
  await app.register(statusPageRoutes, { prefix: '/api/v1/status-page' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  sendMail.mockClear();
  ctx = await createTestContext();
  await makePublic();
});

describe('subscribe', () => {
  it('creates a pending row and sends one confirmation email', async () => {
    const res = await post('/subscribe', { email: 'alice@example.com' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    const row = await rowFor('alice@example.com');
    expect(row?.confirmed_at).toBeNull();
    expect(row?.confirm_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('alice@example.com');
    expect(mail.text).toContain(`/status/${ctx.organization.slug}/${ctx.project.slug}/confirm?token=`);
    // the plain token is never stored
    expect(mail.text).not.toContain(row!.confirm_token_hash!);
  });

  it('lowercases and trims the email for matching', async () => {
    await post('/subscribe', { email: '  Bob@Example.COM ' });
    const row = await rowFor('bob@example.com');
    expect(row?.email_normalized).toBe('bob@example.com');
    expect(sendMail.mock.calls[0][0].to).toBe('Bob@Example.COM');
    // same address in another case is the same subscriber
    await post('/subscribe', { email: 'BOB@example.com' });
    const rows = await db.selectFrom('status_page_subscribers').select('id').where('project_id', '=', ctx.project.id).execute();
    expect(rows).toHaveLength(1);
  });

  it('returns the same 202 body for unknown, pending and confirmed emails and mails no confirmed one', async () => {
    const unknown = await post('/subscribe', { email: 'carol@example.com' });
    const pending = await post('/subscribe', { email: 'carol@example.com' });
    expect(pending.statusCode).toBe(unknown.statusCode);
    expect(pending.payload).toBe(unknown.payload);

    const confirm = await post('/subscribe/confirm', { token: lastToken() });
    expect(confirm.statusCode).toBe(200);
    sendMail.mockClear();

    const confirmed = await post('/subscribe', { email: 'carol@example.com' });
    expect(confirmed.statusCode).toBe(unknown.statusCode);
    expect(confirmed.payload).toBe(unknown.payload);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends no second confirmation within 60 seconds, resends after with a new token', async () => {
    await post('/subscribe', { email: 'dave@example.com' });
    const firstToken = lastToken();
    await post('/subscribe', { email: 'dave@example.com' });
    expect(sendMail).toHaveBeenCalledTimes(1);

    await db
      .updateTable('status_page_subscribers')
      .set({ last_confirmation_sent_at: new Date(Date.now() - 61_000) })
      .where('project_id', '=', ctx.project.id)
      .execute();
    await post('/subscribe', { email: 'dave@example.com' });
    expect(sendMail).toHaveBeenCalledTimes(2);
    const secondToken = lastToken();
    expect(secondToken).not.toBe(firstToken);

    // the first link no longer works, the second does
    expect((await post('/subscribe/confirm', { token: firstToken })).statusCode).toBe(400);
    expect((await post('/subscribe/confirm', { token: secondToken })).statusCode).toBe(200);
  });

  it('answers 400 for an invalid email', async () => {
    for (const email of ['nope', '', 'a@b', 'x'.repeat(260) + '@example.com']) {
      expect((await post('/subscribe', { email })).statusCode).toBe(400);
    }
    expect((await post('/subscribe', {})).statusCode).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns 404 when SMTP is not configured', async () => {
    const original = config.SMTP_HOST;
    (config as any).SMTP_HOST = undefined;
    try {
      expect((await post('/subscribe', { email: 'erin@example.com' })).statusCode).toBe(404);
    } finally {
      (config as any).SMTP_HOST = original;
    }
  });

  it('returns 404 when visibility is not public', async () => {
    await db.updateTable('projects').set({ status_page_visibility: 'password' }).where('id', '=', ctx.project.id).execute();
    expect((await post('/subscribe', { email: 'frank@example.com' })).statusCode).toBe(404);
    await db.updateTable('projects').set({ status_page_visibility: 'disabled' }).where('id', '=', ctx.project.id).execute();
    expect((await post('/subscribe', { email: 'frank@example.com' })).statusCode).toBe(404);
  });

  it('answers 429 on the 6th subscribe in a minute from one IP', async () => {
    const ip = '203.0.113.50';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await post('/subscribe', { email: `flood${i}@example.com` }, ip)).statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(codes[5]).toBe(429);
    // another address is not affected
    expect((await post('/subscribe', { email: 'other@example.com' }, '203.0.113.51')).statusCode).toBe(202);
  });
});

describe('subscribe abuse bounds', () => {
  it('keys the limit on the client address, not on a caller supplied credential header', async () => {
    const ip = '203.0.113.77';
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      codes.push(
        (await post('/subscribe', { email: `hdr${i}@example.com` }, ip, { 'x-api-key': `random-${i}` })).statusCode
      );
    }
    expect(codes.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it('applies the same address key to confirm and unsubscribe', async () => {
    const ip = '203.0.113.78';
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) {
      codes.push((await post('/unsubscribe', { token: 'x' }, ip, { authorization: `Bearer junk-${i}` })).statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });

  it('answers before the confirmation mail is sent, so latency does not reveal the address', async () => {
    sendMail.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({}), 600)));
    const started = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: `${base()}/subscribe`,
      payload: { email: 'slow@example.com' },
      remoteAddress: '203.0.113.90',
    });
    expect(res.statusCode).toBe(202);
    expect(Date.now() - started).toBeLessThan(450);
    await settleSubscribeWork();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('mails an address at most 3 times per 24 hours, then again after the window', async () => {
    const age = (set: Record<string, Date>) =>
      db.updateTable('status_page_subscribers').set(set).where('project_id', '=', ctx.project.id).execute();

    for (let i = 0; i < 5; i++) {
      await post('/subscribe', { email: 'victim@example.com' });
      await age({ last_confirmation_sent_at: new Date(Date.now() - 61_000) });
    }
    expect(sendMail).toHaveBeenCalledTimes(3);

    await age({ confirmation_window_started_at: new Date(Date.now() - 25 * 3600_000) });
    await post('/subscribe', { email: 'victim@example.com' });
    expect(sendMail).toHaveBeenCalledTimes(4);
    const row = await rowFor('victim@example.com');
    expect(row?.confirmation_send_count).toBe(1);
  });

  it('stops creating pending rows and mails once a page holds 200 unconfirmed addresses', async () => {
    const values = Array.from({ length: 200 }, (_, i) => ({
      organization_id: ctx.organization.id,
      project_id: ctx.project.id,
      email: `p${i}@example.com`,
      email_normalized: `p${i}@example.com`,
      confirm_token_hash: 'a'.repeat(64),
      confirm_expires_at: new Date(Date.now() + 3600_000),
    }));
    await db.insertInto('status_page_subscribers').values(values).execute();

    const res = await post('/subscribe', { email: 'extra@example.com' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(await rowFor('extra@example.com')).toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('confirm', () => {
  it('consumes the token and a second use is rejected', async () => {
    await post('/subscribe', { email: 'gina@example.com' });
    const token = lastToken();
    expect((await post('/subscribe/confirm', { token })).statusCode).toBe(200);
    const row = await rowFor('gina@example.com');
    expect(row?.confirmed_at).not.toBeNull();
    expect(row?.confirm_token_hash).toBeNull();
    const again = await post('/subscribe/confirm', { token });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe('Invalid or expired link');
  });

  it('rejects an expired (49 h) and a wrong token', async () => {
    await post('/subscribe', { email: 'hank@example.com' });
    const token = lastToken();
    expect((await post('/subscribe/confirm', { token: token.slice(0, -2) + 'xx' })).statusCode).toBe(400);
    expect((await post('/subscribe/confirm', { token: 'short' })).statusCode).toBe(400);

    await db
      .updateTable('status_page_subscribers')
      .set({ confirm_expires_at: new Date(Date.now() - 60 * 60 * 1000) })
      .where('project_id', '=', ctx.project.id)
      .execute();
    expect((await post('/subscribe/confirm', { token })).statusCode).toBe(400);
    const row = await rowFor('hank@example.com');
    expect(row?.confirmed_at).toBeNull();
  });

  it('a token of another project does not confirm here', async () => {
    await post('/subscribe', { email: 'ivy@example.com' });
    const token = lastToken();
    const other = await createTestContext();
    await db.updateTable('projects').set({ status_page_visibility: 'public' }).where('id', '=', other.project.id).execute();
    const res = await app.inject({
      method: 'POST',
      url: `/status/${other.organization.slug}/${other.project.slug}/subscribe/confirm`,
      payload: { token },
      remoteAddress: '198.51.100.9',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('unsubscribe', () => {
  it('deletes the row with a valid token', async () => {
    await post('/subscribe', { email: 'jack@example.com' });
    await post('/subscribe/confirm', { token: lastToken() });
    const row = await rowFor('jack@example.com');
    const res = await post('/unsubscribe', { token: makeUnsubscribeToken(row!.id) });
    expect(res.statusCode).toBe(200);
    expect(await rowFor('jack@example.com')).toBeUndefined();
  });

  it('rejects a tampered signature and a token for another id', async () => {
    await post('/subscribe', { email: 'kate@example.com' });
    const row = await rowFor('kate@example.com');
    const good = makeUnsubscribeToken(row!.id);
    const tampered = good.slice(0, -2) + (good.endsWith('AA') ? 'BB' : 'AA');
    expect((await post('/unsubscribe', { token: tampered })).statusCode).toBe(400);

    const otherId = '00000000-0000-4000-8000-000000000001';
    const swapped = `${otherId}.${good.split('.')[1]}`;
    expect((await post('/unsubscribe', { token: swapped })).statusCode).toBe(400);
    expect((await post('/unsubscribe', { token: row!.id })).statusCode).toBe(400);
    expect((await post('/unsubscribe', { token: '' })).statusCode).toBe(400);
    expect(await rowFor('kate@example.com')).toBeDefined();
  });

  it('a valid token cannot remove a subscriber of another project', async () => {
    await post('/subscribe', { email: 'liam@example.com' });
    const row = await rowFor('liam@example.com');
    const other = await createTestContext();
    const res = await app.inject({
      method: 'POST',
      url: `/status/${other.organization.slug}/${other.project.slug}/unsubscribe`,
      payload: { token: makeUnsubscribeToken(row!.id) },
      remoteAddress: '198.51.100.10',
    });
    expect(res.statusCode).toBe(200); // idempotent, nothing removed
    expect(await rowFor('liam@example.com')).toBeDefined();
  });

  it('verifyUnsubscribeToken is strict about shape', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(verifyUnsubscribeToken(makeUnsubscribeToken(id))).toBe(id);
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('nodot')).toBeNull();
    expect(verifyUnsubscribeToken(`${id}.`)).toBeNull();
    expect(verifyUnsubscribeToken('x'.repeat(500))).toBeNull();
  });
});

describe('admin list and removal', () => {
  it('lists confirmed subscribers only; remove deletes by id and org', async () => {
    const ownerToken = (await createTestSession(ctx.user.id)).token;
    await post('/subscribe', { email: 'mia@example.com' });
    await post('/subscribe/confirm', { token: lastToken() });
    await post('/subscribe', { email: 'noah@example.com' }); // stays pending

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/status-page/subscribers?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: auth(ownerToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().subscribers.map((s: any) => s.email)).toEqual(['mia@example.com']);

    const id = list.json().subscribers[0].id;
    const other = await createTestContext();
    const otherToken = (await createTestSession(other.user.id)).token;
    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/v1/status-page/subscribers/${id}?organizationId=${other.organization.id}`,
      headers: auth(otherToken),
    });
    expect(foreign.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/status-page/subscribers/${id}?organizationId=${ctx.organization.id}`,
      headers: auth(ownerToken),
    });
    expect(removed.statusCode).toBe(204);
    expect(await rowFor('mia@example.com')).toBeUndefined();
  });

  it('audits status page config, components and subscriber removal without the address', async () => {
    const ownerToken = (await createTestSession(ctx.user.id)).token;
    const put = (url: string, payload: unknown) =>
      app.inject({ method: 'PUT', url: `/api/v1/status-page${url}`, headers: auth(ownerToken), payload: payload as any });

    expect((await put('/config', { organizationId: ctx.organization.id, projectId: ctx.project.id, title: 'T' })).statusCode).toBe(200);
    expect((await put('/components', { organizationId: ctx.organization.id, projectId: ctx.project.id, components: [] })).statusCode).toBe(200);

    await post('/subscribe', { email: 'audit-me@example.com' });
    await post('/subscribe/confirm', { token: lastToken() });
    const row = await rowFor('audit-me@example.com');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/status-page/subscribers/${row!.id}?organizationId=${ctx.organization.id}`,
      headers: auth(ownerToken),
    });
    expect(del.statusCode).toBe(204);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('organization_id', '=', ctx.organization.id)
      .where('action', 'like', 'statuspage.%')
      .execute();
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
    expect(Object.keys(byAction).sort()).toEqual([
      'statuspage.components_updated',
      'statuspage.config_updated',
      'statuspage.subscriber_removed',
    ]);
    expect(byAction['statuspage.config_updated'].resource_id).toBe(ctx.project.id);
    expect(byAction['statuspage.subscriber_removed'].resource_id).toBe(row!.id);
    expect(JSON.stringify(rows)).not.toContain('audit-me@example.com');
  });

  it('plain members cannot list or remove subscribers', async () => {
    const member = await createTestUser();
    await db
      .insertInto('organization_members')
      .values({ user_id: member.id, organization_id: ctx.organization.id, role: 'member' })
      .execute();
    const token = (await createTestSession(member.id)).token;
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/status-page/subscribers?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: auth(token),
    });
    expect(list.statusCode).toBe(403);
  });
});

describe('expired pending rows', () => {
  it('are dropped on the next subscribe and do not count against the quota', async () => {
    await post('/subscribe', { email: 'old@example.com' });
    await db
      .updateTable('status_page_subscribers')
      .set({ confirm_expires_at: new Date(Date.now() - 3600_000) })
      .where('project_id', '=', ctx.project.id)
      .execute();
    await post('/subscribe', { email: 'new@example.com' });
    expect(await rowFor('old@example.com')).toBeUndefined();
    expect(await rowFor('new@example.com')).toBeDefined();
  });
});
