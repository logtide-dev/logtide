import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../database/index.js';
import { reservoir, reservoirReady } from '../../database/reservoir.js';
import { config } from '../../config/index.js';
import { build } from '../../server.js';
import { capabilities, quotaFlagCache } from '../../capabilities/index.js';
import {
  CAPABILITIES,
  applyDefaultOverrides,
  quotaSignals,
  resetDefaultOverrides,
} from '../../capabilities/registry.js';
import { QuotaEvaluator } from '../../capabilities/quota-evaluator.js';
import { formatQuotaValue } from '../../capabilities/quota-notifier.js';
import { meteringRecorder, meteringService } from '../../modules/metering/index.js';
import { getCapabilityUsage } from '../../modules/metering/capability-usage.js';
import { piiMaskingService } from '../../modules/pii-masking/service.js';
import type { MeteringEventType } from '../../modules/metering/types.js';
import { createTestSession } from '../helpers/auth.js';
import { createTestApiKey, createTestContext, createTestUser } from '../helpers/factories.js';

const CAP = 'telemetry.max_bytes_monthly';
const cfg = config as { LOGTIDE_UPGRADE_URL?: string; LOGTIDE_UPGRADE_SIGNING_SECRET?: string };
const nowNs = () => String(Date.now() * 1_000_000);

// Bytes cover customer-provided data only: the server-injected tenant ids and the
// span 'time' copy of startTime are excluded from the measured projection.
const customerSpanBytes = (stored: any[]) =>
  Buffer.byteLength(JSON.stringify(stored.map(({ organizationId, projectId, time, ...rest }) => rest)));
const customerMetricBytes = (stored: any[]) =>
  Buffer.byteLength(JSON.stringify(stored.map(({ organizationId, projectId, ...rest }) => rest)));

function tracesBody(spanIds: string[]) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
        scopeSpans: [
          {
            spans: spanIds.map((id) => ({
              traceId: '0000000000000000000000000000' + id.padStart(4, '0'),
              spanId: id.padStart(16, '0'),
              name: 'op-' + id,
              kind: 1,
              startTimeUnixNano: nowNs(),
              endTimeUnixNano: nowNs(),
            })),
          },
        ],
      },
    ],
  };
}

function metricsBody(names: string[]) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
        scopeMetrics: [
          {
            metrics: names.map((name) => ({
              name,
              gauge: { dataPoints: [{ timeUnixNano: nowNs(), asDouble: 1 }] },
            })),
          },
        ],
      },
    ],
  };
}

function otlpLogsBody() {
  return {
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
        scopeLogs: [{ logRecords: [{ timeUnixNano: nowNs(), severityNumber: 9, body: { stringValue: 'x' } }] }],
      },
    ],
  };
}

async function meteredSum(orgId: string, type: MeteringEventType): Promise<{ rows: number; total: number }> {
  await meteringRecorder.flush();
  const rows = await db
    .selectFrom('metering_events')
    .select('quantity')
    .where('organization_id', '=', orgId)
    .where('type', '=', type)
    .execute();
  return { rows: rows.length, total: rows.reduce((a, r) => a + Number(r.quantity), 0) };
}

async function setLimit(orgId: string, capability: string, limit: number | null) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: orgId, capability, enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(orgId);
}

describe('telemetry.max_bytes_monthly registry entry', () => {
  afterEach(() => resetDefaultOverrides());

  it('is a null-default monthly quota over logs, spans and metrics bytes', () => {
    const def = CAPABILITIES[CAP];
    expect(def.kind).toBe('quota');
    expect(def.defaultLimit).toBeNull();
    expect(def.window).toBe('calendar_month');
    expect(def.description).toBe('Monthly ingested bytes across logs, traces and metrics combined');
    expect([...quotaSignals(def)].sort()).toEqual(
      ['logs.ingested.bytes', 'metrics.ingested.bytes', 'spans.ingested.bytes'].sort()
    );
  });

  it('single-signal quotas still resolve to their one signal', () => {
    expect(quotaSignals(CAPABILITIES['ingestion.max_bytes_monthly'])).toEqual(['logs.ingested.bytes']);
    expect(quotaSignals(CAPABILITIES['storage.max_bytes'])).toEqual(['storage.snapshot']);
  });

  it('CAPABILITY_DEFAULTS_JSON accepts the key', () => {
    applyDefaultOverrides(JSON.stringify({ [CAP]: 10 * 1024 ** 3 }));
    expect(CAPABILITIES[CAP].defaultLimit).toBe(10 * 1024 ** 3);
  });

  it('formats notifications in bytes', () => {
    expect(formatQuotaValue(CAP, 1536 * 1024)).toBe('1.5 MB');
    expect(formatQuotaValue(CAP, 10 * 1024 ** 3)).toBe('10 GB');
  });
});

