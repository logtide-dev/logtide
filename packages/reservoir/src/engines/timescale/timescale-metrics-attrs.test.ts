// ============================================================================
// TimescaleDB metric attributes and sources (1.8), real database
// ============================================================================
// groupByAttrs, filters, resource-scope label discovery and getMetricSources
// against a real TimescaleDB. Own schema `reservoir_ts_metric_attrs`.
//
// Database: ux16_rts on localhost:5433 unless RESERVOIR_TIMESCALE_URL says
// otherwise.
//
//   cd packages/reservoir
//   RESERVOIR_CONFORMANCE_REQUIRED=1 npx vitest run src/engines/timescale/timescale-metrics-attrs.test.ts
//
// Without RESERVOIR_CONFORMANCE_REQUIRED=1 an unreachable server skips.

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  isConformanceRequired,
  probeConformanceTarget,
  resolveConformanceTarget,
  resolveSubject,
} from '../../conformance/index.js';
import type { MetricAggregateParams, MetricAttrFilter, MetricRecord } from '../../core/types.js';
import { TimescaleEngine } from './timescale-engine.js';

const DEFAULT_URL = 'postgresql://logtide_test:test_password@localhost:5433/ux16_rts';
const SCHEMA = 'reservoir_ts_metric_attrs';
const ORG = '00000000-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const P3 = '00000000-0000-4000-8000-0000000000a3';
const BASE = Date.UTC(2026, 0, 7, 10, 0, 0);
const WINDOW = { from: new Date(BASE - 60_000), to: new Date(BASE + 3_600_000) };

function point(
  minute: number,
  overrides: Partial<MetricRecord> & Pick<MetricRecord, 'metricName' | 'value'>,
): MetricRecord {
  return {
    time: new Date(BASE + minute * 60_000),
    organizationId: ORG,
    projectId: P1,
    metricType: 'gauge',
    serviceName: 'svc',
    ...overrides,
  };
}

/**
 * cpu points: three hosts, metric attribute `status` mixes numbers, strings
 * and missing; host-c sits in project 2.
 */
function seed(): MetricRecord[] {
  const host = (name: string, extra: Record<string, unknown> = {}) => ({ 'host.name': name, ...extra });
  return [
    point(0, { metricName: 'system.cpu.utilization', value: 10, attributes: { status: 200, 'http.route': '/a' }, resourceAttributes: host('host-a', { 'service.name': 'api' }) }),
    point(1, { metricName: 'system.cpu.utilization', value: 20, attributes: { status: '500' }, resourceAttributes: host('host-a', { 'service.name': 'worker' }) }),
    point(2, { metricName: 'system.cpu.utilization', value: 30, attributes: { status: 404, ok: true }, resourceAttributes: host('host-b', { 'service.name': 'api' }) }),
    point(3, { metricName: 'system.cpu.utilization', value: 40, attributes: {}, resourceAttributes: host('host-b') }),
    point(4, { metricName: 'system.cpu.utilization', value: 50, attributes: { status: 'n/a' }, projectId: P2, resourceAttributes: host('host-c', { 'service.name': '' }) }),
    point(5, { metricName: 'system.cpu.utilization', value: 60, resourceAttributes: { 'service.name': 'lonely' } }),
    // Other metrics, used by sources and resource-scope discovery.
    point(6, { metricName: 'http.server.duration', value: 7, attributes: { status: 200 }, resourceAttributes: host('host-a', { 'service.name': 'api', 'deployment.environment': 'prod' }) }),
    point(7, { metricName: 'hw.host.info', value: 1, resourceAttributes: host('host-a', { 'os.kernel': '6.1' }) }),
    point(8, { metricName: 'app_orders', value: 3, projectId: P2, resourceAttributes: host('host-a', { 'service.name': 'shop' }) }),
    point(9, { metricName: 'app%weird', value: 3, projectId: P2, resourceAttributes: host('host-d') }),
    point(10, { metricName: 'system.cpu.utilization', value: 99, projectId: P3, resourceAttributes: host('host-z') }),
    // Outside the window.
    point(-120, { metricName: 'system.cpu.utilization', value: 1, resourceAttributes: host('host-old') }),
    point(10, { metricName: 'system.cpu.utilization', value: 5, resourceAttributes: host('') }),
  ];
}

async function createEngine(): Promise<TimescaleEngine> {
  const env = { ...process.env, RESERVOIR_TIMESCALE_URL: process.env.RESERVOIR_TIMESCALE_URL || DEFAULT_URL };
  const target = resolveConformanceTarget('timescale', env);
  await probeConformanceTarget(target);
  const config = { ...target.config, schema: SCHEMA };
  const admin = new pg.Client({ host: config.host, port: config.port, database: config.database, user: config.username, password: config.password });
  await admin.connect();
  try {
    await admin.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
    await admin.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  } finally {
    await admin.end();
  }
  const engine = new TimescaleEngine(config);
  await engine.connect();
  await engine.initialize();
  const result = await engine.ingestMetrics(seed());
  if (result.failed > 0) throw new Error(`Seeding metrics failed: ${JSON.stringify(result)}`);
  return engine;
}

