import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../database/index.js';
import { reservoirReady } from '../../database/reservoir.js';
import { build } from '../../server.js';
import { capabilities, quotaFlagCache } from '../../capabilities/index.js';
import { QuotaEvaluator } from '../../capabilities/quota-evaluator.js';
import { createTestSession } from '../helpers/auth.js';
import { createTestApiKey, createTestContext, createTestUser } from '../helpers/factories.js';

// 10 GiB: well above 2^31 - 1, the old INTEGER ceiling of limit_value.
const TEN_GIB = 10 * 1024 * 1024 * 1024;

describe('entitlement limits above 2 GiB (bigint limit_value)', () => {
  let app: FastifyInstance;
  let adminHeaders: Record<string, string>;

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
    const admin = await createTestUser({ email: `admin-${Date.now()}-${Math.random()}@example.com` });
    await db.updateTable('users').set({ is_admin: true }).where('id', '=', admin.id).execute();
    const session = await createTestSession(admin.id);
    adminHeaders = { authorization: `Bearer ${session.token}` };
  });

  async function putLimit(orgId: string, limitValue: number) {
    return app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: adminHeaders,
      payload: { entitlements: [{ capability: 'ingestion.max_bytes_monthly', limitValue }] },
    });
  }

  it('PUT accepts a 10 GiB limit and GET returns it as a number', async () => {
    const ctx = await createTestContext();
    const orgId = ctx.organization.id;

    const put = await putLimit(orgId, TEN_GIB);
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: adminHeaders,
    });
    expect(get.statusCode).toBe(200);
    const value = get.json().entitlements['ingestion.max_bytes_monthly'];
    expect(value).toEqual({ kind: 'quota', limit: TEN_GIB });
    expect(typeof value.limit).toBe('number');

    capabilities.invalidate(orgId);
    const limit = await capabilities.getLimit(orgId, 'ingestion.max_bytes_monthly');
    expect(limit).toBe(TEN_GIB);
    expect(typeof limit).toBe('number');
  });

  it('enforces a 10 GiB limit: under passes, over is 429 through the real app', async () => {
    const ctx = await createTestContext();
    const orgId = ctx.organization.id;
    const key = await createTestApiKey({ projectId: ctx.project.id });
    expect((await putLimit(orgId, TEN_GIB)).statusCode).toBe(200);

    const ingest = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/ingest',
        headers: { 'x-api-key': key.plainKey, 'content-type': 'application/json' },
        payload: { logs: [{ time: new Date().toISOString(), service: 'api', level: 'info', message: 'x' }] },
      });

    const stub = (bytes: number) => ({
      async aggregate(params: { type?: string }) {
        return params.type === 'logs.ingested.bytes' ? [{ type: params.type, project_id: null, quantity: bytes }] : [];
      },
      async latestPointInTime() {
        return 0;
      },
    });

    // 9 GiB used of 10 GiB: under quota (an int4 or string limit would misbehave here).
    await new QuotaEvaluator(stub(9 * 1024 * 1024 * 1024) as any).runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, 'ingestion.max_bytes_monthly')).toBe(false);
    expect((await ingest()).statusCode).toBe(200);

    // 10 GiB + 1 used: blocked.
    await new QuotaEvaluator(stub(TEN_GIB + 1) as any).runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, 'ingestion.max_bytes_monthly')).toBe(true);
    expect((await ingest()).statusCode).toBe(429);
  });
});