describe('telemetry quota evaluation (sum of three signals)', () => {
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});
    quotaFlagCache.clear();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    capabilities.invalidate(orgId);

    const rec = (type: MeteringEventType, quantity: number) =>
      meteringRecorder.record({ type, quantity, organizationId: orgId, projectId });
    rec('logs.ingested.bytes', 100);
    rec('spans.ingested.bytes', 200);
    rec('metrics.ingested.bytes', 300);
    // Not part of the combined quota.
    rec('logs.ingested.events', 100_000);
    rec('spans.ingested', 100_000);
    rec('metrics.ingested.datapoints', 100_000);
    await meteringRecorder.flush();
  });

  it('blocks at the summed usage and not below it', async () => {
    const ev = new QuotaEvaluator(meteringService);
    await setLimit(orgId, CAP, 601);
    await ev.runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(false);

    await db.deleteFrom('organization_entitlements').where('organization_id', '=', orgId).execute();
    await setLimit(orgId, CAP, 600);
    await ev.runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(true);
  });

  it('null limit is unlimited', async () => {
    await setLimit(orgId, CAP, null);
    await new QuotaEvaluator(meteringService).runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(false);
  });

  it('grace applies and the notification formats bytes', async () => {
    await setLimit(orgId, CAP, 590);
    await setLimit(orgId, 'quota.grace_percent', 10);
    await new QuotaEvaluator(meteringService).runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(false);

    const rows = await db
      .selectFrom('notifications')
      .selectAll()
      .where('organization_id', '=', orgId)
      .execute();
    const mine = rows.filter((r) => (r.metadata as any)?.capability === CAP);
    expect(mine.length).toBeGreaterThan(0);
    expect((mine[0].metadata as any).state).toBe('grace');
    expect((mine[0].metadata as any).usage).toBe(600);
    expect(mine[0].message).toContain('600 B used of 590 B');
  });

  it('the usage API reports the combined total', async () => {
    await setLimit(orgId, CAP, 1000);
    const usage = await getCapabilityUsage(orgId);
    const row = usage.find((u) => u.capability === CAP);
    expect(row).toMatchObject({ kind: 'quota', current: 600, limit: 1000, state: 'ok' });
    // The existing single-signal quota is untouched.
    const bytes = usage.find((u) => u.capability === 'ingestion.max_bytes_monthly');
    expect(bytes?.current).toBe(100);
  });
});

