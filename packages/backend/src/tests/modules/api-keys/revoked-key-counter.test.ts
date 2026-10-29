import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { reservoirReady } from '../../../database/reservoir.js';
import { meteringRecorder } from '../../../modules/metering/index.js';
import { apiKeysService } from '../../../modules/api-keys/service.js';
import { createTestApiKey, createTestContext } from '../../helpers/factories.js';

describe('ingest with a revoked API key', () => {
  let app: FastifyInstance;
  let orgId: string;
  let projectId: string;
  let revokedKey: string;
  let revokedKeyId: string;

  beforeAll(async () => {
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('metering_events').execute();
    apiKeysService.resetRevokedKeyThrottle();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    const key = await createTestApiKey({ projectId });
    revokedKey = key.plainKey;
    revokedKeyId = key.id;
    await db.updateTable('api_keys').set({ revoked: true }).where('id', '=', key.id).execute();
  });

  const ingest = (apiKey: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: JSON.stringify({
        logs: [{ time: new Date().toISOString(), service: 'api', level: 'info', message: 'x' }],
      }),
    });

  const revokedRows = async () => {
    await meteringRecorder.flush();
    return db
      .selectFrom('metering_events')
      .selectAll()
      .where('type', '=', 'ingestion.revoked_key')
      .execute();
  };

  it('returns the same 401 as an unknown key and records one revoked_key row', async () => {
    const res = await ingest(revokedKey);
    expect(res.statusCode).toBe(401);
    // Same body as an unknown key: revocation is never disclosed.
    const unknown = await ingest('lp_test_doesnotexist0000000000000000');
    expect(res.body).toBe(unknown.body);

    const rows = await revokedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(orgId);
    expect(rows[0].project_id).toBe(projectId);
    expect(Number(rows[0].quantity)).toBe(1);
    expect(rows[0].metadata).toMatchObject({ apiKeyId: revokedKeyId });
  });

  it('throttles to one row per key per minute', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await ingest(revokedKey);
      expect(res.statusCode).toBe(401);
    }
    expect(await revokedRows()).toHaveLength(1);
  });

  it('records nothing for an unknown key', async () => {
    const res = await ingest('lp_test_doesnotexist0000000000000000');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Unauthorized');
    expect(await revokedRows()).toHaveLength(0);
  });

  it('findRevokedKeyOwner ignores keys of deleted projects and active keys', async () => {
    expect(await apiKeysService.findRevokedKeyOwner(revokedKey)).toEqual({
      organizationId: orgId,
      projectId,
      apiKeyId: revokedKeyId,
    });

    const active = await createTestApiKey({ projectId });
    expect(await apiKeysService.findRevokedKeyOwner(active.plainKey)).toBeNull();

    await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', projectId).execute();
    expect(await apiKeysService.findRevokedKeyOwner(revokedKey)).toBeNull();
  });
});
