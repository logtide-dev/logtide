// 1.8 metric attribute contract against a real ClickHouse server
// (groupByAttrs, filters, resource-scope labels, metric sources).
//
// Run from packages/reservoir:
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/clickhouse/clickhouse-metrics-attrs-live.test.ts
// Uses its own database (dropped and recreated per run), default
// ch_metrics18_conformance, override with RESERVOIR_CH_METRICS_DATABASE.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConformanceReservoir, isConformanceRequired, resolveSubject } from '../../conformance/index.js';
import type { Reservoir } from '../../client.js';
import type { MetricAggregateParams, MetricRecord } from '../../core/types.js';

const DATABASE = process.env.RESERVOIR_CH_METRICS_DATABASE ?? 'ch_metrics18_conformance';
const CH_URL = `http://default:@localhost:18123/${DATABASE}`;

const PA = 'proj-ch18-a';
const PB = 'proj-ch18-b';
const FROM = new Date('2026-03-01T00:00:00.000Z');
const TO = new Date('2026-03-01T01:00:00.000Z');
const at = (min: number) => new Date(FROM.getTime() + min * 60_000);

function point(
  projectId: string,
  minute: number,
  metricName: string,
  value: number,
  attributes: Record<string, unknown>,
  resourceAttributes: Record<string, unknown>,
): MetricRecord {
  return {
    time: at(minute),
    organizationId: 'org-ch18',
    projectId,
    metricName,
    metricType: 'gauge',
    value,
    serviceName: 'svc',
    attributes,
    resourceAttributes,
  };
}

const POINTS: MetricRecord[] = [
  point(PA, 1, 'system.cpu.utilization', 10, { state: 'idle', cpu: 0 }, { 'host.name': 'web-1', 'os.type': 'linux', 'service.name': 'hw' }),
  point(PA, 2, 'system.cpu.utilization', 30, { state: 'user', cpu: 1, code: 500 }, { 'host.name': 'web-1', 'os.type': 'linux' }),
  point(PB, 3, 'system.cpu.utilization', 50, { state: 'user' }, { 'host.name': 'web-2', 'os.type': 'linux' }),
  point(PB, 4, 'system.memory.usage', 100, {}, { 'host.name': 'web-2' }),
  point(PB, 5, 'app.requests', 1, {}, { 'host.name': 'web-1', 'service.name': 'api' }),
  point(PB, 6, 'app.requests', 2, {}, { 'service.name': 'api' }),
  point(PA, 7, 'custom.x', 3, {}, { 'host.name': 7, 'os.type': '' }),
  // Outside the window
  point(PA, 120, 'system.cpu.utilization', 99, {}, { 'host.name': 'web-3' }),
];

let subject: Reservoir | null = null;

beforeAll(async () => {
  subject = await resolveSubject(
    'clickhouse',
    () => createConformanceReservoir('clickhouse', { ...process.env, RESERVOIR_CLICKHOUSE_URL: CH_URL }),
    isConformanceRequired(),
  );
  if (subject) {
    const res = await subject.ingestMetrics(POINTS);
    expect(res.failed).toBe(0);
  }
}, 60_000);

afterAll(async () => {
  if (subject) await subject.close();
});

function live(name: string, fn: (r: Reservoir) => Promise<void>): void {
  it(name, async (ctx) => {
    if (!subject) return ctx.skip();
    await fn(subject);
  });
}

const cpu: MetricAggregateParams = {
  projectId: [PA, PB],
  metricName: 'system.cpu.utilization',
  metricType: 'gauge',
  from: FROM,
  to: TO,
  interval: '1h',
  aggregation: 'sum',
};

async function total(r: Reservoir, params: Partial<MetricAggregateParams>): Promise<number | null> {
  const res = await r.aggregateMetrics({ ...cpu, ...params });
  if (res.timeseries.length === 0) return null;
  return res.timeseries.reduce((s, b) => s + b.value, 0);
}

