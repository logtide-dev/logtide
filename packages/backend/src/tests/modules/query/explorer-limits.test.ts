import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { createTestContext } from '../../helpers/index.js';
import { queryService } from '../../../modules/query/service.js';
import { isEngineTimeout, EXPLORER_MAX_RANGE_MS } from '../../../modules/query/explorer-routes.js';
import { readAnalyticsTimeoutMs } from '../../../database/reservoir.js';

describe('log explorer limits', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    apiKey = ctx.apiKey.plainKey;
    projectId = ctx.project.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const get = (path: string, params: Record<string, string> = {}) =>
    request(app.server)
      .get(`${path}?${new URLSearchParams({ projectId, ...params }).toString()}`)
      .set('x-api-key', apiKey);

  const day = 24 * 60 * 60 * 1000;
  const wide = () => ({
    from: new Date(Date.now() - EXPLORER_MAX_RANGE_MS - day).toISOString(),
    to: new Date().toISOString(),
  });
  const ok = () => ({
    from: new Date(Date.now() - 30 * day).toISOString(),
    to: new Date().toISOString(),
  });

  for (const path of ['/api/v1/logs/count', '/api/v1/logs/histogram', '/api/v1/logs/facets']) {
    it(`${path} rejects a range wider than 31 days and accepts 30 days`, async () => {
      const tooWide = await get(path, wide());
      expect(tooWide.status).toBe(400);
      expect(tooWide.body.error).toContain('31 days');
      const open = await get(path, { from: wide().from });
      expect(open.status).toBe(400);
      const fine = await get(path, ok());
      expect(fine.status).toBe(200);
    });
  }

  it.each([
    ['mongo', { code: 50, codeName: 'MaxTimeMSExpired' }],
    ['clickhouse', Object.assign(new Error('Timeout'), { code: '159', type: 'TIMEOUT_EXCEEDED' })],
    ['postgres', Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })],
  ])('maps a %s timeout to 503 with a clear message', async (_engine, error) => {
    vi.spyOn(queryService, 'countLogs').mockRejectedValue(error);
    vi.spyOn(queryService, 'getHistogram').mockRejectedValue(error);
    vi.spyOn(queryService, 'getFacets').mockRejectedValue(error);
    for (const path of ['/api/v1/logs/count', '/api/v1/logs/histogram', '/api/v1/logs/facets']) {
      const res = await get(path);
      expect(res.status).toBe(503);
      expect(res.body.error).toContain('took too long');
    }
  });

  it('leaves other errors as 500s', async () => {
    vi.spyOn(queryService, 'countLogs').mockRejectedValue(new Error('boom'));
    expect((await get('/api/v1/logs/count')).status).toBe(500);
  });

  it('isEngineTimeout also finds a wrapped cause', () => {
    expect(isEngineTimeout({ cause: { code: '57014' } })).toBe(true);
    expect(isEngineTimeout({ code: '23505' })).toBe(false);
    expect(isEngineTimeout(null)).toBe(false);
  });

  it('reads ANALYTICS_TIMEOUT_MS only when it is a non-negative number', () => {
    expect(readAnalyticsTimeoutMs({})).toBeUndefined();
    expect(readAnalyticsTimeoutMs({ ANALYTICS_TIMEOUT_MS: '45000' })).toBe(45000);
    expect(readAnalyticsTimeoutMs({ ANALYTICS_TIMEOUT_MS: '0' })).toBe(0);
    expect(readAnalyticsTimeoutMs({ ANALYTICS_TIMEOUT_MS: 'abc' })).toBeUndefined();
    expect(readAnalyticsTimeoutMs({ ANALYTICS_TIMEOUT_MS: '-5' })).toBeUndefined();
  });
});
