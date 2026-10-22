import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { truncateAllTables, createTestTrace, createTestSpan } from '../helpers/index.js';
import { createIsolatedTenants } from './helpers.js';

describe('Tenant isolation - traces API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/traces
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/traces', () => {
    it('org B api key returns only its own traces', async () => {
      const t = await createIsolatedTenants();
      const a1Id = t.orgA.projects[0].id;
      const b1Id = t.orgB.projects[0].id;
      const b1Key = t.orgB.projects[0].apiKey.key;

      const traceA = await createTestTrace({ projectId: a1Id, serviceName: 'svc-a1' });
      const traceB = await createTestTrace({ projectId: b1Id, serviceName: 'svc-b1' });

      const res = await request(app.server)
        .get('/api/v1/traces')
        .query({ projectId: b1Id })
        .set('x-api-key', b1Key)
        .expect(200);

      const ids: string[] = res.body.traces.map((t: any) => t.trace_id);
      expect(ids).toContain(traceB.trace_id);
      expect(ids).not.toContain(traceA.trace_id);
    });

    it('api key for A1 cannot read A2 traces (same org, different project)', async () => {
      const t = await createIsolatedTenants();
      const a1Id = t.orgA.projects[0].id;
      const a2Id = t.orgA.projects[1].id;
      const a1Key = t.orgA.projects[0].apiKey.key;

      const traceA2 = await createTestTrace({ projectId: a2Id, serviceName: 'svc-a2' });

      const res = await request(app.server)
        .get('/api/v1/traces')
        .query({ projectId: a2Id })
        .set('x-api-key', a1Key);

      if (res.status === 200) {
        const ids: string[] = res.body.traces.map((t: any) => t.trace_id);
        expect(ids).not.toContain(traceA2.trace_id);
      } else {
        expect([401, 403]).toContain(res.status);
      }
    });

    it('api key for org B cannot read org A traces', async () => {
      const t = await createIsolatedTenants();
      const a1Id = t.orgA.projects[0].id;
      const b1Key = t.orgB.projects[0].apiKey.key;

      const traceA = await createTestTrace({ projectId: a1Id, serviceName: 'svc-a1' });

      const res = await request(app.server)
        .get('/api/v1/traces')
        .query({ projectId: a1Id })
        .set('x-api-key', b1Key);

      if (res.status === 200) {
        const ids: string[] = res.body.traces.map((t: any) => t.trace_id);
        expect(ids).not.toContain(traceA.trace_id);
      } else {
        expect([401, 403]).toContain(res.status);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/traces/:traceId
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/traces/:traceId', () => {
    it('api key for A1 cannot fetch a specific trace from B1', async () => {
      const t = await createIsolatedTenants();
      const a1Key = t.orgA.projects[0].apiKey.key;
      const b1Id = t.orgB.projects[0].id;

      const traceB = await createTestTrace({ projectId: b1Id, serviceName: 'svc-b1' });

      const res = await request(app.server)
        .get(`/api/v1/traces/${traceB.trace_id}`)
        .query({ projectId: b1Id })
        .set('x-api-key', a1Key);

      // Must not return the trace
      if (res.status === 200) {
        // If the route somehow returned 200, the trace body must not belong to b1
        expect(res.body.trace_id).not.toBe(traceB.trace_id);
      } else {
        expect([401, 403, 404]).toContain(res.status);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/traces/:traceId/spans
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/traces/:traceId/spans', () => {
    it('api key for A1 cannot read spans from a B1 trace', async () => {
      const t = await createIsolatedTenants();
      const a1Key = t.orgA.projects[0].apiKey.key;
      const b1Id = t.orgB.projects[0].id;

      const traceB = await createTestTrace({ projectId: b1Id, serviceName: 'svc-b1' });
      const spanB = await createTestSpan({
        projectId: b1Id,
        traceId: traceB.trace_id,
        serviceName: 'svc-b1',
      });

      const res = await request(app.server)
        .get(`/api/v1/traces/${traceB.trace_id}/spans`)
        .query({ projectId: b1Id })
        .set('x-api-key', a1Key);

      if (res.status === 200) {
        const spanIds: string[] = (res.body.spans ?? []).map((s: any) => s.span_id);
        expect(spanIds).not.toContain(spanB.span_id);
      } else {
        expect([401, 403, 404]).toContain(res.status);
      }
    });

    it('api key for B1 can read its own spans', async () => {
      const t = await createIsolatedTenants();
      const b1Key = t.orgB.projects[0].apiKey.key;
      const b1Id = t.orgB.projects[0].id;

      const traceB = await createTestTrace({ projectId: b1Id, serviceName: 'svc-b1' });
      const spanB = await createTestSpan({
        projectId: b1Id,
        traceId: traceB.trace_id,
        serviceName: 'svc-b1',
      });

      const res = await request(app.server)
        .get(`/api/v1/traces/${traceB.trace_id}/spans`)
        .query({ projectId: b1Id })
        .set('x-api-key', b1Key)
        .expect(200);

      const spanIds: string[] = (res.body.spans ?? []).map((s: any) => s.span_id);
      expect(spanIds).toContain(spanB.span_id);
    });
  });
});

// ----------------------------------------------------------------------------
// W4: operations and latency histogram
// ----------------------------------------------------------------------------
describe('Tenant isolation - traces APM API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  describe('GET /api/v1/traces/operations', () => {
    it('org B api key cannot read org A operations', async () => {
      const t = await createIsolatedTenants();
      const a1Id = t.orgA.projects[0].id;
      const b1Key = t.orgB.projects[0].apiKey.key;

      await createTestSpan({ projectId: a1Id, serviceName: 'svc-a1', operationName: 'secret-op', kind: 'SERVER' });

      const res = await request(app.server)
        .get('/api/v1/traces/operations')
        .query({ projectId: a1Id })
        .set('x-api-key', b1Key)
        .expect(403);

      expect(JSON.stringify(res.body)).not.toContain('secret-op');
    });

    it('org B api key only sees its own operations', async () => {
      const t = await createIsolatedTenants();
      const a1Id = t.orgA.projects[0].id;
      const b1Id = t.orgB.projects[0].id;
      const b1Key = t.orgB.projects[0].apiKey.key;

      await createTestSpan({ projectId: a1Id, serviceName: 'svc-a1', operationName: 'op-a', kind: 'SERVER' });
      await createTestSpan({ projectId: b1Id, serviceName: 'svc-b1', operationName: 'op-b', kind: 'SERVER' });

      const res = await request(app.server)
        .get('/api/v1/traces/operations')
        .set('x-api-key', b1Key)
        .expect(200);

      const ops: string[] = res.body.operations.map((o: any) => o.operation);
      expect(ops).toContain('op-b');
      expect(ops).not.toContain('op-a');
    });
  });

  describe('GET /api/v1/traces/latency-histogram', () => {
    it('org B api key cannot read org A latency histogram', async () => {
      const t = await createIsolatedTenants();
      const a1Id = t.orgA.projects[0].id;
      const b1Key = t.orgB.projects[0].apiKey.key;

      await createTestSpan({ projectId: a1Id, serviceName: 'svc-a1', kind: 'SERVER' });

      await request(app.server)
        .get('/api/v1/traces/latency-histogram')
        .query({ projectId: a1Id })
        .set('x-api-key', b1Key)
        .expect(403);
    });
  });
});
