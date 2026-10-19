/**
 * Receiver creation mints an ingest credential, so it carries the same gates
 * as API key creation: email verification and terms acceptance. Real app.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { reservoirReady } from '../../../database/reservoir.js';
import { config } from '../../../config/index.js';
import { createTestContext } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const cfg = config as unknown as {
  REQUIRE_EMAIL_VERIFICATION: boolean;
  LOGTIDE_TERMS_URL?: string;
  LOGTIDE_PRIVACY_URL?: string;
  LOGTIDE_TERMS_VERSION?: string;
};

function activateTerms() {
  cfg.LOGTIDE_TERMS_URL = 'https://logtide.example.com/terms';
  cfg.LOGTIDE_PRIVACY_URL = 'https://logtide.example.com/privacy';
  cfg.LOGTIDE_TERMS_VERSION = 'v1';
}
function reset() {
  delete cfg.LOGTIDE_TERMS_URL;
  delete cfg.LOGTIDE_PRIVACY_URL;
  delete cfg.LOGTIDE_TERMS_VERSION;
  cfg.REQUIRE_EMAIL_VERIFICATION = false;
}

describe('receiver creation gates (real app)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    reset();
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    reset();
  });

  async function create(headers: Record<string, string>, projectId: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/receivers`,
      headers,
      payload: { name: 'ci', adapterType: 'github' },
    });
  }

  async function setup() {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    return { ctx, headers: { authorization: `Bearer ${session.token}` } };
  }

  async function receiverCount(projectId: string) {
    const rows = await db.selectFrom('receivers').select('id').where('project_id', '=', projectId).execute();
    return rows.length;
  }

  it('works with every seam inactive (NULL terms, unverified email)', async () => {
    const { ctx, headers } = await setup();
    await db.updateTable('users').set({ email_verified_at: null }).where('id', '=', ctx.user.id).execute();
    const res = await create(headers, ctx.project.id);
    expect(res.statusCode).toBe(201);
  });

  it('403 email_not_verified for an unverified user when verification is required', async () => {
    const { ctx, headers } = await setup();
    await db.updateTable('users').set({ email_verified_at: null }).where('id', '=', ctx.user.id).execute();
    cfg.REQUIRE_EMAIL_VERIFICATION = true;
    const res = await create(headers, ctx.project.id);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'email_not_verified' });
    expect(await receiverCount(ctx.project.id)).toBe(0);

    await db.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', ctx.user.id).execute();
    expect((await create(headers, ctx.project.id)).statusCode).toBe(201);
  });

  it('403 terms_not_accepted while terms are pending, 201 after accepting', async () => {
    const { ctx, headers } = await setup();
    activateTerms();
    const res = await create(headers, ctx.project.id);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'terms_not_accepted' });
    expect(await receiverCount(ctx.project.id)).toBe(0);

    await db
      .updateTable('users')
      .set({ terms_version: 'v1', terms_accepted_at: new Date() })
      .where('id', '=', ctx.user.id)
      .execute();
    expect((await create(headers, ctx.project.id)).statusCode).toBe(201);
  });
});
