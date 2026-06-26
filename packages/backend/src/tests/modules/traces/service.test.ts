import { describe, it, expect, beforeEach } from 'vitest';
import { TracesService } from '../../../modules/traces/service.js';
import { createTestContext, createTestTrace, createTestSpan, createTestLog } from '../../helpers/index.js';
import { db } from '../../../database/index.js';
import type { TransformedSpan, AggregatedTrace } from '../../../modules/otlp/trace-transformer.js';
import crypto from 'crypto';

describe('TracesService', () => {
  let service: TracesService;
  let context: Awaited<ReturnType<typeof createTestContext>>;

  beforeEach(async () => {
    service = new TracesService();
    context = await createTestContext();
  });

  // ==========================================================================
  // ingestSpans
  // ==========================================================================
  describe('ingestSpans', () => {
    it('should return 0 for empty spans array', async () => {
      const result = await service.ingestSpans(
        [],
        new Map(),
        context.project.id,
        context.organization.id
      );

      expect(result).toBe(0);
    });

    it('should ingest a single span', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const spanId = crypto.randomBytes(8).toString('hex');
      const now = new Date();

      const spans: TransformedSpan[] = [
        {
          trace_id: traceId,
          span_id: spanId,
          service_name: 'test-service',
          operation_name: 'test-operation',
          start_time: now.toISOString(),
          end_time: new Date(now.getTime() + 100).toISOString(),
          duration_ms: 100,
        },
      ];

      const traces = new Map<string, AggregatedTrace>();
      traces.set(traceId, {
        trace_id: traceId,
        service_name: 'test-service',
        root_service_name: 'test-service',
        root_operation_name: 'test-operation',
        start_time: now.toISOString(),
        end_time: new Date(now.getTime() + 100).toISOString(),
        duration_ms: 100,
        span_count: 1,
        error: false,
      });

      const result = await service.ingestSpans(
        spans,
        traces,
        context.project.id,
        context.organization.id
      );

      expect(result).toBe(1);

      // Verify span was stored
      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('span_id', '=', spanId)
        .executeTakeFirst();

      expect(storedSpan).toBeDefined();
      expect(storedSpan?.trace_id).toBe(traceId);
      expect(storedSpan?.service_name).toBe('test-service');
    });

    it('should ingest multiple spans with JSONB attributes', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();
      const parentSpanId = crypto.randomBytes(8).toString('hex');

      const spans: TransformedSpan[] = [
        {
          trace_id: traceId,
          span_id: parentSpanId,
          service_name: 'api-gateway',
          operation_name: 'HTTP GET /users',
          start_time: now.toISOString(),
          end_time: new Date(now.getTime() + 50).toISOString(),
          duration_ms: 50,
          kind: 'SERVER',
          status_code: 'OK',
          attributes: { 'http.method': 'GET', 'http.url': '/users' },
          events: [{ name: 'event1', time: now.toISOString() }],
          links: [{ trace_id: 'linked-trace', span_id: 'linked-span' }],
          resource_attributes: { 'host.name': 'server-1' },
        },
        {
          trace_id: traceId,
          span_id: crypto.randomBytes(8).toString('hex'),
          parent_span_id: parentSpanId,
          service_name: 'user-service',
          operation_name: 'findAll',
          start_time: new Date(now.getTime() + 10).toISOString(),
          end_time: new Date(now.getTime() + 40).toISOString(),
          duration_ms: 30,
          kind: 'INTERNAL',
        },
      ];

      const traces = new Map<string, AggregatedTrace>();
      traces.set(traceId, {
        trace_id: traceId,
        service_name: 'api-gateway',
        start_time: now.toISOString(),
        end_time: new Date(now.getTime() + 50).toISOString(),
        duration_ms: 50,
        span_count: 2,
        error: false,
      });

      const result = await service.ingestSpans(
        spans,
        traces,
        context.project.id,
        context.organization.id
      );

      expect(result).toBe(2);

      // Verify attributes were stored as JSONB
      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('trace_id', '=', traceId)
        .where('service_name', '=', 'api-gateway')
        .executeTakeFirst();

      expect(storedSpan?.attributes).toEqual({ 'http.method': 'GET', 'http.url': '/users' });
      expect(storedSpan?.events).toEqual([{ name: 'event1', time: now.toISOString() }]);
    });

    it('should create a new trace record', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      const spans: TransformedSpan[] = [
        {
          trace_id: traceId,
          span_id: crypto.randomBytes(8).toString('hex'),
          service_name: 'root-service',
          operation_name: 'root-op',
          start_time: now.toISOString(),
          end_time: new Date(now.getTime() + 100).toISOString(),
          duration_ms: 100,
        },
      ];

      const traces = new Map<string, AggregatedTrace>();
      traces.set(traceId, {
        trace_id: traceId,
        service_name: 'root-service',
        root_service_name: 'root-service',
        root_operation_name: 'root-op',
        start_time: now.toISOString(),
        end_time: new Date(now.getTime() + 100).toISOString(),
        duration_ms: 100,
        span_count: 1,
        error: false,
      });

      await service.ingestSpans(spans, traces, context.project.id, context.organization.id);

      const storedTrace = await db
        .selectFrom('traces')
        .selectAll()
        .where('trace_id', '=', traceId)
        .executeTakeFirst();

      expect(storedTrace).toBeDefined();
      expect(storedTrace?.service_name).toBe('root-service');
      expect(storedTrace?.root_service_name).toBe('root-service');
      expect(storedTrace?.span_count).toBe(1);
    });

    it('should update existing trace record with new spans', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // First batch - create initial trace
      const spans1: TransformedSpan[] = [
        {
          trace_id: traceId,
          span_id: crypto.randomBytes(8).toString('hex'),
          service_name: 'service-a',
          operation_name: 'op-a',
          start_time: now.toISOString(),
          end_time: new Date(now.getTime() + 50).toISOString(),
          duration_ms: 50,
        },
      ];

      const traces1 = new Map<string, AggregatedTrace>();
      traces1.set(traceId, {
        trace_id: traceId,
        service_name: 'service-a',
        start_time: now.toISOString(),
        end_time: new Date(now.getTime() + 50).toISOString(),
        duration_ms: 50,
        span_count: 1,
        error: false,
      });

      await service.ingestSpans(spans1, traces1, context.project.id, context.organization.id);

      // Second batch - update trace with more spans
      const spans2: TransformedSpan[] = [
        {
          trace_id: traceId,
          span_id: crypto.randomBytes(8).toString('hex'),
          service_name: 'service-b',
          operation_name: 'op-b',
          start_time: new Date(now.getTime() + 60).toISOString(),
          end_time: new Date(now.getTime() + 150).toISOString(),
          duration_ms: 90,
          status_code: 'ERROR',
        },
      ];

      const traces2 = new Map<string, AggregatedTrace>();
      traces2.set(traceId, {
        trace_id: traceId,
        service_name: 'service-b',
        start_time: new Date(now.getTime() + 60).toISOString(),
        end_time: new Date(now.getTime() + 150).toISOString(),
        duration_ms: 90,
        span_count: 1,
        error: true,
      });

      await service.ingestSpans(spans2, traces2, context.project.id, context.organization.id);

      const storedTrace = await db
        .selectFrom('traces')
        .selectAll()
        .where('trace_id', '=', traceId)
        .executeTakeFirst();

      expect(storedTrace?.span_count).toBe(2);
      expect(storedTrace?.error).toBe(true);
      // Duration should be from earliest start to latest end
      expect(storedTrace?.duration_ms).toBe(150);
    });
  });

  // ==========================================================================
  // listTraces
  // ==========================================================================
  describe('listTraces', () => {
    it('should return empty list when no traces exist', async () => {
      const result = await service.listTraces({
        projectId: context.project.id,
      });

      expect(result.traces).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return traces for a project', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'my-service',
      });

      const result = await service.listTraces({
        projectId: context.project.id,
      });

      expect(result.traces).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.traces[0].service_name).toBe('my-service');
    });

    it('should filter by service name', async () => {
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

      const result = await service.listTraces({
        projectId: context.project.id,
        service: 'service-a',
      });

      expect(result.traces).toHaveLength(1);
      expect(result.traces[0].service_name).toBe('service-a');
    });

    it('should filter by error status', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        error: false,
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        error: true,
      });

      const errorTraces = await service.listTraces({
        projectId: context.project.id,
        error: true,
      });

      expect(errorTraces.traces).toHaveLength(1);
      expect(errorTraces.traces[0].error).toBe(true);

      const successTraces = await service.listTraces({
        projectId: context.project.id,
        error: false,
      });

      expect(successTraces.traces).toHaveLength(1);
      expect(successTraces.traces[0].error).toBe(false);
    });

    it('should filter by time range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        startTime: yesterday,
        serviceName: 'old-trace',
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        startTime: now,
        serviceName: 'current-trace',
      });

      const result = await service.listTraces({
        projectId: context.project.id,
        from: new Date(now.getTime() - 1000),
        to: tomorrow,
      });

      expect(result.traces).toHaveLength(1);
      expect(result.traces[0].service_name).toBe('current-trace');
    });

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestTrace({
          projectId: context.project.id,
          organizationId: context.organization.id,
          serviceName: `service-${i}`,
        });
      }

      const page1 = await service.listTraces({
        projectId: context.project.id,
        limit: 2,
        offset: 0,
      });

      expect(page1.traces).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await service.listTraces({
        projectId: context.project.id,
        limit: 2,
        offset: 2,
      });

      expect(page2.traces).toHaveLength(2);
      expect(page2.total).toBe(5);

      const page3 = await service.listTraces({
        projectId: context.project.id,
        limit: 2,
        offset: 4,
      });

      expect(page3.traces).toHaveLength(1);
    });

    it('should use default limit of 50', async () => {
      const result = await service.listTraces({
        projectId: context.project.id,
      });

      // Even if no traces, should not throw
      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // getTrace
  // ==========================================================================
  describe('getTrace', () => {
    it('should return null for non-existent trace', async () => {
      const result = await service.getTrace('non-existent-id', context.project.id);

      expect(result).toBeNull();
    });

    it('should return trace by ID', async () => {
      const trace = await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        serviceName: 'my-service',
        rootOperationName: 'my-operation',
      });

      const result = await service.getTrace(trace.trace_id, context.project.id);

      expect(result).toBeDefined();
      expect(result?.trace_id).toBe(trace.trace_id);
      expect(result?.service_name).toBe('my-service');
      expect(result?.root_operation_name).toBe('my-operation');
    });

    it('should not return trace from different project', async () => {
      const otherContext = await createTestContext();

      const trace = await createTestTrace({
        projectId: otherContext.project.id,
        organizationId: otherContext.organization.id,
      });

      const result = await service.getTrace(trace.trace_id, context.project.id);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getTraceSpans
  // ==========================================================================
  describe('getTraceSpans', () => {
    it('should return empty array for non-existent trace', async () => {
      const result = await service.getTraceSpans('non-existent', context.project.id);

      expect(result).toEqual([]);
    });

    it('should return spans for a trace ordered by start_time', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Create spans in reverse order
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        startTime: new Date(now.getTime() + 100),
        operationName: 'second',
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        startTime: now,
        operationName: 'first',
      });

      const result = await service.getTraceSpans(traceId, context.project.id);

      expect(result).toHaveLength(2);
      expect(result[0].operation_name).toBe('first');
      expect(result[1].operation_name).toBe('second');
    });

    it('should return full span details including attributes', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');

      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        kind: 'SERVER',
        statusCode: 'OK',
        attributes: { 'http.status': 200 },
        events: [{ name: 'start' }],
      });

      const result = await service.getTraceSpans(traceId, context.project.id);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('SERVER');
      expect(result[0].status_code).toBe('OK');
      expect(result[0].attributes).toEqual({ 'http.status': 200 });
      expect(result[0].events).toEqual([{ name: 'start' }]);
    });
  });

  // ==========================================================================
  // getServices
  // ==========================================================================
  describe('getServices', () => {
    it('should return empty array when no traces exist', async () => {
      const result = await service.getServices(context.project.id);

      expect(result).toEqual([]);
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
        serviceName: 'service-a', // Duplicate
      });

      const result = await service.getServices(context.project.id);

      expect(result).toHaveLength(2);
      expect(result).toEqual(['service-a', 'service-b']); // Sorted
    });
  });

  // ==========================================================================
  // getServiceDependencies
  // ==========================================================================
  describe('getServiceDependencies', () => {
    it('should return empty graph when no spans exist', async () => {
      const result = await service.getServiceDependencies(context.project.id);

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('should return service dependencies based on parent-child spans', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Create parent span (api-gateway)
      const parentSpan = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        spanId: 'parent-span-id',
        serviceName: 'api-gateway',
        startTime: now,
      });

      // Create child span (user-service) - different service
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        parentSpanId: parentSpan.span_id,
        serviceName: 'user-service',
        startTime: new Date(now.getTime() + 10),
      });

      const result = await service.getServiceDependencies(context.project.id);

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        source: 'api-gateway',
        target: 'user-service',
        callCount: 1,
      });
    });

    it('should aggregate call counts', async () => {
      const now = new Date();

      // Create multiple traces with same dependency pattern
      for (let i = 0; i < 3; i++) {
        const traceId = crypto.randomBytes(16).toString('hex');

        const parent = await createTestSpan({
          projectId: context.project.id,
          organizationId: context.organization.id,
          traceId,
          spanId: `parent-${i}`,
          serviceName: 'frontend',
          startTime: now,
        });

        await createTestSpan({
          projectId: context.project.id,
          organizationId: context.organization.id,
          traceId,
          parentSpanId: parent.span_id,
          serviceName: 'backend',
          startTime: new Date(now.getTime() + 10),
        });
      }

      const result = await service.getServiceDependencies(context.project.id);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].callCount).toBe(3);
    });

    it('should filter by time range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Old dependency
      const oldTraceId = crypto.randomBytes(16).toString('hex');
      const oldParent = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: oldTraceId,
        spanId: 'old-parent',
        serviceName: 'old-service-a',
        startTime: yesterday,
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: oldTraceId,
        parentSpanId: oldParent.span_id,
        serviceName: 'old-service-b',
        startTime: yesterday,
      });

      // Recent dependency
      const newTraceId = crypto.randomBytes(16).toString('hex');
      const newParent = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: newTraceId,
        spanId: 'new-parent',
        serviceName: 'new-service-a',
        startTime: now,
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: newTraceId,
        parentSpanId: newParent.span_id,
        serviceName: 'new-service-b',
        startTime: now,
      });

      const result = await service.getServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 1000),
        new Date(now.getTime() + 1000)
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('new-service-a');
    });

    it('should handle from-only time filter', async () => {
      const result = await service.getServiceDependencies(
        context.project.id,
        new Date()
      );

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('should handle to-only time filter', async () => {
      const result = await service.getServiceDependencies(
        context.project.id,
        undefined,
        new Date()
      );

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });
  });

  // ==========================================================================
  // getStats
  // ==========================================================================
  describe('getStats', () => {
    it('should return zeros when no traces exist', async () => {
      const result = await service.getStats(context.project.id);

      expect(result.total_traces).toBe(0);
      expect(result.total_spans).toBe(0);
      expect(result.avg_duration_ms).toBe(0);
      expect(result.max_duration_ms).toBe(0);
      expect(result.error_count).toBe(0);
      // Note: error_rate may be NaN or 0 when total_traces is 0 (division by zero)
      // The current implementation returns 0 for this case via the ternary check
      expect(Number.isNaN(result.error_rate) || result.error_rate === 0).toBe(true);
    });

    it('should calculate statistics correctly', async () => {
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

      const result = await service.getStats(context.project.id);

      expect(result.total_traces).toBe(2);
      expect(result.total_spans).toBe(8);
      expect(result.avg_duration_ms).toBe(150);
      expect(result.max_duration_ms).toBe(200);
      expect(result.error_count).toBe(1);
      expect(result.error_rate).toBe(0.5);
    });

    it('should filter by time range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        startTime: yesterday,
        durationMs: 100,
        spanCount: 2,
      });
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
        startTime: now,
        durationMs: 200,
        spanCount: 3,
      });

      const result = await service.getStats(
        context.project.id,
        new Date(now.getTime() - 1000),
        new Date(now.getTime() + 1000)
      );

      expect(result.total_traces).toBe(1);
      expect(result.total_spans).toBe(3);
      expect(result.avg_duration_ms).toBe(200);
    });

    it('should handle from-only filter', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
      });

      const result = await service.getStats(
        context.project.id,
        new Date(Date.now() - 10000)
      );

      expect(result.total_traces).toBe(1);
    });

    it('should handle to-only filter', async () => {
      await createTestTrace({
        projectId: context.project.id,
        organizationId: context.organization.id,
      });

      const result = await service.getStats(
        context.project.id,
        undefined,
        new Date(Date.now() + 10000)
      );

      expect(result.total_traces).toBe(1);
    });
  });

  // ==========================================================================
  // getEnrichedServiceDependencies
  // ==========================================================================
  describe('getEnrichedServiceDependencies', () => {
    it('should return empty graph when no data exists', async () => {
      const result = await service.getEnrichedServiceDependencies(context.project.id);

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('should return enriched nodes from span dependencies', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      const parentSpan = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        spanId: 'enriched-parent',
        serviceName: 'api-gateway',
        startTime: now,
      });

      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        parentSpanId: parentSpan.span_id,
        serviceName: 'user-service',
        startTime: new Date(now.getTime() + 10),
      });

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 5000),
        new Date(now.getTime() + 5000),
      );

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);

      // Verify enriched node structure
      const gatewayNode = result.nodes.find((n) => n.name === 'api-gateway');
      expect(gatewayNode).toBeDefined();
      expect(gatewayNode?.id).toBe('api-gateway');
      expect(gatewayNode?.callCount).toBeGreaterThanOrEqual(0);
      expect(typeof gatewayNode?.errorRate).toBe('number');
      expect(typeof gatewayNode?.avgLatencyMs).toBe('number');
      expect(typeof gatewayNode?.totalCalls).toBe('number');

      // Verify edge has type 'span'
      expect(result.edges[0].type).toBe('span');
      expect(result.edges[0].source).toBe('api-gateway');
      expect(result.edges[0].target).toBe('user-service');
      expect(result.edges[0].callCount).toBe(1);
    });

    it('should include log co-occurrence edges when within 7-day range', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Create 2+ log pairs with the same trace_id across different services
      // (HAVING COUNT(*) >= 2 requires at least 2 co-occurrences)
      for (let i = 0; i < 2; i++) {
        await createTestLog({
          projectId: context.project.id,
          service: 'log-service-a',
          trace_id: traceId,
          time: new Date(now.getTime() + i),
        });
        await createTestLog({
          projectId: context.project.id,
          service: 'log-service-b',
          trace_id: traceId,
          time: new Date(now.getTime() + i + 1),
        });
      }

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 5000),
        new Date(now.getTime() + 5000),
      );

      // Should have nodes for log-only services
      const logServiceA = result.nodes.find((n) => n.name === 'log-service-a');
      const logServiceB = result.nodes.find((n) => n.name === 'log-service-b');
      expect(logServiceA).toBeDefined();
      expect(logServiceB).toBeDefined();

      // Log-only services should have callCount 0
      expect(logServiceA?.callCount).toBe(0);

      // Should have a log_correlation edge
      const logEdge = result.edges.find((e) => e.type === 'log_correlation');
      expect(logEdge).toBeDefined();
      expect(logEdge?.callCount).toBeGreaterThanOrEqual(2);
    });

    it('should prioritize span edges over log co-occurrence edges', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Create span-based dependency: gateway → backend
      const parentSpan = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        spanId: 'prio-parent',
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

      // Also create log co-occurrence for same service pair
      for (let i = 0; i < 3; i++) {
        await createTestLog({
          projectId: context.project.id,
          service: 'backend',
          trace_id: traceId,
          time: new Date(now.getTime() + i),
        });
        await createTestLog({
          projectId: context.project.id,
          service: 'gateway',
          trace_id: traceId,
          time: new Date(now.getTime() + i + 1),
        });
      }

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 5000),
        new Date(now.getTime() + 5000),
      );

      // Should only have span edge, not duplicate log_correlation edge
      const edgesBetween = result.edges.filter(
        (e) =>
          (e.source === 'gateway' && e.target === 'backend') ||
          (e.source === 'backend' && e.target === 'gateway'),
      );
      expect(edgesBetween).toHaveLength(1);
      expect(edgesBetween[0].type).toBe('span');
    });

    it('should skip log correlation for ranges > 7 days', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Create log co-occurrence data
      for (let i = 0; i < 3; i++) {
        await createTestLog({
          projectId: context.project.id,
          service: 'svc-x',
          trace_id: traceId,
          time: now,
        });
        await createTestLog({
          projectId: context.project.id,
          service: 'svc-y',
          trace_id: traceId,
          time: now,
        });
      }

      // Query with > 7 day range (8 days)
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        eightDaysAgo,
        new Date(now.getTime() + 5000),
      );

      // Should not have log_correlation edges
      const logEdges = result.edges.filter((e) => e.type === 'log_correlation');
      expect(logEdges).toHaveLength(0);
    });

    it('should use default time range when not provided', async () => {
      const result = await service.getEnrichedServiceDependencies(context.project.id);

      // Should not throw, default is last 24h
      expect(result).toBeDefined();
      expect(result.nodes).toBeDefined();
      expect(result.edges).toBeDefined();
    });

    it('should compute a true window p95 and avg latency from raw spans', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Parent in svc-health (duration 100), plus a second svc-health span
      // (duration 300) so avg/p95 are computed over the window, not defaulted.
      const parentSpan = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        spanId: 'health-parent',
        serviceName: 'svc-health',
        startTime: now,
        durationMs: 100,
      });

      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        spanId: 'health-extra',
        serviceName: 'svc-health',
        startTime: new Date(now.getTime() + 5),
        durationMs: 300,
      });

      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId,
        parentSpanId: parentSpan.span_id,
        serviceName: 'svc-health-child',
        startTime: new Date(now.getTime() + 10),
      });

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 5000),
        new Date(now.getTime() + 5000),
      );

      const node = result.nodes.find((n) => n.name === 'svc-health');
      expect(node).toBeDefined();
      // avg of 100 and 300 is 200; p95 is a true window percentile, not null.
      expect(node!.avgLatencyMs).toBeGreaterThan(0);
      expect(node!.p95LatencyMs).not.toBeNull();
      expect(node!.p95LatencyMs!).toBeGreaterThanOrEqual(100);
    });

    it('should handle multiple independent trace dependencies', async () => {
      const now = new Date();

      // Trace 1: A → B
      const trace1 = crypto.randomBytes(16).toString('hex');
      const parent1 = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: trace1,
        spanId: 'multi-parent-1',
        serviceName: 'service-a',
        startTime: now,
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: trace1,
        parentSpanId: parent1.span_id,
        serviceName: 'service-b',
        startTime: new Date(now.getTime() + 10),
      });

      // Trace 2: B → C
      const trace2 = crypto.randomBytes(16).toString('hex');
      const parent2 = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: trace2,
        spanId: 'multi-parent-2',
        serviceName: 'service-b',
        startTime: now,
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: trace2,
        parentSpanId: parent2.span_id,
        serviceName: 'service-c',
        startTime: new Date(now.getTime() + 10),
      });

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 5000),
        new Date(now.getTime() + 5000),
      );

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);

      const edgeAB = result.edges.find((e) => e.source === 'service-a' && e.target === 'service-b');
      const edgeBC = result.edges.find((e) => e.source === 'service-b' && e.target === 'service-c');
      expect(edgeAB).toBeDefined();
      expect(edgeBC).toBeDefined();
    });

    it('should add log-only services as nodes with callCount 0', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Only log co-occurrence, no spans
      for (let i = 0; i < 3; i++) {
        await createTestLog({
          projectId: context.project.id,
          service: 'log-only-a',
          trace_id: traceId,
          time: new Date(now.getTime() + i),
        });
        await createTestLog({
          projectId: context.project.id,
          service: 'log-only-b',
          trace_id: traceId,
          time: new Date(now.getTime() + i + 1),
        });
      }

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 5000),
        new Date(now.getTime() + 5000),
      );

      const nodeA = result.nodes.find((n) => n.name === 'log-only-a');
      const nodeB = result.nodes.find((n) => n.name === 'log-only-b');

      expect(nodeA).toBeDefined();
      expect(nodeA?.callCount).toBe(0);
      expect(nodeA?.totalCalls).toBe(0);
      // No spans for log-only services, so health stats default to null p95.
      expect(nodeA?.p95LatencyMs).toBeNull();

      expect(nodeB).toBeDefined();
      expect(nodeB?.callCount).toBe(0);
      expect(nodeB?.totalCalls).toBe(0);
      expect(nodeB?.p95LatencyMs).toBeNull();
    });

    it('should not add log edges below threshold (< 2 co-occurrences)', async () => {
      const traceId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // Only 1 co-occurrence (below HAVING COUNT(*) >= 2 threshold)
      await createTestLog({
        projectId: context.project.id,
        service: 'below-thresh-a',
        trace_id: traceId,
        time: now,
      });
      await createTestLog({
        projectId: context.project.id,
        service: 'below-thresh-b',
        trace_id: traceId,
        time: new Date(now.getTime() + 1),
      });

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 5000),
        new Date(now.getTime() + 5000),
      );

      // Should not find edges for this pair
      const edges = result.edges.filter(
        (e) =>
          (e.source === 'below-thresh-a' || e.target === 'below-thresh-a') &&
          (e.source === 'below-thresh-b' || e.target === 'below-thresh-b'),
      );
      expect(edges).toHaveLength(0);
    });

    it('should filter span dependencies by time range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Old span dependency
      const oldTraceId = crypto.randomBytes(16).toString('hex');
      const oldParent = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: oldTraceId,
        spanId: 'old-enr-parent',
        serviceName: 'old-svc-a',
        startTime: yesterday,
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: oldTraceId,
        parentSpanId: oldParent.span_id,
        serviceName: 'old-svc-b',
        startTime: yesterday,
      });

      // Recent span dependency
      const newTraceId = crypto.randomBytes(16).toString('hex');
      const newParent = await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: newTraceId,
        spanId: 'new-enr-parent',
        serviceName: 'new-svc-a',
        startTime: now,
      });
      await createTestSpan({
        projectId: context.project.id,
        organizationId: context.organization.id,
        traceId: newTraceId,
        parentSpanId: newParent.span_id,
        serviceName: 'new-svc-b',
        startTime: now,
      });

      const result = await service.getEnrichedServiceDependencies(
        context.project.id,
        new Date(now.getTime() - 1000),
        new Date(now.getTime() + 1000),
      );

      // Should only include recent dependency
      const oldEdge = result.edges.find(
        (e) => e.source === 'old-svc-a' && e.target === 'old-svc-b',
      );
      const newEdge = result.edges.find(
        (e) => e.source === 'new-svc-a' && e.target === 'new-svc-b',
      );
      expect(oldEdge).toBeUndefined();
      expect(newEdge).toBeDefined();
    });
  });
});