describe('clickhouse 1.8 aggregateMetrics with attributes (live)', () => {
  live('groups by a resource attribute', async (r) => {
    const res = await r.aggregateMetrics({ ...cpu, groupByAttrs: [{ scope: 'resource', key: 'host.name' }] });
    const byHost = Object.fromEntries(res.timeseries.map((b) => [b.labels?.['resource.host.name'], b.value]));
    expect(byHost).toEqual({ 'web-1': 40, 'web-2': 50 });
  });

  live('combines legacy groupBy with metric attribute refs, numbers as text', async (r) => {
    const res = await r.aggregateMetrics({ ...cpu, groupBy: ['state'], groupByAttrs: [{ scope: 'metric', key: 'cpu' }] });
    const series = res.timeseries
      .map((b) => ({ ...b.labels, value: b.value }))
      .sort((a, b) => a.value - b.value);
    expect(series).toEqual([
      { state: 'idle', cpu: '0', value: 10 },
      { state: 'user', cpu: '1', value: 30 },
      { state: 'user', cpu: '', value: 50 },
    ]);
  });

  live('eq / neq / in / nin', async (r) => {
    expect(await total(r, { filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['web-1'] }] })).toBe(40);
    expect(await total(r, { filters: [{ scope: 'metric', key: 'cpu', op: 'eq', values: ['1'] }] })).toBe(30);
    // neq / nin keep points lacking the key
    expect(await total(r, { filters: [{ scope: 'metric', key: 'cpu', op: 'neq', values: ['0'] }] })).toBe(80);
    expect(await total(r, { filters: [{ scope: 'metric', key: 'cpu', op: 'nin', values: ['0', '1'] }] })).toBe(50);
    expect(await total(r, { filters: [{ scope: 'metric', key: 'state', op: 'in', values: ['idle', 'user'] }] })).toBe(90);
    expect(await total(r, { filters: [{ scope: 'metric', key: 'state', op: 'in', values: ['nope'] }] })).toBeNull();
  });

  live('exists / notExists', async (r) => {
    expect(await total(r, { filters: [{ scope: 'metric', key: 'cpu', op: 'exists' }] })).toBe(40);
    expect(await total(r, { filters: [{ scope: 'metric', key: 'cpu', op: 'notExists' }] })).toBe(50);
    expect(await total(r, { filters: [{ scope: 'resource', key: 'service.name', op: 'exists' }] })).toBe(10);
  });

  live('gte / lt compare numerically, missing never matches', async (r) => {
    expect(await total(r, { filters: [{ scope: 'metric', key: 'code', op: 'gte', values: ['500'] }] })).toBe(30);
    expect(await total(r, { filters: [{ scope: 'metric', key: 'code', op: 'lt', values: ['500'] }] })).toBeNull();
    expect(await total(r, { filters: [{ scope: 'metric', key: 'cpu', op: 'lt', values: ['1'] }] })).toBe(10);
    expect(await total(r, { filters: [{ scope: 'metric', key: 'state', op: 'gte', values: ['0'] }] })).toBeNull();
  });

  live('ANDs several filters and groups at the same time', async (r) => {
    const res = await r.aggregateMetrics({
      ...cpu,
      filters: [
        { scope: 'resource', key: 'os.type', op: 'eq', values: ['linux'] },
        { scope: 'metric', key: 'state', op: 'eq', values: ['user'] },
      ],
      groupByAttrs: [{ scope: 'resource', key: 'host.name' }],
    });
    const byHost = Object.fromEntries(res.timeseries.map((b) => [b.labels?.['resource.host.name'], b.value]));
    expect(byHost).toEqual({ 'web-1': 30, 'web-2': 50 });
  });

  live('a 1d interval with filters reads raw rows, not the rollup', async (r) => {
    expect(await total(r, { interval: '1d', filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['web-2'] }] })).toBe(50);
  });
});

describe('clickhouse 1.8 resource labels (live)', () => {
  live('keys of every metric with an empty metric name', async (r) => {
    const res = await r.getMetricLabelKeys({ projectId: [PA, PB], metricName: '', scope: 'resource', from: FROM, to: TO });
    expect([...res.keys].sort()).toEqual(['host.name', 'os.type', 'service.name']);
  });

  live('keys of one metric', async (r) => {
    const res = await r.getMetricLabelKeys({ projectId: [PA, PB], metricName: 'app.requests', scope: 'resource', from: FROM, to: TO });
    expect([...res.keys].sort()).toEqual(['host.name', 'service.name']);
  });

  live('values of a resource key, numbers as text, window respected', async (r) => {
    const res = await r.getMetricLabelValues({ projectId: [PA, PB], metricName: '', scope: 'resource', from: FROM, to: TO }, 'host.name');
    expect([...res.values].sort()).toEqual(['7', 'web-1', 'web-2']);
  });

  live('metric scope values include numbers as text', async (r) => {
    const res = await r.getMetricLabelValues({ projectId: [PA, PB], metricName: 'system.cpu.utilization', from: FROM, to: TO }, 'cpu');
    expect([...res.values].sort()).toEqual(['0', '1']);
  });
});

describe('clickhouse 1.8 getMetricSources (live)', () => {
  live('one row per host with projects, counts and co-keys', async (r) => {
    const res = await r.getMetricSources({
      projectId: [PA, PB],
      from: FROM,
      to: TO,
      key: 'host.name',
      coKeys: ['os.type', 'service.name'],
    });
    expect(res.sources).toEqual([
      { value: '7', projectIds: [PA], lastSeen: at(7), metricCount: 1, pointCount: 1, co: { 'os.type': [], 'service.name': [] } },
      {
        value: 'web-1',
        projectIds: [PA, PB],
        lastSeen: at(5),
        metricCount: 2,
        pointCount: 3,
        co: { 'os.type': ['linux'], 'service.name': ['api', 'hw'] },
      },
      { value: 'web-2', projectIds: [PB], lastSeen: at(4), metricCount: 2, pointCount: 2, co: { 'os.type': ['linux'], 'service.name': [] } },
    ]);
  });

  live('prefix include and exclude', async (r) => {
    const res = await r.getMetricSources({
      projectId: [PA, PB],
      from: FROM,
      to: TO,
      key: 'host.name',
      includeMetricPrefixes: ['system.'],
      excludeMetricPrefixes: ['system.memory'],
    });
    expect(res.sources.map((s) => [s.value, s.pointCount, s.metricCount])).toEqual([
      ['web-1', 2, 1],
      ['web-2', 1, 1],
    ]);
    expect(res.sources[0].co).toEqual({});
  });

  live('limit, project scoping and service sources', async (r) => {
    const limited = await r.getMetricSources({ projectId: [PA, PB], from: FROM, to: TO, key: 'host.name', limit: 1 });
    expect(limited.sources.map((s) => s.value)).toEqual(['7']);

    const onlyB = await r.getMetricSources({ projectId: PB, from: FROM, to: TO, key: 'host.name' });
    expect(onlyB.sources.map((s) => s.value)).toEqual(['web-1', 'web-2']);

    const services = await r.getMetricSources({ projectId: [PA, PB], from: FROM, to: TO, key: 'service.name', coKeys: ['host.name'] });
    expect(services.sources.map((s) => [s.value, s.pointCount, s.co['host.name']])).toEqual([
      ['api', 2, ['web-1']],
      ['hw', 1, ['web-1']],
    ]);
  });
});
