import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { build } from '../../../server.js';
import { createTestContext, createTestTrace, createTestSpan, createTestApiKey } from '../../helpers/index.js';
import { db } from '../../../database/index.js';
import crypto from 'crypto';

async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: expiresAt })
    .execute();
  return { token };
}

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

    it('should accept a CSV list of services and match any of them', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'svc-a',
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'svc-b',
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'svc-c',
      });

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ service: 'svc-a,svc-b' })
        .set('x-api-key', apiKey)
        .expect(200);

      const services = response.body.traces.map((t: any) => t.service_name).sort();
      expect(services).toEqual(['svc-a', 'svc-b']);
    });

    it('should filter by minDurationMs', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        durationMs: 50,
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        durationMs: 500,
      });

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ minDurationMs: 200 })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toHaveLength(1);
      expect(response.body.traces[0].duration_ms).toBe(500);
    });

    it('should filter by maxDurationMs', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        durationMs: 50,
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        durationMs: 500,
      });

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ maxDurationMs: 100 })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.traces).toHaveLength(1);
      expect(response.body.traces[0].duration_ms).toBe(50);
    });

    it('should combine minDurationMs and maxDurationMs to bracket a range', async () => {
      for (const ms of [10, 100, 500, 2000]) {
        await createTestTrace({
          projectId: context.project.id,
          organizationId: context.organization.id,
          durationMs: ms,
        });
      }

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ minDurationMs: 50, maxDurationMs: 1000 })
        .set('x-api-key', apiKey)
        .expect(200);

      const durations = response.body.traces.map((t: any) => t.duration_ms).sort((a: number, b: number) => a - b);
      expect(durations).toEqual([100, 500]);
    });
  });

  // ==========================================================================
  // GET /api/v1/traces/stream  (SSE live tail)
  // ==========================================================================
  describe('GET /api/v1/traces/stream', () => {
    it('should return 400 when no projectId is provided', async () => {
      const session = await createSession(context.user.id);
      const response = await request(app.server)
        .get('/api/v1/traces/stream')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(400);
      expect(response.body.error).toContain('Project context missing');
    });

    it('should reject cross-project access with session auth', async () => {
      const other = await createTestContext();
      const session = await createSession(context.user.id);
      const response = await request(app.server)
        .get('/api/v1/traces/stream')
        .query({ projectId: other.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);
      expect(response.body.error).toContain('Access denied');
    });

    it('should set SSE headers and emit the connected event via inject', async () => {
      // Fastify's inject buffers the full response, so for SSE we drive it
      // via app.inject and read the payload after the first tick. The
      // handler writes `type:"connected"` synchronously before the
      // setInterval starts, which is enough to exercise the headers + the
      // initial frame without having to bind the server to a socket.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/traces/stream?projectId=${context.project.id}`,
        headers: { 'x-api-key': apiKey },
        payloadAsStream: true,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      const stream = res.stream();
      const chunk: Buffer = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          stream.destroy();
          reject(new Error('timeout waiting for connected frame'));
        }, 2000);
        stream.once('data', (b: Buffer) => {
          clearTimeout(timer);
          stream.destroy();
          resolve(b);
        });
        stream.once('error', (err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      expect(chunk.toString('utf8')).toContain('"type":"connected"');
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

  // ==========================================================================
  // GET /api/v1/traces/service-map
  // ==========================================================================
  describe('GET /api/v1/traces/service-map', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/service-map')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return empty graph when no data', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/service-map')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.nodes).toEqual([]);
      expect(response.body.edges).toEqual([]);
    });

    it('should return enriched service map with span dependencies', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      const parentSpan = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        spanId: 'route-parent',
        serviceName: 'web-app',
        startTime: now,
      });

      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        parentSpanId: parentSpan.span_id,
        serviceName: 'api-server',
        startTime: new Date(now.getTime() + 10),
      });

      const response = await request(app.server)
        .get('/api/v1/traces/service-map')
        .query({
          from: new Date(now.getTime() - 5000).toISOString(),
          to: new Date(now.getTime() + 5000).toISOString(),
        })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.nodes).toHaveLength(2);
      expect(response.body.edges).toHaveLength(1);

      // Verify enriched node structure
      const webNode = response.body.nodes.find((n: any) => n.name === 'web-app');
      expect(webNode).toBeDefined();
      expect(webNode.id).toBe('web-app');
      expect(typeof webNode.callCount).toBe('number');
      expect(typeof webNode.errorRate).toBe('number');
      expect(typeof webNode.avgLatencyMs).toBe('number');
      expect(typeof webNode.totalCalls).toBe('number');

      // Verify enriched edge structure
      expect(response.body.edges[0]).toMatchObject({
        source: 'web-app',
        target: 'api-server',
        callCount: 1,
        type: 'span',
      });
    });

    it('should filter by time range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Old data
      const oldTraceId = crypto.randomBytes(16).toString('hex');
      const oldParent = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: oldTraceId,
        spanId: 'route-old-p',
        serviceName: 'old-a',
        startTime: yesterday,
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: oldTraceId,
        parentSpanId: oldParent.span_id,
        serviceName: 'old-b',
        startTime: yesterday,
      });

      // Query recent window only
      const response = await request(app.server)
        .get('/api/v1/traces/service-map')
        .query({
          from: new Date(now.getTime() - 1000).toISOString(),
          to: new Date(now.getTime() + 1000).toISOString(),
        })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.nodes).toEqual([]);
      expect(response.body.edges).toEqual([]);
    });

    it('should return service map without time range (defaults)', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces/service-map')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('nodes');
      expect(response.body).toHaveProperty('edges');
      expect(Array.isArray(response.body.nodes)).toBe(true);
      expect(Array.isArray(response.body.edges)).toBe(true);
    });

    it('should work with session auth', async () => {
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/service-map')
        .query({ projectId: context.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      expect(response.body.nodes).toEqual([]);
      expect(response.body.edges).toEqual([]);
    });

    it('should return 403 for unauthorized project via session', async () => {
      const otherContext = await createTestContext();
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/service-map')
        .query({ projectId: otherContext.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);

      expect(response.body.error).toContain('Access denied');
    });
  });

  // ==========================================================================
  // Session auth coverage for existing routes
  // ==========================================================================
  describe('Session auth - project access control', () => {
    it('GET /api/v1/traces should work with session auth', async () => {
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ projectId: context.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      expect(response.body.traces).toEqual([]);
    });

    it('GET /api/v1/traces should return 403 for unauthorized project', async () => {
      const otherContext = await createTestContext();
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces')
        .query({ projectId: otherContext.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);

      expect(response.body.error).toContain('Access denied');
    });

    it('GET /api/v1/traces/:traceId should return 403 for unauthorized project', async () => {
      const otherContext = await createTestContext();
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/some-trace')
        .query({ projectId: otherContext.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);

      expect(response.body.error).toContain('Access denied');
    });

    it('GET /api/v1/traces/:traceId/spans should return 403 for unauthorized project', async () => {
      const otherContext = await createTestContext();
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/some-trace/spans')
        .query({ projectId: otherContext.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);

      expect(response.body.error).toContain('Access denied');
    });

    it('GET /api/v1/traces/services should return 403 for unauthorized project', async () => {
      const otherContext = await createTestContext();
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/services')
        .query({ projectId: otherContext.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);

      expect(response.body.error).toContain('Access denied');
    });

    it('GET /api/v1/traces/dependencies should return 403 for unauthorized project', async () => {
      const otherContext = await createTestContext();
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/dependencies')
        .query({ projectId: otherContext.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);

      expect(response.body.error).toContain('Access denied');
    });

    it('GET /api/v1/traces/stats should return 403 for unauthorized project', async () => {
      const otherContext = await createTestContext();
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/stats')
        .query({ projectId: otherContext.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);

      expect(response.body.error).toContain('Access denied');
    });

    it('GET /api/v1/traces/stats should work with session auth', async () => {
      const session = await createSession(context.user.id);

      const response = await request(app.server)
        .get('/api/v1/traces/stats')
        .query({ projectId: context.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      expect(response.body.total_traces).toBe(0);
    });
  });
});

// ============================================================================
// W4: operations, latency histogram, list params
// ============================================================================
describe('Traces APM routes', () => {
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

  async function seedEntrySpan(over: {
    service?: string;
    operation: string;
    durationMs: number;
    statusCode?: 'OK' | 'ERROR';
    attributes?: Record<string, unknown>;
  }) {
    const startTime = new Date(Date.now() - 60_000);
    const trace = await createTestTrace({
      projectId: context.project.id,
      organizationId: context.organization.id,
      serviceName: over.service ?? 'api',
      rootServiceName: over.service ?? 'api',
      rootOperationName: over.operation,
      startTime,
      durationMs: over.durationMs,
    });
    await createTestSpan({
      projectId: context.project.id,
      organizationId: context.organization.id,
      traceId: trace.trace_id,
      serviceName: over.service ?? 'api',
      operationName: over.operation,
      kind: 'SERVER',
      statusCode: over.statusCode ?? 'OK',
      startTime,
      durationMs: over.durationMs,
      attributes: over.attributes ?? null,
    });
    return trace;
  }

  describe('GET /api/v1/traces/operations', () => {
    it('returns 401 without auth', async () => {
      await request(app.server).get('/api/v1/traces/operations').expect(401);
    });

    it('returns 400 without projectId', async () => {
      const session = await createSession(context.user.id);
      const res = await request(app.server)
        .get('/api/v1/traces/operations')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(400);
      expect(res.body.error).toContain('projectId');
    });

    it('returns operations sorted by p95 desc for seeded SERVER spans', async () => {
      await seedEntrySpan({ operation: 'GET /fast', durationMs: 20 });
      await seedEntrySpan({ operation: 'GET /slow', durationMs: 900, statusCode: 'ERROR' });
      await seedEntrySpan({ operation: 'GET /mid', durationMs: 200 });

      const res = await request(app.server)
        .get('/api/v1/traces/operations')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(res.body.operations.map((o: any) => o.operation)).toEqual(['GET /slow', 'GET /mid', 'GET /fast']);
      const slow = res.body.operations[0];
      expect(slow.count).toBe(1);
      expect(slow.errorCount).toBe(1);
      expect(slow.errorRate).toBe(1);
      expect(slow.throughputPerMin).toBeGreaterThan(0);
      expect(res.body.operations[2].errorRate).toBe(0);
    });

    it('filters by service', async () => {
      await seedEntrySpan({ service: 'api', operation: 'GET /a', durationMs: 50 });
      await seedEntrySpan({ service: 'worker', operation: 'job', durationMs: 70 });

      const res = await request(app.server)
        .get('/api/v1/traces/operations')
        .query({ service: 'worker' })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(res.body.operations).toHaveLength(1);
      expect(res.body.operations[0].service).toBe('worker');
    });

    it('returns 403 for a project of another org (session auth)', async () => {
      const other = await createTestContext();
      const session = await createSession(context.user.id);
      await request(app.server)
        .get('/api/v1/traces/operations')
        .query({ projectId: other.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);
    });

    it('returns 400 when from is after to', async () => {
      await request(app.server)
        .get('/api/v1/traces/operations')
        .query({ from: '2026-10-22T12:00:00.000Z', to: '2026-10-22T11:00:00.000Z' })
        .set('x-api-key', apiKey)
        .expect(400);
    });
  });

  describe('GET /api/v1/traces/latency-histogram', () => {
    it('returns 401 without auth', async () => {
      await request(app.server).get('/api/v1/traces/latency-histogram').expect(401);
    });

    it('returns 403 for a project of another org (session auth)', async () => {
      const other = await createTestContext();
      const session = await createSession(context.user.id);
      await request(app.server)
        .get('/api/v1/traces/latency-histogram')
        .query({ projectId: other.project.id })
        .set('Authorization', `Bearer ${session.token}`)
        .expect(403);
    });

    it('returns bounds and counts with counts one longer than bounds', async () => {
      await seedEntrySpan({ operation: 'GET /a', durationMs: 20 });
      await seedEntrySpan({ operation: 'GET /b', durationMs: 900 });

      const res = await request(app.server)
        .get('/api/v1/traces/latency-histogram')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(Array.isArray(res.body.bounds)).toBe(true);
      expect(res.body.counts).toHaveLength(res.body.bounds.length + 1);
      expect(res.body.counts.reduce((a: number, b: number) => a + b, 0)).toBe(2);
    });

    it('filters by operation', async () => {
      await seedEntrySpan({ operation: 'GET /a', durationMs: 20 });
      await seedEntrySpan({ operation: 'GET /b', durationMs: 900 });

      const res = await request(app.server)
        .get('/api/v1/traces/latency-histogram')
        .query({ operation: 'GET /b' })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(res.body.counts.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    });
  });

  describe('GET /api/v1/traces list params', () => {
    it('filters by operation', async () => {
      const a = await seedEntrySpan({ operation: 'GET /a', durationMs: 20 });
      await seedEntrySpan({ operation: 'GET /b', durationMs: 30 });

      const res = await request(app.server)
        .get('/api/v1/traces')
        .query({ operation: 'GET /a' })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(res.body.traces.map((t: any) => t.trace_id)).toEqual([a.trace_id]);
    });

    it('sorts by duration asc and desc', async () => {
      await seedEntrySpan({ operation: 'a', durationMs: 300 });
      await seedEntrySpan({ operation: 'b', durationMs: 100 });
      await seedEntrySpan({ operation: 'c', durationMs: 200 });

      const asc = await request(app.server)
        .get('/api/v1/traces')
        .query({ sortBy: 'duration', sortOrder: 'asc' })
        .set('x-api-key', apiKey)
        .expect(200);
      expect(asc.body.traces.map((t: any) => t.duration_ms)).toEqual([100, 200, 300]);

      const desc = await request(app.server)
        .get('/api/v1/traces')
        .query({ sortBy: 'duration', sortOrder: 'desc' })
        .set('x-api-key', apiKey)
        .expect(200);
      expect(desc.body.traces.map((t: any) => t.duration_ms)).toEqual([300, 200, 100]);
    });

    it('filters by attr http.method:GET', async () => {
      const get = await seedEntrySpan({ operation: 'a', durationMs: 20, attributes: { 'http.method': 'GET' } });
      await seedEntrySpan({ operation: 'b', durationMs: 20, attributes: { 'http.method': 'POST' } });

      const res = await request(app.server)
        .get('/api/v1/traces')
        .query({ attr: 'http.method:GET' })
        .set('x-api-key', apiKey)
        .expect(200);

      expect(res.body.traces.map((t: any) => t.trace_id)).toEqual([get.trace_id]);
    });

    it('returns 400 with position for attr "timeout"', async () => {
      const res = await request(app.server)
        .get('/api/v1/traces')
        .query({ attr: 'timeout' })
        .set('x-api-key', apiKey)
        .expect(400);

      expect(typeof res.body.error).toBe('string');
      expect(res.body.position).toBe(0);
    });

    it('returns 400 for sortBy=foo', async () => {
      await request(app.server)
        .get('/api/v1/traces')
        .query({ sortBy: 'foo' })
        .set('x-api-key', apiKey)
        .expect(400);
    });

    it('stats include p95_duration_ms', async () => {
      await seedEntrySpan({ operation: 'a', durationMs: 250 });

      const res = await request(app.server)
        .get('/api/v1/traces/stats')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(res.body.p95_duration_ms).toBeGreaterThan(0);
    });
  });
});
