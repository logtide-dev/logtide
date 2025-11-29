import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { build } from '../../../server.js';
import { createTestContext, createTestTrace, createTestSpan, createTestApiKey } from '../../helpers/index.js';
import crypto from 'crypto';

describe('Traces Routes', () => {
  let app: any;
  let context: Awaited<ReturnType<typeof createTestContext>>;
  let apiKey: string;

  beforeEach(async () => {
    if (!app) {
      app = await build();
      await app.ready();
    }

    context = await createTestContext();
    apiKey = context.apiKey.plainKey;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ==========================================================================
  // GET /api/v1/traces
  // ==========================================================================
  describe('GET /api/v1/traces', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return empty list when no traces', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('should return traces for a project', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'my-service',
      });

      const response = await request(app.server)
        .get('/api/v1/traces')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toHaveLength(1);
      expect(response.body.traces[0].service_name).toBe('my-service');
    });

    it('should filter by service', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'service-a',
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'service-b',
      });

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ service: 'service-a' })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toHaveLength(1);
      expect(response.body.traces[0].service_name).toBe('service-a');
    });

    it('should filter by error status', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        error: true,
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        error: false,
      });

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ error: true })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toHaveLength(1);
      expect(response.body.traces[0].error).toBe(true);
    });

    it('should filter by time range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        startTime: yesterday,
        serviceName: 'old',
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        startTime: now,
        serviceName: 'new',
      });

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({
          from: new Date(now.getTime() - 1000).toISOString(),
          to: new Date(now.getTime() + 1000).toISOString(),
        })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toHaveLength(1);
      expect(response.body.traces[0].service_name).toBe('new');
    });

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestTrace({
          projectId: context.project.id,
          organizationId: context.organization.id,
        });
      }

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ limit: 2, offset: 0 })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toHaveLength(2);
      expect(response.body.total).toBe(5);
    });
  });

  // ==========================================================================
  // GET /api/v1/traces/:traceId
  // ==========================================================================
  describe('GET /api/v1/traces/:traceId', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/some-trace-id')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 404 for non-existent trace', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/non-existent-trace')
        .set('x-api-key', apiKey)
        .expect(404);

      expect(response.body.error).toContain('Trace not found');
    });

    it('should return trace details', async () => {
      const trace = await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'my-service',
        rootOperationName: 'my-op',
        durationMs: 150,
      });

      const response = await request(app.server)
        .get(`/api/v1/traces/${trace.trace_id}`)
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.trace_id).toBe(trace.trace_id);
      expect(response.body.service_name).toBe('my-service');
      expect(response.body.root_operation_name).toBe('my-op');
      expect(response.body.duration_ms).toBe(150);
    });
  });

  // ==========================================================================
  // GET /api/v1/traces/:traceId/spans
  // ==========================================================================
  describe('GET /api/v1/traces/:traceId/spans', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/some-trace/spans')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return empty spans for non-existent trace', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/non-existent/spans')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.spans).toEqual([]);
    });

    it('should return spans for a trace', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        startTime: now,
        operationName: 'span-1',
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        startTime: new Date(now.getTime() + 100),
        operationName: 'span-2',
      });

      const response = await request(app.server)
        .get(`/api/v1/traces/${traceId}/spans`)
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.spans).toHaveLength(2);
      expect(response.body.spans[0].operation_name).toBe('span-1');
      expect(response.body.spans[1].operation_name).toBe('span-2');
    });
  });

  // ==========================================================================
  // GET /api/v1/traces/services
  // ==========================================================================
  describe('GET /api/v1/traces/services', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/services')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return empty list when no traces', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/services')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.services).toEqual([]);
    });

    it('should return unique service names', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'service-b',
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'service-a',
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'service-a',
      });

      const response = await request(app.server)
        .get('/api/v1/traces/services')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.services).toEqual(['service-a', 'service-b']);
    });
  });

  // ==========================================================================
  // GET /api/v1/traces/dependencies
  // ==========================================================================
  describe('GET /api/v1/traces/dependencies', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/dependencies')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return empty graph when no dependencies', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/dependencies')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.nodes).toEqual([]);
      expect(response.body.edges).toEqual([]);
    });

    it('should return service dependency graph', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      const parentSpan = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        spanId: 'parent-span',
        serviceName: 'gateway',
        startTime: now,
      });

      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        parentSpanId: parentSpan.span_id,
        serviceName: 'backend',
        startTime: new Date(now.getTime() + 10),
      });

      const response = await request(app.server)
        .get('/api/v1/traces/dependencies')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.nodes).toHaveLength(2);
      expect(response.body.edges).toHaveLength(1);
      expect(response.body.edges[0]).toMatchObject({
        source: 'gateway',
        target: 'backend',
        callCount: 1,
      });
    });

    it('should filter by time range', async () => {
      const now = new Date();

      const response = await request(app.server)
        .get('/api/v1/traces/dependencies')
        .query({
          from: new Date(now.getTime() - 1000).toISOString(),
          to: new Date(now.getTime() + 1000).toISOString(),
        })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.nodes).toEqual([]);
      expect(response.body.edges).toEqual([]);
    });
  });

  // ==========================================================================
  // GET /api/v1/traces/stats
  // ==========================================================================
  describe('GET /api/v1/traces/stats', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/stats')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return zeros when no traces', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/stats')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.total_traces).toBe(0);
      expect(response.body.total_spans).toBe(0);
      expect(response.body.error_count).toBe(0);
      // error_rate may be NaN (serialized as null), 0, or undefined when total_traces is 0
      expect(
        response.body.error_rate === null ||
        response.body.error_rate === 0 ||
        response.body.error_rate === undefined ||
        Number.isNaN(response.body.error_rate)
      ).toBe(true);
    });

    it('should return calculated stats', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        durationMs: 100,
        spanCount: 5,
        error: false,
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        durationMs: 200,
        spanCount: 3,
        error: true,
      });

      const response = await request(app.server)
        .get('/api/v1/traces/stats')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.total_traces).toBe(2);
      expect(response.body.total_spans).toBe(8);
      expect(response.body.avg_duration_ms).toBe(150);
      expect(response.body.max_duration_ms).toBe(200);
      expect(response.body.error_count).toBe(1);
      expect(response.body.error_rate).toBe(0.5);
    });

    it('should filter by time range', async () => {
      const now = new Date();

      const response = await request(app.server)
        .get('/api/v1/traces/stats')
        .query({
          from: new Date(now.getTime() - 1000).toISOString(),
          to: new Date(now.getTime() + 1000).toISOString(),
        })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.total_traces).toBe(0);
    });
  });
});
