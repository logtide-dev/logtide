import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { db } from '../../../database/index.js';
import { contextPlugin } from '../../../context/index.js';
import { capabilities } from '../../../capabilities/index.js';
import { publicStatusRoutes, settleSubscribeWork } from '../../../modules/monitoring/routes.js';
import { createTestContext, createTestProject } from '../../helpers/factories.js';

vi.mock('../../../lib/mailer.js', () => ({
  getMailer: () => ({ sendMail: vi.fn().mockResolvedValue({}) }),
}));
vi.mock('../../../queue/jobs/monitor-notification.js', () => ({
  monitorNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../database/reservoir.js', () => ({ reservoir: {} }));

const CAP = 'status_page.subscribers.max';
let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let ipSeq = 0;

async function setLimit(orgId: string, limit: number) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: orgId, capability: CAP, enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(orgId);
}

async function publicProject(organizationId: string, userId: string) {
  const project = await createTestProject({ organizationId, userId });
  await db.updateTable('projects').set({ status_page_visibility: 'public' }).where('id', '=', project.id).execute();
  return project;
}

async function subscribe(orgSlug: string, projectSlug: string, email: string) {
  ipSeq += 1;
  const res = await app.inject({
    method: 'POST',
    url: `/status/${orgSlug}/${projectSlug}/subscribe`,
    payload: { email },
    remoteAddress: `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
  });
  await settleSubscribeWork();
  return res;
}

async function confirmToken(orgSlug: string, projectSlug: string, token: string) {
  ipSeq += 1;
  return app.inject({
    method: 'POST',
    url: `/status/${orgSlug}/${projectSlug}/subscribe/confirm`,
    payload: { token },
    remoteAddress: `10.2.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
  });
}

async function seedSubscriber(organizationId: string, projectId: string, email: string, confirmed: boolean) {
  await db
    .insertInto('status_page_subscribers')
    .values({
      organization_id: organizationId,
      project_id: projectId,
      email,
      email_normalized: email.toLowerCase(),
      confirmed_at: confirmed ? new Date() : null,
      confirm_token_hash: confirmed ? null : 'a'.repeat(64),
      confirm_expires_at: confirmed ? null : new Date(Date.now() + 3600_000),
    })
    .execute();
}

describe('status_page.subscribers.max enforcement', () => {
  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(publicStatusRoutes, { prefix: '/status' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    ctx = await createTestContext();
    await db.updateTable('projects').set({ status_page_visibility: 'public' }).where('id', '=', ctx.project.id).execute();
  });

  it('at the org-wide limit across projects, subscribe answers 202 without a limit message, row or mail', async () => {
    await setLimit(ctx.organization.id, 2);
    const second = await publicProject(ctx.organization.id, ctx.user.id);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'one@example.com', true);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'two@example.com', true);

    const res = await subscribe(ctx.organization.slug, second.slug, 'three@example.com');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(res.payload).not.toMatch(/limit|capability/i);
    const rows = await db.selectFrom('status_page_subscribers').select('id').where('organization_id', '=', ctx.organization.id).execute();
    expect(rows).toHaveLength(2);
  });

  it('unconfirmed addresses never fill the quota', async () => {
    await setLimit(ctx.organization.id, 2);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'one@example.com', true);
    for (let i = 0; i < 5; i++) {
      await seedSubscriber(ctx.organization.id, ctx.project.id, `fake${i}@example.com`, false);
    }
    const res = await subscribe(ctx.organization.slug, ctx.project.slug, 'real@example.com');
    expect(res.statusCode).toBe(202);
    const row = await db
      .selectFrom('status_page_subscribers')
      .select('id')
      .where('email_normalized', '=', 'real@example.com')
      .executeTakeFirst();
    expect(row).toBeDefined();
  });

  it('enforces the limit when the address is confirmed', async () => {
    await setLimit(ctx.organization.id, 1);
    const token = 'c'.repeat(43);
    await db
      .insertInto('status_page_subscribers')
      .values({
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        email: 'late@example.com',
        email_normalized: 'late@example.com',
        confirm_token_hash: createHash('sha256').update(token).digest('hex'),
        confirm_expires_at: new Date(Date.now() + 3600_000),
      })
      .execute();
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'one@example.com', true);

    const blocked = await confirmToken(ctx.organization.slug, ctx.project.slug, token);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.payload).not.toMatch(/limit|capability/i);

    await db.deleteFrom('status_page_subscribers').where('email_normalized', '=', 'one@example.com').execute();
    const ok = await confirmToken(ctx.organization.slug, ctx.project.slug, token);
    expect(ok.statusCode).toBe(200);
  });

  it('allows subscribe under the limit', async () => {
    await setLimit(ctx.organization.id, 2);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'one@example.com', true);
    const res = await subscribe(ctx.organization.slug, ctx.project.slug, 'two@example.com');
    expect(res.statusCode).toBe(202);
  });

  it('is unlimited when no entitlement exists', async () => {
    for (let i = 0; i < 3; i++) {
      await seedSubscriber(ctx.organization.id, ctx.project.id, `seed${i}@example.com`, true);
    }
    const res = await subscribe(ctx.organization.slug, ctx.project.slug, 'more@example.com');
    expect(res.statusCode).toBe(202);
  });

  it('a limit on one org does not affect another', async () => {
    await setLimit(ctx.organization.id, 1);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'one@example.com', true);
    const other = await createTestContext();
    await db.updateTable('projects').set({ status_page_visibility: 'public' }).where('id', '=', other.project.id).execute();
    capabilities.invalidate(other.organization.id);

    const res = await subscribe(other.organization.slug, other.project.slug, 'free@example.com');
    expect(res.statusCode).toBe(202);
  });

  it('expired pending rows do not count against the limit', async () => {
    await setLimit(ctx.organization.id, 1);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'stale@example.com', false);
    await db
      .updateTable('status_page_subscribers')
      .set({ confirm_expires_at: new Date(Date.now() - 3600_000) })
      .where('organization_id', '=', ctx.organization.id)
      .execute();
    const res = await subscribe(ctx.organization.slug, ctx.project.slug, 'fresh@example.com');
    expect(res.statusCode).toBe(202);
  });

  it('an already known address is not blocked at the limit', async () => {
    await setLimit(ctx.organization.id, 1);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'known@example.com', true);
    const res = await subscribe(ctx.organization.slug, ctx.project.slug, 'known@example.com');
    expect(res.statusCode).toBe(202);
  });
});
