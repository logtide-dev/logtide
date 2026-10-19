import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { reservoirReady } from '../../../database/reservoir.js';
import { config } from '../../../config/index.js';
import { build } from '../../../server.js';
import { capabilities, quotaFlagCache } from '../../../capabilities/index.js';
import { createTestApiKey, createTestContext } from '../../helpers/factories.js';

const cfg = config as { LOGTIDE_UPGRADE_URL?: string; LOGTIDE_UPGRADE_SIGNING_SECRET?: string };
const nowNs = () => String(Date.now() * 1_000_000);

const bodies: Record<string, { url: string; payload: unknown; rejectedKey: string; cap: string }> = {
  logs: {
    url: '/v1/otlp/logs',
    cap: 'ingestion.max_events_monthly',
    rejectedKey: 'rejectedLogRecords',
    payload: {
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
          scopeLogs: [{ logRecords: [{ timeUnixNano: nowNs(), severityNumber: 9, body: { stringValue: 'x' } }] }],
        },
      ],
    },
  },
  traces: {
    url: '/v1/otlp/traces',
    cap: 'tracing.max_spans_monthly',
    rejectedKey: 'rejectedSpans',
    payload: {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: '00000000000000000000000000000001',
                  spanId: '0000000000000001',
                  name: 'op',
                  kind: 1,
                  startTimeUnixNano: nowNs(),
                  endTimeUnixNano: nowNs(),
                },
              ],
            },
          ],
        },
      ],
    },
  },
  metrics: {
    url: '/v1/otlp/metrics',
    cap: 'metrics.max_datapoints_monthly',
    rejectedKey: 'rejectedDataPoints',
    payload: {
      resourceMetrics: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
          scopeMetrics: [{ metrics: [{ name: 'm', gauge: { dataPoints: [{ timeUnixNano: nowNs(), asDouble: 1 }] } }] }],
        },
      ],
    },
  },
};

describe('OTLP 429 bodies and the upgrade hint', () => {
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
    for (const { cap } of Object.values(bodies)) {
      await db
        .insertInto('organization_entitlements')
        .values({ organization_id: orgId, capability: cap, enabled: null, limit_value: 1 })
        .execute();
    }
    capabilities.invalidate(orgId);
    quotaFlagCache.setOrgFlags(orgId, Object.fromEntries(Object.values(bodies).map((b) => [b.cap, true])));
  });

  afterEach(() => {
    delete cfg.LOGTIDE_UPGRADE_URL;
    delete cfg.LOGTIDE_UPGRADE_SIGNING_SECRET;
  });

  const post = (b: (typeof bodies)[string]) =>
    app.inject({
      method: 'POST',
      url: b.url,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: JSON.stringify(b.payload),
    });

  for (const [signal, b] of Object.entries(bodies)) {
    it(`${signal}: no upgrade_available when the handoff is inactive`, async () => {
      const res = await post(b);
      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.partialSuccess[b.rejectedKey]).toBe(-1);
      expect(body).not.toHaveProperty('upgrade_available');
    });

    it(`${signal}: upgrade_available: true when the handoff is active`, async () => {
      cfg.LOGTIDE_UPGRADE_URL = 'https://billing.example.com/portal';
      cfg.LOGTIDE_UPGRADE_SIGNING_SECRET = 'u'.repeat(40);
      const res = await post(b);
      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.partialSuccess[b.rejectedKey]).toBe(-1);
      expect(body.upgrade_available).toBe(true);
    });
  }
});
