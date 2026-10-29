// Engine smoke for the 1.6 reading paths that are not covered by log-search-api
// and log-explorer-api: traces (list with operation filter, operation stats,
// latency histogram), sessions, alert rule evaluation with a query, and the
// error group log lookup. Everything is seeded through the reservoir, so it
// runs unchanged on TimescaleDB, ClickHouse and MongoDB. Set
// SMOKE_EXPECT_ENGINE=<engine> to assert which engine actually served the run.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { db } from '../../database/index.js';
import { reservoir, reservoirReady } from '../../database/reservoir.js';
import { createTestContext, createTestAlertRule } from '../helpers/factories.js';
import { createTestSession } from '../helpers/auth.js';
import { seedLogs } from '../modules/query/seed.js';
import { alertsService } from '../../modules/alerts/service.js';
import { ExceptionService } from '../../modules/exceptions/service.js';

const MINUTE = 60 * 1000;

describe('engine smoke', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let bearer: string;
  let projectId: string;
  let organizationId: string;

  beforeAll(async () => {
    await reservoirReady;
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
    organizationId = ctx.organization.id;
    const session = await createTestSession(ctx.user.id);
    bearer = `Bearer ${session.token}`;
  });

  it('runs on the expected engine', () => {
    const expected = process.env.SMOKE_EXPECT_ENGINE;
    if (expected) {
      expect(process.env.STORAGE_ENGINE).toBe(expected);
      expect(reservoir.getEngineType()).toBe(expected);
    }
    expect(['timescale', 'clickhouse', 'mongodb']).toContain(reservoir.getEngineType());
  });

  describe('traces', () => {
    async function seedTrace(over: { service?: string; operation: string; durationMs: number; error?: boolean }) {
      const traceId = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      const spanId = traceId.slice(0, 16);
      const start = new Date(Date.now() - 2 * MINUTE);
      const end = new Date(start.getTime() + over.durationMs);
      const service = over.service ?? 'api';
      await reservoir.ingestSpans([
        {
          time: start,
          spanId,
          traceId,
          organizationId,
          projectId,
          serviceName: service,
          operationName: over.operation,
          startTime: start,
          endTime: end,
          durationMs: over.durationMs,
          kind: 'SERVER',
          statusCode: over.error ? 'ERROR' : 'OK',
        },
      ]);
      await reservoir.upsertTrace({
        traceId,
        organizationId,
        projectId,
        serviceName: service,
        rootServiceName: service,
        rootOperationName: over.operation,
        startTime: start,
        endTime: end,
        durationMs: over.durationMs,
        spanCount: 1,
        error: !!over.error,
      });
      return traceId;
    }

    it('lists traces, filters by operation, and reports operation stats and latency', async () => {
      const fast = await seedTrace({ operation: 'GET /fast', durationMs: 20 });
      const slow = await seedTrace({ operation: 'GET /slow', durationMs: 900, error: true });
      await seedTrace({ operation: 'GET /slow', durationMs: 700 });
      await seedTrace({ service: 'worker', operation: 'job', durationMs: 50 });

      const all = await request(app.server).get('/api/v1/traces').set('x-api-key', apiKey);
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(4);

      const op = await request(app.server).get('/api/v1/traces').query({ operation: 'GET /slow' }).set('x-api-key', apiKey);
      expect(op.status).toBe(200);
      expect(op.body.total).toBe(2);
      expect(op.body.traces.map((t: any) => t.root_operation_name)).toEqual(['GET /slow', 'GET /slow']);
      expect(op.body.traces.map((t: any) => t.trace_id)).toContain(slow);
      expect(op.body.traces.map((t: any) => t.trace_id)).not.toContain(fast);

      const ops = await request(app.server).get('/api/v1/traces/operations').set('x-api-key', apiKey);
      expect(ops.status).toBe(200);
      const byOp = new Map<string, any>(ops.body.operations.map((o: any) => [o.operation, o]));
      expect(byOp.get('GET /slow')!.count).toBe(2);
      expect(byOp.get('GET /slow')!.errorCount).toBe(1);
      expect(byOp.get('GET /slow')!.errorRate).toBeCloseTo(0.5, 5);
      expect(byOp.get('GET /fast')!.count).toBe(1);
      expect(byOp.get('GET /fast')!.errorRate).toBe(0);
      expect(byOp.get('GET /slow')!.p95Ms).toBeGreaterThan(byOp.get('GET /fast')!.p95Ms);

      const lat = await request(app.server).get('/api/v1/traces/latency-histogram').set('x-api-key', apiKey);
      expect(lat.status).toBe(200);
      expect(lat.body.counts).toHaveLength(lat.body.bounds.length + 1);
      expect(lat.body.counts.reduce((a: number, b: number) => a + b, 0)).toBe(4);

      const latOp = await request(app.server)
        .get('/api/v1/traces/latency-histogram')
        .query({ operation: 'GET /fast' })
        .set('x-api-key', apiKey);
      expect(latOp.status).toBe(200);
      expect(latOp.body.counts.reduce((a: number, b: number) => a + b, 0)).toBe(1);

      const stats = await request(app.server).get('/api/v1/traces/stats').set('x-api-key', apiKey);
      expect(stats.status).toBe(200);
      expect(stats.body.total_traces).toBe(4);
    });
  });

  describe('sessions', () => {
    it('lists sessions with event and error counts and returns their events', async () => {
      const t = Date.now() - 10 * MINUTE;
      await seedLogs(projectId, [
        { message: 'page view', service: 'web', level: 'info', sessionId: 'sess-a', time: new Date(t) },
        { message: 'click', service: 'web', level: 'info', sessionId: 'sess-a', time: new Date(t + 1000) },
        { message: 'boom', service: 'web', level: 'error', sessionId: 'sess-a', time: new Date(t + 2000) },
        { message: 'page view', service: 'web', level: 'info', sessionId: 'sess-b', time: new Date(t + 3000) },
        { message: 'no session', service: 'web', level: 'info', time: new Date(t + 4000) },
      ]);

      const list = await request(app.server).get('/api/v1/sessions').query({ projectId }).set('Authorization', bearer);
      expect(list.status).toBe(200);
      const sessions = list.body.sessions as any[];
      expect(sessions.map((s) => s.sessionId).sort()).toEqual(['sess-a', 'sess-b']);
      const a = sessions.find((s) => s.sessionId === 'sess-a');
      expect(a.eventCount).toBe(3);
      expect(a.errorCount).toBe(1);
      expect(a.durationMs).toBe(2000);

      const errs = await request(app.server)
        .get('/api/v1/sessions')
        .query({ projectId, hasErrors: 'true' })
        .set('Authorization', bearer);
      expect(errs.status).toBe(200);
      expect(errs.body.sessions.map((s: any) => s.sessionId)).toEqual(['sess-a']);

      const events = await request(app.server)
        .get('/api/v1/sessions/sess-a/events')
        .query({ projectId })
        .set('Authorization', bearer);
      expect(events.status).toBe(200);
      expect(events.body.events.map((e: any) => e.message)).toEqual(['page view', 'click', 'boom']);
    });
  });

  describe('alerts with a query', () => {
    beforeEach(async () => {
      await db.deleteFrom('alert_history').execute();
      await db.deleteFrom('alert_rules').execute();
    });

    async function rule(query: string, threshold: number) {
      const r = await createTestAlertRule({
        organizationId,
        projectId,
        name: 'smoke rule',
        threshold,
        timeWindow: 5,
        level: ['error', 'critical'],
      });
      await db
        .updateTable('alert_rules')
        .set({ query })
        .where('id', '=', r.id)
        .where('organization_id', '=', organizationId)
        .execute();
      return r;
    }

    async function seedAlertLogs() {
      const now = Date.now();
      await seedLogs(projectId, [
        { message: 'db timeout one', level: 'error', metadata: { region: 'eu' }, time: new Date(now - 30_000) },
        { message: 'db timeout two', level: 'critical', metadata: { region: 'eu' }, time: new Date(now - 20_000) },
        { message: 'db timeout three', level: 'error', metadata: { region: 'us' }, time: new Date(now - 10_000) },
        { message: 'health check timeout', level: 'error', metadata: { region: 'eu' }, time: new Date(now - 5_000) },
        { message: 'unrelated', level: 'error', metadata: { region: 'eu' }, time: new Date(now - 5_000) },
        { message: 'db timeout info', level: 'info', metadata: { region: 'eu' }, time: new Date(now - 5_000) },
      ]);
    }

    it('fires when words, a negated phrase, an OR group and a metadata clause meet the threshold', async () => {
      await seedAlertLogs();
      await rule('timeout -"health check" region:(eu OR us)', 3);
      const triggered = await alertsService.checkAlertRules();
      expect(triggered).toHaveLength(1);
      expect(triggered[0].log_count).toBe(3);
    });

    it('counts only the clauses that match and stays quiet below the threshold', async () => {
      await seedAlertLogs();
      await rule('timeout region:eu -"health check"', 3);
      const triggered = await alertsService.checkAlertRules();
      expect(triggered).toHaveLength(0);
    });

    it('evaluates an OR of a word and a phrase', async () => {
      await seedAlertLogs();
      await rule('unrelated OR "db timeout one"', 2);
      const triggered = await alertsService.checkAlertRules();
      expect(triggered).toHaveLength(1);
      expect(triggered[0].log_count).toBe(2);
    });

    it('supports metadata exists and not exists clauses', async () => {
      await seedAlertLogs();
      await rule('timeout region:* -region:us', 3);
      const triggered = await alertsService.checkAlertRules();
      expect(triggered).toHaveLength(1);
      expect(triggered[0].log_count).toBe(3);
    });
  });

  describe('error groups', () => {
    it('reads the logs of a group back from the engine', async () => {
      const service = new ExceptionService(db);
      const logs = await seedLogs(projectId, [
        { message: 'TypeError: x is undefined', level: 'error', time: new Date(Date.now() - 2 * MINUTE) },
        { message: 'TypeError: x is undefined again', level: 'error', time: new Date(Date.now() - 1 * MINUTE) },
      ]);
      for (const log of logs) {
        await service.createException({
          organizationId,
          projectId,
          logId: log.id,
          fingerprint: 'smoke-fp',
          parsedData: {
            exceptionType: 'TypeError',
            exceptionMessage: 'x is undefined',
            language: 'nodejs',
            rawStackTrace: '',
            frames: [],
          },
        });
      }
      const result = await service.getLogsForErrorGroup({
        groupId: 'any',
        fingerprint: 'smoke-fp',
        organizationId,
        projectId,
        firstSeen: new Date(0),
        lastSeen: new Date(),
        occurrenceCount: 2,
      });
      expect(result.total).toBe(2);
      expect(result.logs.map((l) => l.id).sort()).toEqual(logs.map((l) => l.id).sort());
    });
  });
});
