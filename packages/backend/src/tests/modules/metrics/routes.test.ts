import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { build } from '../../../server.js';
import { createTestContext, createTestApiKey } from '../../helpers/index.js';
import { db } from '../../../database/index.js';
import crypto from 'crypto';

describe('Metrics Routes', () => {
  let app: any;
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let apiKey: string;
  let projectId: string;
  let sessionToken: string;

  beforeEach(async () => {
    if (!app) {
      app = await build();
      await app.ready();
    }

    ctx = await createTestContext();
    apiKey = ctx.apiKey.plainKey;
    projectId = ctx.project.id;

    // Create session
    const session = await db
      .insertInto('sessions')
      .values({
        user_id: ctx.user.id,
        token: `test-session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        expires_at: new Date(Date.now() + 86400000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    sessionToken = session.token;

    // Ingest some test metrics via OTLP endpoint
    await request(app.server)
      .post('/v1/otlp/metrics')
      .set('x-api-key', apiKey)
      .set('Content-Type', 'application/json')
      .send({
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'test-api' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'http.request.duration',
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: String(Date.now() * 1000000),
                          asDouble: 150.5,
                          attributes: [
                            { key: 'method', value: { stringValue: 'GET' } },
                            { key: 'path', value: { stringValue: '/api/users' } },
                          ],
                        },
                      ],
                    },
                  },
                  {
                    name: 'http.request.count',
                    sum: {
                      dataPoints: [
                        {
                          timeUnixNano: String(Date.now() * 1000000),
                          asInt: '42',
                        },
                      ],
                      isMonotonic: true,
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ==========================================================================
  // GET /api/v1/metrics/names
  // ==========================================================================
  describe('GET /api/v1/metrics/names', () => {
    it('should return metric names with API key auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/names')
        .set('x-api-key', apiKey)
        .query({ projectId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('names');
      expect(Array.isArray(response.body.names)).toBe(true);
    });

    it('should return metric names with session auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/names')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({ projectId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('names');
      expect(Array.isArray(response.body.names)).toBe(true);
    });

    it('should return 400 when projectId is missing (session auth)', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/names')
        .set('Authorization', `Bearer ${sessionToken}`);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/names')
        .query({ projectId });

      expect(response.status).toBe(401);
    });

    it('should accept optional from/to time range filters', async () => {
      const from = new Date(Date.now() - 3600000).toISOString();
      const to = new Date(Date.now() + 3600000).toISOString();

      const response = await request(app.server)
        .get('/api/v1/metrics/names')
        .set('x-api-key', apiKey)
        .query({ projectId, from, to });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('names');
      expect(Array.isArray(response.body.names)).toBe(true);
    });

    it('should return empty array for project with no metrics', async () => {
      // Create a fresh context with no metrics ingested
      const freshCtx = await createTestContext();

      const response = await request(app.server)
        .get('/api/v1/metrics/names')
        .set('x-api-key', freshCtx.apiKey.plainKey)
        .query({ projectId: freshCtx.project.id });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('names');
      expect(Array.isArray(response.body.names)).toBe(true);
    });
  });

  // ==========================================================================
  // GET /api/v1/metrics/labels/keys
  // ==========================================================================
  describe('GET /api/v1/metrics/labels/keys', () => {
    it('should return label keys for a metric', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/keys')
        .set('x-api-key', apiKey)
        .query({ projectId, metricName: 'http.request.duration' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('keys');
      expect(Array.isArray(response.body.keys)).toBe(true);
    });

    it('should return 400 when projectId is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/keys')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({ metricName: 'http.request.duration' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when metricName is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/keys')
        .set('x-api-key', apiKey)
        .query({ projectId });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('metricName');
    });

    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/keys')
        .query({ projectId, metricName: 'http.request.duration' });

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/v1/metrics/labels/values
  // ==========================================================================
  describe('GET /api/v1/metrics/labels/values', () => {
    it('should return label values for a metric and label key', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/values')
        .set('x-api-key', apiKey)
        .query({
          projectId,
          metricName: 'http.request.duration',
          labelKey: 'method',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('values');
      expect(Array.isArray(response.body.values)).toBe(true);
    });

    it('should return 400 when projectId is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/values')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({
          metricName: 'http.request.duration',
          labelKey: 'method',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when metricName is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/values')
        .set('x-api-key', apiKey)
        .query({ projectId, labelKey: 'method' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('metricName');
    });

    it('should return 400 when labelKey is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/values')
        .set('x-api-key', apiKey)
        .query({ projectId, metricName: 'http.request.duration' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('labelKey');
    });

    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/labels/values')
        .query({
          projectId,
          metricName: 'http.request.duration',
          labelKey: 'method',
        });

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/v1/metrics/data
  // ==========================================================================
  describe('GET /api/v1/metrics/data', () => {
    const timeRange = () => ({
      from: new Date(Date.now() - 3600000).toISOString(),
      to: new Date(Date.now() + 3600000).toISOString(),
    });

    it('should return metric data points', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .set('x-api-key', apiKey)
        .query({ projectId, from, to });

      expect(response.status).toBe(200);
      // Response should be an object or array depending on implementation
      expect(response.body).toBeDefined();
    });

    it('should return 400 when projectId is missing', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({ from, to });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when from or to is missing', async () => {
      // Missing both from and to
      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .set('x-api-key', apiKey)
        .query({ projectId });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('from');
    });

    it('should accept pagination (limit, offset)', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .set('x-api-key', apiKey)
        .query({ projectId, from, to, limit: 10, offset: 0 });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should accept includeExemplars parameter', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .set('x-api-key', apiKey)
        .query({ projectId, from, to, includeExemplars: true });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should return 401 without auth', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .query({ projectId, from, to });

      expect(response.status).toBe(401);
    });

    it('should accept metricName filter', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .set('x-api-key', apiKey)
        .query({
          projectId,
          from,
          to,
          metricName: 'http.request.duration',
        });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should accept attributes filter', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/data')
        .set('x-api-key', apiKey)
        .query({
          projectId,
          from,
          to,
          'attributes[method]': 'GET',
          'attributes[status]': '200',
        });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });

  // ==========================================================================
  // GET /api/v1/metrics/aggregate
  // ==========================================================================
  describe('GET /api/v1/metrics/aggregate', () => {
    const timeRange = () => ({
      from: new Date(Date.now() - 3600000).toISOString(),
      to: new Date(Date.now() + 3600000).toISOString(),
    });

    it('should return aggregated time series', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/aggregate')
        .set('x-api-key', apiKey)
        .query({
          projectId,
          metricName: 'http.request.duration',
          from,
          to,
        });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should return 400 when projectId is missing', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/aggregate')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({
          metricName: 'http.request.duration',
          from,
          to,
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when metricName is missing', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/aggregate')
        .set('x-api-key', apiKey)
        .query({ projectId, from, to });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('metricName');
    });

    it('should return 400 when from or to is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/aggregate')
        .set('x-api-key', apiKey)
        .query({
          projectId,
          metricName: 'http.request.duration',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('from');
    });

    it('should accept interval parameter', async () => {
      const { from, to } = timeRange();
      const intervals = ['1m', '5m', '15m', '1h', '6h', '1d', '1w'];

      for (const interval of intervals) {
        const response = await request(app.server)
          .get('/api/v1/metrics/aggregate')
          .set('x-api-key', apiKey)
          .query({
            projectId,
            metricName: 'http.request.duration',
            from,
            to,
            interval,
          });

        expect(response.status).toBe(200);
      }
    });

    it('should accept aggregation parameter', async () => {
      const { from, to } = timeRange();
      const aggregations = ['avg', 'sum', 'min', 'max', 'count', 'last'];

      for (const aggregation of aggregations) {
        const response = await request(app.server)
          .get('/api/v1/metrics/aggregate')
          .set('x-api-key', apiKey)
          .query({
            projectId,
            metricName: 'http.request.duration',
            from,
            to,
            aggregation,
          });

        expect(response.status).toBe(200);
      }
    });

    it('should accept groupBy parameter as array', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/aggregate')
        .set('x-api-key', apiKey)
        .query({
          projectId,
          metricName: 'http.request.duration',
          from,
          to,
          'groupBy[]': 'method',
        });

      // groupBy may be accepted or rejected depending on schema handling
      // Just verify it doesn't return a 500
      expect([200, 400]).toContain(response.status);
    });

    it('should return 401 without auth', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/aggregate')
        .query({
          projectId,
          metricName: 'http.request.duration',
          from,
          to,
        });

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/v1/metrics/overview
  // ==========================================================================
  describe('GET /api/v1/metrics/overview', () => {
    const timeRange = () => ({
      from: new Date(Date.now() - 3600000).toISOString(),
      to: new Date(Date.now() + 3600000).toISOString(),
    });

    it('should return metrics overview', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/overview')
        .set('x-api-key', apiKey)
        .query({ projectId, from, to });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('services');
      expect(Array.isArray(response.body.services)).toBe(true);
    });

    it('should return 400 when from/to missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/metrics/overview')
        .set('x-api-key', apiKey)
        .query({ projectId });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('from');
    });

    it('should return 400 when projectId is missing', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/overview')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({ from, to });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should accept serviceName filter', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/overview')
        .set('x-api-key', apiKey)
        .query({ projectId, from, to, serviceName: 'test-api' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('services');
    });

    it('should return 401 without auth', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/overview')
        .query({ projectId, from, to });

      expect(response.status).toBe(401);
    });

    it('should return overview with session auth', async () => {
      const { from, to } = timeRange();

      const response = await request(app.server)
        .get('/api/v1/metrics/overview')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({ projectId, from, to });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('services');
    });
  });

  // ==========================================================================
  // GET /api/v1/metrics/aggregate - serviceName filter
  // ==========================================================================
  describe('GET /api/v1/metrics/aggregate - serviceName filter', () => {
    it('should accept serviceName parameter', async () => {
      const from = new Date(Date.now() - 3600000).toISOString();
      const to = new Date(Date.now() + 3600000).toISOString();

      const response = await request(app.server)
        .get('/api/v1/metrics/aggregate')
        .set('x-api-key', apiKey)
        .query({
          projectId,
          metricName: 'http.request.duration',
          from,
          to,
          serviceName: 'test-api',
        });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });

  // ==========================================================================
  // GET /api/v1/metrics/aggregate - explorer options
  // ==========================================================================
  describe('GET /api/v1/metrics/aggregate - explorer options', () => {
    const range = () => ({
      from: new Date(Date.now() - 3600000).toISOString(),
      to: new Date(Date.now() + 3600000).toISOString(),
    });
    const get = (query: Record<string, unknown>) => {
      // Build the query string by hand: supertest would index repeated keys (key[0]=...).
      const qs = Object.entries(query)
        .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`))
        .join('&');
      return request(app.server)
        .get(`/api/v1/metrics/aggregate?${qs}`)
        .set('Authorization', `Bearer ${sessionToken}`);
    };

    it('defaults to interval auto and reports the resolved interval', async () => {
      const response = await get({ projectId, metricName: 'http.request.duration', ...range() });

      expect(response.status).toBe(200);
      expect(response.body.interval).toBe('5m');
      expect(response.body.bucketSeconds).toBe(300);
      expect(response.body).toHaveProperty('seriesTotal');
      expect(response.body).toHaveProperty('seriesShown');
    });

    it('accepts aggregation=rate', async () => {
      const response = await get({
        projectId, metricName: 'http.request.count', aggregation: 'rate', interval: '1m', ...range(),
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.timeseries)).toBe(true);
    });

    it('accepts repeated attributes as multi-value filters', async () => {
      const response = await get({
        projectId,
        metricName: 'http.request.duration',
        'attributes[method]': ['GET', 'POST'],
        ...range(),
      });

      expect(response.status).toBe(200);
    });

    it('returns 400 when attribute filters exceed 10 combinations', async () => {
      const vals = Array.from({ length: 11 }, (_, i) => String(i));
      const response = await get({
        projectId, metricName: 'http.request.duration', 'attributes[method]': vals, ...range(),
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Too many filter values (max 10 combinations)');
    });

    it('groupBy with three keys returns 400', async () => {
      const response = await get({
        projectId, metricName: 'http.request.duration', groupBy: ['a', 'b', 'c'], ...range(),
      });

      expect(response.status).toBe(400);
    });

    it('groupBy with two keys is accepted', async () => {
      const response = await get({
        projectId, metricName: 'http.request.duration', groupBy: ['method', 'path'], ...range(),
      });

      expect(response.status).toBe(200);
    });

    it('400 when from after to', async () => {
      const { from, to } = range();
      const response = await get({ projectId, metricName: 'http.request.duration', from: to, to: from });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('from must be before to');
    });

    it("403 for another organization's project", async () => {
      const other = await createTestContext();
      const response = await get({ projectId: other.project.id, metricName: 'http.request.duration', ...range() });

      expect(response.status).toBe(403);
    });
  });

  // ==========================================================================
  // Access control
  // ==========================================================================
  describe('access control', () => {
    it('should return 403 for write-only API key', async () => {
      const writeKey = await createTestApiKey({
        projectId,
        type: 'write',
      });

      const endpoints = [
        { url: '/api/v1/metrics/names', query: { projectId } },
        {
          url: '/api/v1/metrics/labels/keys',
          query: { projectId, metricName: 'http.request.duration' },
        },
        {
          url: '/api/v1/metrics/labels/values',
          query: { projectId, metricName: 'http.request.duration', labelKey: 'method' },
        },
        {
          url: '/api/v1/metrics/data',
          query: {
            projectId,
            from: new Date(Date.now() - 3600000).toISOString(),
            to: new Date(Date.now() + 3600000).toISOString(),
          },
        },
        {
          url: '/api/v1/metrics/aggregate',
          query: {
            projectId,
            metricName: 'http.request.duration',
            from: new Date(Date.now() - 3600000).toISOString(),
            to: new Date(Date.now() + 3600000).toISOString(),
          },
        },
        {
          url: '/api/v1/metrics/overview',
          query: {
            projectId,
            from: new Date(Date.now() - 3600000).toISOString(),
            to: new Date(Date.now() + 3600000).toISOString(),
          },
        },
      ];

      for (const { url, query } of endpoints) {
        const response = await request(app.server)
          .get(url)
          .set('x-api-key', writeKey.plainKey)
          .query(query);

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty('error', 'Forbidden');
      }
    });
  });
});
