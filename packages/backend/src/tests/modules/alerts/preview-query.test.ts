import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';
import { alertsRoutes } from '../../../modules/alerts/routes.js';
import { alertsService } from '../../../modules/alerts/service.js';
import type { PreviewAlertRuleInput } from '../../../modules/alerts/service.js';
import { AlertRuleInputError } from '../../../modules/alerts/validation.js';

const BUCKET_MS = 5 * 60 * 1000;

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

/**
 * A time inside one 5-minute preview bucket (1d range) about half an hour
 * ago, so a handful of logs written a second apart never straddle two
 * buckets and the bucket counts are exact.
 */
function insideOneBucket(offsetSeconds: number): Date {
  const start = Math.floor((Date.now() - 30 * 60 * 1000) / BUCKET_MS) * BUCKET_MS;
  return new Date(start + 60_000 + offsetSeconds * 1000);
}

async function seed(projectId: string, count: number, overrides: { message: string; service?: string; metadata?: Record<string, unknown>; level?: 'error' | 'warn' | 'info' }, firstOffset = 0) {
  for (let i = 0; i < count; i++) {
    await createTestLog({
      projectId,
      level: overrides.level ?? 'error',
      service: overrides.service ?? 'api',
      message: `${overrides.message} ${i}`,
      metadata: overrides.metadata,
      time: insideOneBucket(firstOffset + i),
    });
  }
}

