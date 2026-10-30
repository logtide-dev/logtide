import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { config, configSchema } from '../../../config/index.js';
import { build } from '../../../server.js';
import { createTestOrganization } from '../../helpers/factories.js';

const TOKEN = 's'.repeat(40);
const cfg = config as { LOGTIDE_ADMIN_SERVICE_TOKEN?: string };

describe('LOGTIDE_ADMIN_SERVICE_TOKEN config', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    API_KEY_SECRET: 'x'.repeat(32),
  };

  it('is inert when unset or empty', () => {
    expect(configSchema.parse(base).LOGTIDE_ADMIN_SERVICE_TOKEN).toBeUndefined();
    expect(configSchema.parse({ ...base, LOGTIDE_ADMIN_SERVICE_TOKEN: '' }).LOGTIDE_ADMIN_SERVICE_TOKEN).toBeUndefined();
  });

  it('rejects a 31 character token', () => {
    const res = configSchema.safeParse({ ...base, LOGTIDE_ADMIN_SERVICE_TOKEN: 'a'.repeat(31) });
    expect(res.success).toBe(false);
  });

  it('accepts a 32 character token', () => {
    expect(configSchema.parse({ ...base, LOGTIDE_ADMIN_SERVICE_TOKEN: 'a'.repeat(32) }).LOGTIDE_ADMIN_SERVICE_TOKEN).toBe('a'.repeat(32));
  });
});

describe('admin service token', () => {
  let app: FastifyInstance;
  let orgId: string;

  beforeAll(async () => {
    // The REAL app (full plugin stack incl. the global auth plugin), not a
    // bare Fastify instance: the global plugin is what used to reject the token.
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    delete cfg.LOGTIDE_ADMIN_SERVICE_TOKEN;
    await app.close();
  });

  afterEach(() => {
    delete cfg.LOGTIDE_ADMIN_SERVICE_TOKEN;
  });

  async function newOrg() {
    const org = await createTestOrganization();
    orgId = org.id;
    return org.id;
  }

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  it('PUT entitlements returns 200 and writes a service audit row', async () => {
    cfg.LOGTIDE_ADMIN_SERVICE_TOKEN = TOKEN;
    const id = await newOrg();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${id}/entitlements`,
      headers: auth(TOKEN),
      payload: { entitlements: [{ capability: 'ingestion.max_bytes_monthly', limitValue: 1048576 }] },
    });
    expect(res.statusCode).toBe(200);
    const row = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'org.entitlements_updated')
      .where('organization_id', '=', id)
      .executeTakeFirst();
    expect(row).toBeTruthy();
    expect((row!.metadata as any).actor).toBe('service:admin-service');
    expect(row!.actor_type).toBe('system');
  });

  it('DELETE entitlement override accepts the token', async () => {
    cfg.LOGTIDE_ADMIN_SERVICE_TOKEN = TOKEN;
    const id = await newOrg();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${id}/entitlements`,
      headers: auth(TOKEN),
      payload: { entitlements: [{ capability: 'ingestion.max_bytes_monthly', limitValue: 1048576 }] },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${id}/entitlements/ingestion.max_bytes_monthly`,
      headers: auth(TOKEN),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ removed: true });
  });

  it('PUT retention returns 200 and writes a service audit row', async () => {
    cfg.LOGTIDE_ADMIN_SERVICE_TOKEN = TOKEN;
    const id = await newOrg();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${id}/retention`,
      headers: auth(TOKEN),
      payload: { retentionDays: 30 },
    });
    expect(res.statusCode).toBe(200);
    const row = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'org.retention_updated')
      .where('organization_id', '=', id)
      .executeTakeFirst();
    expect((row!.metadata as any).actor).toBe('service:admin-service');
    expect(row!.actor_type).toBe('system');
  });

  it('GET retention accepts the token', async () => {
    cfg.LOGTIDE_ADMIN_SERVICE_TOKEN = TOKEN;
    const id = await newOrg();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${id}/retention`,
      headers: auth(TOKEN),
    });
    expect(res.statusCode).toBe(200);
  });

  it('non-admin routes with the token are 401', async () => {
    cfg.LOGTIDE_ADMIN_SERVICE_TOKEN = TOKEN;
    const id = await newOrg();
    // session-auth route (route-level authenticate)
    const projects = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: auth(TOKEN) });
    expect(projects.statusCode).toBe(401);
    // routes guarded only by the global auth plugin
    const usage = await app.inject({ method: 'GET', url: `/api/v1/usage?organizationId=${id}`, headers: auth(TOKEN) });
    expect(usage.statusCode).toBe(401);
    const logs = await app.inject({ method: 'GET', url: '/api/v1/logs', headers: auth(TOKEN) });
    expect(logs.statusCode).toBe(401);
  });

  it('admin route not opted in to the service token fails cleanly (401, no 500)', async () => {
    cfg.LOGTIDE_ADMIN_SERVICE_TOKEN = TOKEN;
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: auth(TOKEN) });
    expect(res.statusCode).toBe(401);
  });

  it('wrong token is 401', async () => {
    cfg.LOGTIDE_ADMIN_SERVICE_TOKEN = TOKEN;
    const id = await newOrg();
    for (const t of ['w'.repeat(40), 'short', TOKEN + 'x']) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${id}/retention`,
        headers: auth(t),
        payload: { retentionDays: 30 },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('env unset: any token is 401', async () => {
    const id = await newOrg();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${id}/retention`,
      headers: auth(TOKEN),
      payload: { retentionDays: 30 },
    });
    expect(res.statusCode).toBe(401);
  });
});