describe('timescale metric attributes and sources (1.8)', () => {
  let engine: TimescaleEngine | null = null;

  beforeAll(async () => {
    engine = await resolveSubject('timescale', createEngine, isConformanceRequired());
  }, 60_000);

  beforeEach(({ skip }) => {
    if (!engine) skip();
  });

  afterAll(async () => {
    if (engine) await engine.disconnect();
  });

  const e = (): TimescaleEngine => {
    if (!engine) throw new Error('No Timescale engine');
    return engine;
  };

  const cpu: MetricAggregateParams = {
    projectId: [P1, P2],
    metricName: 'system.cpu.utilization',
    ...WINDOW,
    interval: '1d',
    aggregation: 'sum',
  };

  /** Sum of cpu values for one filter list, in projects 1 and 2. */
  async function sumWith(filters: MetricAttrFilter[]): Promise<number> {
    const result = await e().aggregateMetrics({ ...cpu, filters });
    return result.timeseries.reduce((acc, b) => acc + b.value, 0);
  }

  describe('aggregateMetrics', () => {
    it('groups by resource and metric attributes next to legacy groupBy', async () => {
      const result = await e().aggregateMetrics({
        ...cpu,
        groupBy: ['status'],
        groupByAttrs: [{ scope: 'resource', key: 'host.name' }, { scope: 'metric', key: 'http.route' }],
      });
      const rows = result.timeseries
        .map((b) => `${b.labels!.status}|${b.labels!['resource.host.name']}|${b.labels!['http.route']}=${b.value}`)
        .sort();
      expect(rows).toEqual([
        '200|host-a|/a=10',
        '404|host-b|=30',
        '500|host-a|=20',
        'n/a|host-c|=50',
        '||=65', // no status, host '' and missing host fold into one group
        '|host-b|=40',
      ].sort());
    });

    it('never takes the rollup path with attribute groups or filters', async () => {
      // 1h + avg would be rollup-eligible; the standalone schema has no
      // rollup tables, so a rollup read would throw.
      const grouped = await e().aggregateMetrics({ ...cpu, interval: '1h', aggregation: 'avg', groupByAttrs: [{ scope: 'resource', key: 'host.name' }] });
      expect(grouped.timeseries.length).toBeGreaterThan(0);
      const filtered = await e().aggregateMetrics({ ...cpu, interval: '1h', aggregation: 'avg', filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['host-a'] }] });
      expect(filtered.timeseries.map((b) => b.value)).toEqual([15]);
    });

    it('eq and neq compare the text form, neq matches missing keys', async () => {
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'eq', values: ['200'] }])).toBe(10);
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'eq', values: ['500'] }])).toBe(20);
      expect(await sumWith([{ scope: 'metric', key: 'ok', op: 'eq', values: ['true'] }])).toBe(30);
      // Everything but status 200: 20 + 30 + 40 + 50 + 60 + 5 (host '').
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'neq', values: ['200'] }])).toBe(205);
    });

    it('in and nin take value lists, nin matches missing keys', async () => {
      expect(await sumWith([{ scope: 'resource', key: 'host.name', op: 'in', values: ['host-a', 'host-c'] }])).toBe(80);
      expect(await sumWith([{ scope: 'resource', key: 'host.name', op: 'nin', values: ['host-a', 'host-c'] }])).toBe(30 + 40 + 60 + 5);
    });

    it('exists and notExists check the key', async () => {
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'exists' }])).toBe(10 + 20 + 30 + 50);
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'notExists' }])).toBe(40 + 60 + 5);
      expect(await sumWith([{ scope: 'resource', key: 'host.name', op: 'notExists' }])).toBe(60);
    });

    it('gte and lt compare numbers, missing or non-numeric never match', async () => {
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'gte', values: ['404'] }])).toBe(20 + 30);
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'lt', values: ['404'] }])).toBe(10);
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'lt', values: ['1e3'] }])).toBe(10 + 20 + 30);
      expect(await sumWith([{ scope: 'metric', key: 'status', op: 'gte', values: ['not a number'] }])).toBe(0);
    });

    it('ANDs filters and treats keys literally', async () => {
      expect(await sumWith([
        { scope: 'resource', key: 'host.name', op: 'eq', values: ['host-a'] },
        { scope: 'resource', key: 'service.name', op: 'eq', values: ['worker'] },
      ])).toBe(20);
      // A dotted key is one key, never a path; a hostile key is just a key.
      expect(await sumWith([{ scope: 'resource', key: 'host', op: 'exists' }])).toBe(0);
      expect(await sumWith([{ scope: 'metric', key: "x') OR 1=1 --", op: 'eq', values: ["' OR '1'='1"] }])).toBe(0);
    });
  });

  describe('label discovery with resource scope', () => {
    it('lists resource keys of one metric or of every metric', async () => {
      const one = await e().getMetricLabelKeys({ projectId: [P1, P2], metricName: 'system.cpu.utilization', ...WINDOW, scope: 'resource' });
      expect(one.keys).toEqual(['host.name', 'service.name']);
      const every = await e().getMetricLabelKeys({ projectId: [P1, P2], metricName: '', ...WINDOW, scope: 'resource' });
      expect(every.keys).toEqual(['deployment.environment', 'host.name', 'os.kernel', 'service.name']);
      const metric = await e().getMetricLabelKeys({ projectId: [P1, P2], metricName: 'system.cpu.utilization', ...WINDOW });
      expect(metric.keys).toEqual(['http.route', 'ok', 'status']);
    });

    it('lists non-empty resource values', async () => {
      const values = await e().getMetricLabelValues({ projectId: [P1, P2], metricName: '', ...WINDOW, scope: 'resource' }, 'service.name');
      expect(values.values).toEqual(['api', 'lonely', 'shop', 'worker']);
      const hosts = await e().getMetricLabelValues({ projectId: [P1], metricName: 'system.cpu.utilization', ...WINDOW, scope: 'resource' }, 'host.name');
      expect(hosts.values).toEqual(['host-a', 'host-b']);
      const statuses = await e().getMetricLabelValues({ projectId: [P1, P2], metricName: 'system.cpu.utilization', ...WINDOW }, 'status');
      expect(statuses.values).toEqual(['200', '404', '500', 'n/a']);
    });
  });

  describe('getMetricNames with filters', () => {
    it('lists only names with a point matching every filter', async () => {
      const hostA = await e().getMetricNames({
        projectId: [P1, P2],
        ...WINDOW,
        filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['host-a'] }],
      });
      expect(hostA.names.map((n) => n.name)).toEqual(['app_orders', 'http.server.duration', 'hw.host.info', 'system.cpu.utilization']);

      const both = await e().getMetricNames({
        projectId: [P1, P2],
        ...WINDOW,
        limit: 5,
        filters: [
          { scope: 'resource', key: 'host.name', op: 'eq', values: ['host-a'] },
          { scope: 'metric', key: 'status', op: 'gte', values: ['200'] },
        ],
      });
      expect(both.names.map((n) => n.name)).toEqual(['http.server.duration', 'system.cpu.utilization']);

      const none = await e().getMetricNames({ projectId: [P1, P2], ...WINDOW, filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['nope'] }] });
      expect(none.names).toEqual([]);
    });
  });

  describe('getMetricSources', () => {
    it('returns one row per non-empty value with projects, counts and co-keys', async () => {
      const { sources } = await e().getMetricSources({ projectId: [P1, P2], ...WINDOW, key: 'host.name', coKeys: ['service.name', 'os.kernel'] });
      expect(sources.map((s) => s.value)).toEqual(['host-a', 'host-b', 'host-c', 'host-d']);
      const a = sources[0];
      expect(a.projectIds).toEqual([P1, P2].sort());
      expect(a.lastSeen).toEqual(new Date(BASE + 8 * 60_000));
      expect(a.metricCount).toBe(4);
      expect(a.pointCount).toBe(5);
      expect(a.co).toEqual({ 'service.name': ['api', 'shop', 'worker'], 'os.kernel': ['6.1'] });
      const c = sources[2];
      expect(c.co).toEqual({ 'service.name': [], 'os.kernel': [] });
      expect(c.projectIds).toEqual([P2]);
    });

    it('applies include and exclude prefixes literally', async () => {
      const included = await e().getMetricSources({ projectId: [P1, P2], ...WINDOW, key: 'host.name', includeMetricPrefixes: ['system.', 'app%'] });
      expect(included.sources.map((s) => [s.value, s.pointCount])).toEqual([['host-a', 2], ['host-b', 2], ['host-c', 1], ['host-d', 1]]);
      const excluded = await e().getMetricSources({ projectId: [P1, P2], ...WINDOW, key: 'service.name', excludeMetricPrefixes: ['system.', 'hw.'] });
      expect(excluded.sources.map((s) => [s.value, s.metricCount])).toEqual([['api', 1], ['shop', 1]]);
      // '_' is not a wildcard: app_ matches app_orders but not app%weird.
      const underscore = await e().getMetricSources({ projectId: [P1, P2], ...WINDOW, key: 'host.name', includeMetricPrefixes: ['app_'] });
      expect(underscore.sources.map((s) => s.value)).toEqual(['host-a']);
    });

    it('scopes to projects and window, orders by value and limits', async () => {
      const limited = await e().getMetricSources({ projectId: [P1, P2, P3], ...WINDOW, key: 'host.name', limit: 2 });
      expect(limited.sources.map((s) => s.value)).toEqual(['host-a', 'host-b']);
      const p3 = await e().getMetricSources({ projectId: [P3], ...WINDOW, key: 'host.name' });
      expect(p3.sources.map((s) => s.value)).toEqual(['host-z']);
      const none = await e().getMetricSources({ projectId: [P1], from: new Date(BASE + 7_200_000), to: new Date(BASE + 9_000_000), key: 'host.name' });
      expect(none.sources).toEqual([]);
      const org = await e().getMetricSources({ organizationId: '00000000-0000-4000-8000-0000000000ff', projectId: [P1], ...WINDOW, key: 'host.name' });
      expect(org.sources).toEqual([]);
    });
  });
});