describe('Alert preview with query and metadata filters', () => {
  let organizationId: string;
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    await db.deleteFrom('logs').execute();
    await db.deleteFrom('alert_history').execute();
    await db.deleteFrom('alert_rules').execute();
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
    userId = ctx.user.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const input = (overrides: Partial<PreviewAlertRuleInput> = {}): PreviewAlertRuleInput => ({
    organizationId,
    projectId,
    level: ['error'],
    threshold: 5,
    timeWindow: 5,
    previewRange: '1d',
    ...overrides,
  });

  describe('service', () => {
    it('counts only logs matching the query', async () => {
      await seed(projectId, 10, { message: 'upstream timeout' });
      await seed(projectId, 10, { message: 'request ok' }, 20);

      const result = await alertsService.previewAlertRule(input({ query: 'timeout' }));

      expect(result.summary.totalIncidents).toBeGreaterThanOrEqual(1);
      // 10 matching logs in the bucket, not the 20 error logs of the bucket
      expect(result.incidents[0].peakValue).toBe(10);
      expect(result.incidents[0].sampleLogs.length).toBeGreaterThan(0);
      for (const log of result.incidents[0].sampleLogs) {
        expect(log.message).toContain('timeout');
      }
      expect(result.statistics.thresholdAnalysis.p99Value).toBe(10);
    });

    it('an exclusion in the query removes matching logs', async () => {
      await seed(projectId, 10, { message: 'upstream timeout' });
      await seed(projectId, 6, { message: 'request ok' }, 20);

      const result = await alertsService.previewAlertRule(input({ query: '-timeout' }));

      expect(result.incidents[0].peakValue).toBe(6);
      for (const log of result.incidents[0].sampleLogs) {
        expect(log.message).not.toContain('timeout');
      }
    });

    it('returns no_data when nothing matches the query', async () => {
      await seed(projectId, 10, { message: 'upstream timeout' });

      const result = await alertsService.previewAlertRule(input({ query: 'nomatch' }));

      expect(result.summary.totalIncidents).toBe(0);
      expect(result.incidents).toHaveLength(0);
      expect(result.suggestions[0].type).toBe('no_data');
    });

    it('a query contradicting the rule levels matches nothing', async () => {
      await seed(projectId, 10, { message: 'upstream timeout' });

      const result = await alertsService.previewAlertRule(input({ query: 'level:info' }));

      expect(result.summary.totalIncidents).toBe(0);
      expect(result.suggestions[0].type).toBe('no_data');
    });

    it('honours metadataFilters', async () => {
      await seed(projectId, 7, { message: 'db error', metadata: { env: 'prod' } });
      await seed(projectId, 9, { message: 'db error', metadata: { env: 'dev' } }, 20);

      const prod = await alertsService.previewAlertRule(
        input({ metadataFilters: [{ key: 'env', op: 'equals', value: 'prod' }] })
      );
      expect(prod.incidents[0].peakValue).toBe(7);

      const notProd = await alertsService.previewAlertRule(
        input({ metadataFilters: [{ key: 'env', op: 'not_equals', value: 'prod' }] })
      );
      expect(notProd.incidents[0].peakValue).toBe(9);

      const viaQuery = await alertsService.previewAlertRule(input({ query: 'env:prod' }));
      expect(viaQuery.incidents[0].peakValue).toBe(7);
    });

    it('reports affected services of the matching logs only, without unknown', async () => {
      await seed(projectId, 6, { message: 'upstream timeout', service: 'gateway' });
      await seed(projectId, 6, { message: 'request ok', service: 'billing' }, 20);
      await seed(projectId, 6, { message: 'worker timeout', service: 'unknown' }, 40);

      const result = await alertsService.previewAlertRule(input({ query: 'timeout' }));

      expect(result.summary.affectedServices).toEqual(['gateway']);
    });

    it('keeps the rule service filter with its legacy unknown fallback', async () => {
      await seed(projectId, 5, { message: 'upstream timeout', service: 'gateway' });
      await seed(projectId, 5, { message: 'upstream timeout', service: 'unknown' }, 20);
      await seed(projectId, 5, { message: 'upstream timeout', service: 'billing' }, 40);

      const result = await alertsService.previewAlertRule(input({ service: 'gateway', query: 'timeout' }));

      expect(result.incidents[0].peakValue).toBe(10);
    });

    it('keeps the aggregate path without query or filters', async () => {
      await seed(projectId, 10, { message: 'upstream timeout' });
      const aggregate = vi.spyOn(reservoir, 'aggregate');
      const distinct = vi.spyOn(reservoir, 'distinct');
      const histogram = vi.spyOn(reservoir, 'histogram');
      const facets = vi.spyOn(reservoir, 'facets');

      const result = await alertsService.previewAlertRule(input());
      // a blank query and an empty filter list are "no query"
      await alertsService.previewAlertRule(input({ query: '   ', metadataFilters: [] }));

      expect(result.incidents[0].peakValue).toBe(10);
      expect(aggregate).toHaveBeenCalledTimes(2);
      expect(distinct).toHaveBeenCalledTimes(2);
      expect(histogram).not.toHaveBeenCalled();
      expect(facets).not.toHaveBeenCalled();
    });

    it('uses histogram and facets with a query', async () => {
      await seed(projectId, 10, { message: 'upstream timeout' });
      const aggregate = vi.spyOn(reservoir, 'aggregate');
      const distinct = vi.spyOn(reservoir, 'distinct');
      const histogram = vi.spyOn(reservoir, 'histogram');
      const facets = vi.spyOn(reservoir, 'facets');

      await alertsService.previewAlertRule(input({ query: 'timeout' }));

      expect(aggregate).not.toHaveBeenCalled();
      expect(distinct).not.toHaveBeenCalled();
      expect(histogram).toHaveBeenCalledTimes(1);
      expect(histogram.mock.calls[0][0]).toMatchObject({
        projectId: [projectId],
        level: ['error'],
        bucketSeconds: 300,
        textQuery: expect.anything(),
      });
      expect(facets).toHaveBeenCalledTimes(1);
      expect(facets.mock.calls[0][0]).toMatchObject({ fields: [{ builtin: 'service' }], limit: 50, projectId: [projectId] });
    });

    it.each([
      ['7d', 900],
      ['14d', 3600],
      ['30d', 3600],
    ] as const)('uses %s buckets of %i seconds', async (previewRange, bucketSeconds) => {
      await seed(projectId, 3, { message: 'upstream timeout' });
      const histogram = vi.spyOn(reservoir, 'histogram');

      await alertsService.previewAlertRule(input({ query: 'timeout', previewRange }));

      expect(histogram.mock.calls[0][0].bucketSeconds).toBe(bucketSeconds);
    });

    it('rejects an invalid query with its position', async () => {
      const error = await alertsService.previewAlertRule(input({ query: 'timeout (' })).catch((e) => e);
      expect(error).toBeInstanceOf(AlertRuleInputError);
      expect(typeof error.position).toBe('number');
    });

    it('rejects an invalid query even for an organization without logs', async () => {
      await db.deleteFrom('api_keys').execute();
      await db.deleteFrom('projects').where('organization_id', '=', organizationId).execute();

      await expect(
        alertsService.previewAlertRule(input({ projectId: null, query: '(' }))
      ).rejects.toBeInstanceOf(AlertRuleInputError);
    });

    it('previews an org-wide rule over every project of the organization only', async () => {
      const other = await createTestContext();
      await seed(projectId, 4, { message: 'upstream timeout' });
      await seed(other.project.id, 20, { message: 'upstream timeout' }, 20);

      const result = await alertsService.previewAlertRule(input({ projectId: null, threshold: 1, query: 'timeout' }));

      expect(result.incidents[0].peakValue).toBe(4);
    });
  });

  describe('POST /api/v1/alerts/preview', () => {
    let app: FastifyInstance;
    let token: string;

    beforeAll(async () => {
      app = Fastify();
      await app.register(alertsRoutes, { prefix: '/api/v1/alerts' });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(async () => {
      token = await createTestSession(userId);
    });

    const postPreview = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/alerts/preview',
        headers: { Authorization: `Bearer ${token}` },
        payload,
      });

    it('route returns 400 with position for an invalid query', async () => {
      const res = await postPreview({ ...input(), query: 'timeout (' });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(typeof body.error).toBe('string');
      expect(typeof body.position).toBe('number');
    });

    it('route filters with query and metadataFilters', async () => {
      await seed(projectId, 7, { message: 'upstream timeout', metadata: { env: 'prod' } });
      await seed(projectId, 7, { message: 'upstream timeout', metadata: { env: 'dev' } }, 20);

      const res = await postPreview({
        ...input(),
        query: 'timeout',
        metadataFilters: [{ key: 'env', op: 'equals', value: 'prod' }],
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().preview.incidents[0].peakValue).toBe(7);
    });

    it('route rejects an invalid metadata filter', async () => {
      const res = await postPreview({ ...input(), metadataFilters: [{ key: 'env', op: 'equals' }] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Validation error');
    });

    it('route rejects a query longer than 2,000 characters', async () => {
      const res = await postPreview({ ...input(), query: 'a'.repeat(2001) });
      expect(res.statusCode).toBe(400);
    });

    it('route accepts the payload of an existing rule for edit', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          organizationId,
          projectId,
          name: 'Gateway timeouts',
          level: ['error'],
          threshold: 5,
          timeWindow: 5,
          query: 'timeout',
          renotifyMinutes: 30,
          metadataFilters: [{ key: 'env', op: 'equals', value: 'prod' }],
          emailRecipients: ['ops@example.com'],
        },
      });
      expect(created.statusCode).toBe(201);
      const ruleId = created.json().alertRule.id;

      await seed(projectId, 6, { message: 'upstream timeout', metadata: { env: 'prod' } });
      await seed(projectId, 6, { message: 'upstream timeout', metadata: { env: 'dev' } }, 20);

      const fetched = await app.inject({
        method: 'GET',
        url: `/api/v1/alerts/${ruleId}?organizationId=${organizationId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(fetched.statusCode).toBe(200);
      const { alertRule } = fetched.json();

      const res = await postPreview({ ...alertRule, organizationId, previewRange: '1d' });

      expect(res.statusCode).toBe(200);
      // the saved query and metadata filters are applied
      expect(res.json().preview.incidents[0].peakValue).toBe(6);
    });

    it('route keeps the project ownership check', async () => {
      const other = await createTestContext();
      const res = await postPreview({ ...input(), projectId: other.project.id, query: 'timeout' });
      expect(res.statusCode).toBe(403);
    });
  });
});
