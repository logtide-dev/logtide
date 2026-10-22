import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { contextPlugin } from '../../../context/index.js';
import { capabilities } from '../../../capabilities/index.js';
import { publicStatusRoutes } from '../../../modules/monitoring/routes.js';
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

function subscribe(orgSlug: string, projectSlug: string, email: string) {
  ipSeq += 1;
  return app.inject({
    method: 'POST',
    url: `/status/${orgSlug}/${projectSlug}/subscribe`,
    payload: { email },
    remoteAddress: `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
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

  it('blocks subscribe at the org-wide limit across projects', async () => {
    await setLimit(ctx.organization.id, 2);
    const second = await publicProject(ctx.organization.id, ctx.user.id);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'one@example.com', true);
    await seedSubscriber(ctx.organization.id, ctx.project.id, 'two@example.com', false); // pending counts

    const res = await subscribe(ctx.organization.slug, second.slug, 'three@example.com');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('capability.status_page.subscribers.max.limit_reached');
    const rows = await db.selectFrom('status_page_subscribers').select('id').where('organization_id', '=', ctx.organization.id).execute();
    expect(rows).toHaveLength(2);
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
