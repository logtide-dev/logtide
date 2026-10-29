/**
 * GET /api/v1/projects/:id/capabilities must ask the storage engine
 * (reservoir), not Postgres, so ClickHouse and MongoDB projects work.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { projectsRoutes } from '../../../modules/projects/routes.js';
import { createTestContext } from '../../helpers/factories.js';

describe('Project capabilities on non-Timescale engines', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    projectId = ctx.project.id;
    authToken = crypto.randomBytes(32).toString('hex');
    await db
      .insertInto('sessions')
      .values({ user_id: ctx.user.id, token: authToken, expires_at: new Date(Date.now() + 86_400_000) })
      .execute();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function getCapabilities() {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/capabilities`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload);
  }

  it('hasSessions follows reservoir.hasSessions, not the Postgres logs table', async () => {
    const spy = vi.spyOn(reservoir, 'hasSessions').mockResolvedValue(true);
    vi.spyOn(reservoir, 'query').mockResolvedValue({ logs: [] } as any);

    const body = await getCapabilities();

    expect(body.hasSessions).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ projectId }));
  });

  it('hasSessions is false when the engine reports none', async () => {
    vi.spyOn(reservoir, 'hasSessions').mockResolvedValue(false);
    vi.spyOn(reservoir, 'query').mockResolvedValue({ logs: [] } as any);

    expect((await getCapabilities()).hasSessions).toBe(false);
  });

  it('hasWebVitals is true for a record with performance.metric metadata', async () => {
    vi.spyOn(reservoir, 'hasSessions').mockResolvedValue(false);
    const query = vi.spyOn(reservoir, 'query').mockResolvedValue({
      logs: [{ id: 'x', message: 'LCP', metadata: { performance: { metric: 'LCP', value: 1200 } } }],
    } as any);

    const body = await getCapabilities();

    expect(body.hasWebVitals).toBe(true);
    const params = query.mock.calls[0][0] as any;
    expect(params.metadataFilters).toEqual([
      expect.objectContaining({ key: 'performance.metric', op: 'exists' }),
    ]);
    expect(params.search).toBeUndefined();
  });

  it('hasWebVitals is false when no record carries the metadata', async () => {
    vi.spyOn(reservoir, 'hasSessions').mockResolvedValue(false);
    vi.spyOn(reservoir, 'query').mockResolvedValue({ logs: [] } as any);

    expect((await getCapabilities()).hasWebVitals).toBe(false);
  });
});