describe('telemetry quota on the real app', () => {
  let app: FastifyInstance;
  let orgId: string;
  let apiKey: string;

  beforeAll(async () => {
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    quotaFlagCache.clear();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    apiKey = (await createTestApiKey({ projectId: ctx.project.id })).plainKey;
    capabilities.invalidate(orgId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete cfg.LOGTIDE_UPGRADE_URL;
    delete cfg.LOGTIDE_UPGRADE_SIGNING_SECRET;
  });

  const post = (url: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });

  const restLogs = () =>
    post('/api/v1/ingest', {
      logs: [{ time: new Date().toISOString(), service: 'api', level: 'info', message: 'x' }],
    });

  describe('metering bytes', () => {
    it('records spans.ingested.bytes as the JSON size of the customer-provided span fields', async () => {
      const spy = vi.spyOn(reservoir, 'ingestSpans');
      const res = await post('/v1/otlp/traces', tracesBody(['1', '2']));
      expect(res.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      const stored = spy.mock.calls[0][0];
      expect(stored).toHaveLength(2);
      expect(stored[0]).toHaveProperty('organizationId', orgId);
      expect(stored[0]).toHaveProperty('time');
      const m = await meteredSum(orgId, 'spans.ingested.bytes');
      expect(m.total).toBeLessThan(Buffer.byteLength(JSON.stringify(stored)));
      expect(m.rows).toBe(1);
      expect(m.total).toBe(customerSpanBytes(stored));
    });

    it('does not count spans dropped by PII masking', async () => {
      vi.spyOn(piiMaskingService, 'maskSpanBatch').mockResolvedValueOnce([0]);
      const spy = vi.spyOn(reservoir, 'ingestSpans');
      const res = await post('/v1/otlp/traces', tracesBody(['3', '4']));
      expect(res.statusCode).toBe(200);
      const stored = spy.mock.calls[0][0];
      expect(stored).toHaveLength(1);
      const m = await meteredSum(orgId, 'spans.ingested.bytes');
      expect(m.total).toBe(customerSpanBytes(stored));
    });

    it('records metrics.ingested.bytes as the JSON size of the customer-provided datapoint fields', async () => {
      const spy = vi.spyOn(reservoir, 'ingestMetrics');
      const res = await post('/v1/otlp/metrics', metricsBody(['a', 'b']));
      expect(res.statusCode).toBe(200);
      const stored = spy.mock.calls[0][0];
      expect(stored).toHaveLength(2);
      expect(stored[0]).toHaveProperty('organizationId', orgId);
      const m = await meteredSum(orgId, 'metrics.ingested.bytes');
      expect(m.total).toBeLessThan(Buffer.byteLength(JSON.stringify(stored)));
      expect(m.rows).toBe(1);
      expect(m.total).toBe(customerMetricBytes(stored));
    });

    it('does not count datapoints the store rejected', async () => {
      vi.spyOn(reservoir, 'ingestMetrics').mockResolvedValueOnce({ ingested: 0, failed: 1, durationMs: 0 });
      await post('/v1/otlp/metrics', metricsBody(['c']));
      expect((await meteredSum(orgId, 'metrics.ingested.bytes')).rows).toBe(0);
    });
  });

  describe('enforcement', () => {
    it('over the combined limit: 429 on REST logs, OTLP logs, traces and metrics', async () => {
      await setLimit(orgId, CAP, 1);
      quotaFlagCache.setOrgFlags(orgId, { [CAP]: true });

      const rest = await restLogs();
      expect(rest.statusCode).toBe(429);

      const otlpLogs = await post('/v1/otlp/logs', otlpLogsBody());
      expect(otlpLogs.statusCode).toBe(429);

      const traces = await post('/v1/otlp/traces', tracesBody(['5']));
      expect(traces.statusCode).toBe(429);
      expect(traces.json().partialSuccess.rejectedSpans).toBe(-1);

      const metrics = await post('/v1/otlp/metrics', metricsBody(['d']));
      expect(metrics.statusCode).toBe(429);
      expect(metrics.json().partialSuccess.rejectedDataPoints).toBe(-1);

      // Nothing was stored or metered.
      expect((await meteredSum(orgId, 'spans.ingested.bytes')).rows).toBe(0);
      expect((await meteredSum(orgId, 'metrics.ingested.bytes')).rows).toBe(0);
      expect((await meteredSum(orgId, 'logs.ingested.bytes')).rows).toBe(0);
    });

    it('429 carries upgrade_available when the handoff is active', async () => {
      cfg.LOGTIDE_UPGRADE_URL = 'https://billing.example.com/portal';
      cfg.LOGTIDE_UPGRADE_SIGNING_SECRET = 'u'.repeat(40);
      await setLimit(orgId, CAP, 1);
      quotaFlagCache.setOrgFlags(orgId, { [CAP]: true });

      for (const res of [
        await restLogs(),
        await post('/v1/otlp/traces', tracesBody(['6'])),
        await post('/v1/otlp/metrics', metricsBody(['e'])),
      ]) {
        expect(res.statusCode).toBe(429);
        expect(res.json().upgrade_available).toBe(true);
      }
    });

    it('under the limit: everything is accepted', async () => {
      await setLimit(orgId, CAP, 10 * 1024 ** 3);
      quotaFlagCache.setOrgFlags(orgId, { [CAP]: false });
      expect((await restLogs()).statusCode).toBeLessThan(300);
      expect((await post('/v1/otlp/logs', otlpLogsBody())).statusCode).toBe(200);
      expect((await post('/v1/otlp/traces', tracesBody(['7']))).statusCode).toBe(200);
      expect((await post('/v1/otlp/metrics', metricsBody(['f']))).statusCode).toBe(200);
    });

    it('null limit is unlimited even with a stale flag', async () => {
      quotaFlagCache.setOrgFlags(orgId, { [CAP]: true });
      expect((await restLogs()).statusCode).toBeLessThan(300);
      expect((await post('/v1/otlp/traces', tracesBody(['8']))).statusCode).toBe(200);
      expect((await post('/v1/otlp/metrics', metricsBody(['g']))).statusCode).toBe(200);
    });

    it('end to end: real metering + evaluator blocks the next batch', async () => {
      await setLimit(orgId, CAP, 1);
      expect((await post('/v1/otlp/metrics', metricsBody(['h']))).statusCode).toBe(200);
      await meteringRecorder.flush();
      await new QuotaEvaluator(meteringService).runOnce();
      expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(true);
      expect((await post('/v1/otlp/traces', tracesBody(['9']))).statusCode).toBe(429);
      expect((await restLogs()).statusCode).toBe(429);
    });
  });

  describe('admin entitlements PUT', () => {
    it('accepts the new key (registry-driven)', async () => {
      const admin = await createTestUser({ email: `admin-${Date.now()}-${Math.random()}@example.com` });
      await db.updateTable('users').set({ is_admin: true }).where('id', '=', admin.id).execute();
      const session = await createTestSession(admin.id);
      const tenGiB = 10 * 1024 ** 3;
      const put = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${orgId}/entitlements`,
        headers: { authorization: `Bearer ${session.token}` },
        payload: { entitlements: [{ capability: CAP, limitValue: tenGiB }] },
      });
      expect(put.statusCode).toBe(200);
      expect(await capabilities.getLimit(orgId, CAP)).toBe(tenGiB);
    });
  });
});
