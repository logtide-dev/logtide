// ============================================================================
// Project scope audit of every panel fetcher
// ============================================================================
//
// One org with two projects (A and B) holding different data. For each panel
// type: with projectId = A the result carries only A's data, with projectId =
// null it carries both. Metric panels assert on the aggregateMetrics mock call
// args (the real aggregation needs cagg tables).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { fetchPanelData } from '../../../modules/custom-dashboards/panel-data-service.js';
import { customDashboardsRoutes } from '../../../modules/custom-dashboards/routes.js';
import { customDashboardsService } from '../../../modules/custom-dashboards/service.js';
import { MonitorService } from '../../../modules/monitoring/service.js';
import { SiemService } from '../../../modules/siem/service.js';
import {
  createTestContext,
  createTestProject,
  createTestAlertRule,
  createTestLog,
  createTestSpan,
  createTestSession,
} from '../../helpers/index.js';

vi.mock('../../../queue/jobs/monitor-notification.js', () => ({
  monitorNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../modules/maintenances/service.js', () => ({
  maintenanceService: {
    getProjectsUnderMaintenance: vi.fn().mockResolvedValue(new Set()),
  },
}));

vi.mock('../../../modules/monitoring/checker.js', () => ({
  runHttpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null }),
  runTcpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 10, statusCode: null, errorCode: null }),
  runHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
  runLogHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
  parseTcpTarget: vi.fn().mockReturnValue({ host: 'localhost', port: 5432 }),
}));

const siemService = new SiemService(db);
const monitorServiceInstance = new MonitorService(db);

let orgId: string;
let userId: string;
let projectA: string;
let projectB: string;
let foreignProject: string;
let sessionToken: string;

const ALL_LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;
type Level = (typeof ALL_LEVELS)[number];

function ctx() {
  return { organizationId: orgId, userId };
}

function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60 * 1000);
}

async function seedSigmaRule(projectId: string, title: string) {
  return db
    .insertInto('sigma_rules')
    .values({
      organization_id: orgId,
      project_id: projectId,
      sigma_id: `scope-${title}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      description: 'scope test',
      level: 'high',
      status: 'stable',
      logsource: { product: 'linux' },
      detection: { selection: { 'message|contains': 'x' }, condition: 'selection' },
      email_recipients: [],
      webhook_url: null,
      alert_rule_id: null,
      conversion_status: 'success',
      conversion_notes: '',
      tags: [],
      mitre_tactics: null,
      mitre_techniques: null,
      sigmahq_path: null,
      sigmahq_commit: null,
      last_synced_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

beforeEach(async () => {
  const c = await createTestContext();
  orgId = c.organization.id;
  userId = c.user.id;
  projectA = c.project.id;
  projectB = (await createTestProject({ organizationId: orgId, userId })).id;
  foreignProject = (await createTestContext()).project.id;
  sessionToken = (await createTestSession(userId)).token;

  // Project A: 3 logs on svc-a (1 error), project B: 5 logs on svc-b (2 errors)
  const geoA = { geo_country_code: 'IT', geo_place: '41.90,12.50|Rome, Italy', tier: 'gold' };
  const geoB = { geo_country_code: 'DE', geo_place: '52.52,13.40|Berlin, Germany', tier: 'silver' };
  await createTestLog({ projectId: projectA, service: 'svc-a', level: 'info', message: 'a ok 1', time: minutesAgo(2), metadata: geoA });
  await createTestLog({ projectId: projectA, service: 'svc-a', level: 'info', message: 'a ok 2', time: minutesAgo(2), metadata: geoA });
  await createTestLog({ projectId: projectA, service: 'svc-a', level: 'error', message: 'boom-a', time: minutesAgo(3), metadata: geoA });
  for (let i = 0; i < 3; i++) {
    await createTestLog({ projectId: projectB, service: 'svc-b', level: 'info', message: `b ok ${i}`, time: minutesAgo(2), metadata: geoB });
  }
  for (let i = 0; i < 2; i++) {
    await createTestLog({ projectId: projectB, service: 'svc-b', level: 'error', message: 'boom-b', time: minutesAgo(3), metadata: geoB });
  }

  // Spans: A has 1 on svc-a, B has 3 on svc-b
  await createTestSpan({ projectId: projectA, organizationId: orgId, serviceName: 'svc-a', statusCode: 'OK', startTime: minutesAgo(2) });
  for (let i = 0; i < 3; i++) {
    await createTestSpan({ projectId: projectB, organizationId: orgId, serviceName: 'svc-b', statusCode: 'OK', startTime: minutesAgo(2) });
  }

  // Alert rules + history
  const ruleA = await createTestAlertRule({ organizationId: orgId, projectId: projectA, name: 'Rule A' });
  const ruleB = await createTestAlertRule({ organizationId: orgId, projectId: projectB, name: 'Rule B' });
  await db.insertInto('alert_history').values({ rule_id: ruleA.id, triggered_at: new Date(), log_count: 5, notified: true }).execute();
  await db.insertInto('alert_history').values({ rule_id: ruleB.id, triggered_at: new Date(), log_count: 7, notified: true }).execute();

  // Detections: one per project
  const sigmaA = await seedSigmaRule(projectA, 'Rule A');
  const sigmaB = await seedSigmaRule(projectB, 'Rule B');
  const logA = await db.selectFrom('logs').select('id').where('project_id', '=', projectA).executeTakeFirstOrThrow();
  const logB = await db.selectFrom('logs').select('id').where('project_id', '=', projectB).executeTakeFirstOrThrow();
  await siemService.createDetectionEvent({
    organizationId: orgId, projectId: projectA, sigmaRuleId: sigmaA.id, logId: logA.id,
    severity: 'high', ruleTitle: 'Rule A', service: 'svc-a', logLevel: 'error', logMessage: 'boom-a',
  });
  await siemService.createDetectionEvent({
    organizationId: orgId, projectId: projectB, sigmaRuleId: sigmaB.id, logId: logB.id,
    severity: 'critical', ruleTitle: 'Rule B', service: 'svc-b', logLevel: 'error', logMessage: 'boom-b',
  });
  await siemService.createDetectionEvent({
    organizationId: orgId, projectId: projectB, sigmaRuleId: sigmaB.id, logId: logB.id,
    severity: 'critical', ruleTitle: 'Rule B', service: 'svc-b', logLevel: 'error', logMessage: 'boom-b',
  });

  // Monitors: one in A, two in B
  for (const [pid, name] of [[projectA, 'Mon A'], [projectB, 'Mon B1'], [projectB, 'Mon B2']] as const) {
    const m = await monitorServiceInstance.createMonitor({
      organizationId: orgId, projectId: pid, name, type: 'heartbeat', intervalSeconds: 60,
    });
    await db
      .updateTable('monitor_status')
      .set({ status: 'up', consecutive_failures: 0, consecutive_successes: 3, last_checked_at: new Date(), response_time_ms: 45 })
      .where('monitor_id', '=', m.id)
      .execute();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const levels = (): Level[] => [...ALL_LEVELS];

// ─── time_series ────────────────────────────────────────────────────────────

describe('project scope: time_series', () => {
  const cfg = (projectId: string | null) => ({
    type: 'time_series' as const,
    title: 'T',
    source: 'logs' as const,
    projectId,
    interval: '24h' as const,
    levels: levels(),
    service: null,
  });
  const sum = (r: unknown) =>
    (r as { series: Array<{ total: number }> }).series.reduce((a, p) => a + p.total, 0);

  it('projectId A excludes project B logs', async () => {
    expect(sum(await fetchPanelData(cfg(projectA), ctx()))).toBe(3);
  });
  it('projectId null covers both projects', async () => {
    expect(sum(await fetchPanelData(cfg(null), ctx()))).toBe(8);
  });
});

// ─── single_stat ────────────────────────────────────────────────────────────

describe('project scope: single_stat', () => {
  const cfg = (projectId: string | null, metric: 'total_logs' | 'active_services') => ({
    type: 'single_stat' as const,
    title: 'S',
    source: 'logs' as const,
    projectId,
    metric,
    compareWithPrevious: false,
  });

  it('total_logs: counts only project A', async () => {
    const r = (await fetchPanelData(cfg(projectA, 'total_logs'), ctx())) as { value: number };
    expect(r.value).toBe(3);
  });
  it('total_logs: null covers both', async () => {
    const r = (await fetchPanelData(cfg(null, 'total_logs'), ctx())) as { value: number };
    expect(r.value).toBe(8);
  });
  it('active_services: only project A services', async () => {
    const a = (await fetchPanelData(cfg(projectA, 'active_services'), ctx())) as { value: number };
    const all = (await fetchPanelData(cfg(null, 'active_services'), ctx())) as { value: number };
    expect(a.value).toBe(1);
    expect(all.value).toBe(2);
  });
});

// ─── top_n_table ────────────────────────────────────────────────────────────

describe('project scope: top_n_table', () => {
  type Rows = { rows: Array<{ key: string; count: number }> };
  const base = {
    type: 'top_n_table' as const,
    title: 'N',
    source: 'logs' as const,
    limit: 10,
    interval: '24h' as const,
  };

  it('service: only A services', async () => {
    const a = (await fetchPanelData({ ...base, dimension: 'service', projectId: projectA }, ctx())) as Rows;
    expect(a.rows.map((r) => r.key)).toEqual(['svc-a']);
    const all = (await fetchPanelData({ ...base, dimension: 'service', projectId: null }, ctx())) as Rows;
    expect(all.rows.map((r) => r.key).sort()).toEqual(['svc-a', 'svc-b']);
  });

  it('service (7d cagg fast path): only A services', async () => {
    const a = (await fetchPanelData({ ...base, interval: '7d', dimension: 'service', projectId: projectA }, ctx())) as Rows;
    expect(a.rows.every((r) => r.key === 'svc-a')).toBe(true);
    expect(a.rows.some((r) => r.key === 'svc-b')).toBe(false);
  });

  it('error_message: only A messages', async () => {
    const a = (await fetchPanelData({ ...base, dimension: 'error_message', projectId: projectA }, ctx())) as Rows;
    expect(a.rows.map((r) => r.key)).toEqual(['boom-a']);
    const all = (await fetchPanelData({ ...base, dimension: 'error_message', projectId: null }, ctx())) as Rows;
    expect(all.rows.map((r) => r.key).sort()).toEqual(['boom-a', 'boom-b']);
  });

  it('metadata: only A values', async () => {
    const a = (await fetchPanelData(
      { ...base, dimension: 'metadata', metadataField: 'tier', projectId: projectA },
      ctx(),
    )) as Rows;
    expect(a.rows.map((r) => r.key)).toEqual(['gold']);
    const all = (await fetchPanelData(
      { ...base, dimension: 'metadata', metadataField: 'tier', projectId: null },
      ctx(),
    )) as Rows;
    expect(all.rows.map((r) => r.key).sort()).toEqual(['gold', 'silver']);
  });
});

// ─── live_log_stream / log_table ────────────────────────────────────────────

describe('project scope: log row panels', () => {
  it('live_log_stream: only A rows', async () => {
    const mk = (projectId: string | null) => ({
      type: 'live_log_stream' as const,
      title: 'L',
      source: 'logs' as const,
      projectId,
      service: null,
      levels: levels(),
      maxRows: 100,
    });
    const a = (await fetchPanelData(mk(projectA), ctx())) as { logs: Array<{ projectId: string }> };
    expect(a.logs).toHaveLength(3);
    expect(a.logs.every((l) => l.projectId === projectA)).toBe(true);
    const all = (await fetchPanelData(mk(null), ctx())) as { logs: unknown[] };
    expect(all.logs).toHaveLength(8);
  });

  it('log_table snapshot: only A rows', async () => {
    const mk = (projectId: string | null) => ({
      type: 'log_table' as const,
      title: 'LT',
      source: 'logs' as const,
      projectId,
      mode: 'snapshot' as const,
      timeRange: '24h' as const,
      levels: [] as Level[],
      service: null,
      maxRows: 100,
      columns: [] as string[],
      builtinColumns: ['time', 'level', 'service', 'message'] as Array<'time' | 'level' | 'service' | 'message'>,
      wrapCells: false,
    });
    const a = (await fetchPanelData(mk(projectA), ctx())) as { logs: Array<{ projectId: string }> };
    expect(a.logs).toHaveLength(3);
    expect(a.logs.every((l) => l.projectId === projectA)).toBe(true);
    const all = (await fetchPanelData(mk(null), ctx())) as { logs: unknown[] };
    expect(all.logs).toHaveLength(8);
  });
});

// ─── geo_map ────────────────────────────────────────────────────────────────

describe('project scope: geo_map', () => {
  const mk = (projectId: string | null) => ({
    type: 'geo_map' as const,
    title: 'G',
    source: 'logs' as const,
    projectId,
    interval: '24h' as const,
    mode: 'country' as const,
    limit: 100,
    fieldPrefix: 'geo',
    levels: [] as Level[],
    service: null,
    hostname: null,
  });

  it('only A points', async () => {
    const a = (await fetchPanelData(mk(projectA), ctx())) as { points: Array<{ countryCode?: string; count: number }> };
    expect(a.points.map((p) => p.countryCode)).toEqual(['IT']);
    expect(a.points[0].count).toBe(3);
    const all = (await fetchPanelData(mk(null), ctx())) as { points: Array<{ countryCode?: string }> };
    expect(all.points.map((p) => p.countryCode).sort()).toEqual(['DE', 'IT']);
  });
});

// ─── activity_overview ──────────────────────────────────────────────────────

describe('project scope: activity_overview', () => {
  const mk = (projectId: string | null) => ({
    type: 'activity_overview' as const,
    title: 'A',
    source: 'mixed' as const,
    projectId,
    timeRange: '24h' as const,
    series: ['logs', 'log_errors', 'spans', 'detections', 'alerts'] as Array<
      'logs' | 'log_errors' | 'spans' | 'detections' | 'alerts'
    >,
  });
  const total = (r: unknown, key: 'logs' | 'log_errors' | 'spans' | 'detections' | 'alerts') =>
    (r as { series: Array<Record<string, number>> }).series.reduce((acc, p) => acc + p[key], 0);

  it('only A series', async () => {
    const a = await fetchPanelData(mk(projectA), ctx());
    expect(total(a, 'logs')).toBe(3);
    expect(total(a, 'log_errors')).toBe(1);
    expect(total(a, 'spans')).toBe(1);
    expect(total(a, 'detections')).toBe(1);
    expect(total(a, 'alerts')).toBe(1);
    const all = await fetchPanelData(mk(null), ctx());
    expect(total(all, 'logs')).toBe(8);
    expect(total(all, 'spans')).toBe(4);
    expect(total(all, 'detections')).toBe(3);
    expect(total(all, 'alerts')).toBe(2);
  });
});

// ─── alert_status / detection_events ────────────────────────────────────────

describe('project scope: alert_status', () => {
  const mk = (projectId: string | null) => ({
    type: 'alert_status' as const,
    title: 'AL',
    source: 'alerts' as const,
    projectId,
    ruleIds: [] as string[],
    showHistory: true,
    limit: 20,
  });
  type R = { rules: Array<{ name: string }>; recentHistory: Array<{ ruleName: string }> };

  it('only A rules and history', async () => {
    const a = (await fetchPanelData(mk(projectA), ctx())) as R;
    expect(a.rules.map((r) => r.name)).toEqual(['Rule A']);
    expect(a.recentHistory.map((h) => h.ruleName)).toEqual(['Rule A']);
    const all = (await fetchPanelData(mk(null), ctx())) as R;
    expect(all.rules.map((r) => r.name).sort()).toEqual(['Rule A', 'Rule B']);
  });
});

describe('project scope: detection_events', () => {
  const mk = (projectId: string | null) => ({
    type: 'detection_events' as const,
    title: 'D',
    source: 'detections' as const,
    projectId,
    timeRange: '24h' as const,
    severities: [] as Array<'low' | 'medium' | 'high' | 'critical' | 'informational'>,
  });

  it('only A detections', async () => {
    const a = (await fetchPanelData(mk(projectA), ctx())) as { totalDetections: number };
    expect(a.totalDetections).toBe(1);
    const all = (await fetchPanelData(mk(null), ctx())) as { totalDetections: number };
    expect(all.totalDetections).toBe(3);
  });
});

// ─── monitors ───────────────────────────────────────────────────────────────

describe('project scope: monitors', () => {
  it('monitor_status: only A monitors', async () => {
    const mk = (projectId: string | null) => ({
      type: 'monitor_status' as const,
      title: 'M',
      source: 'monitors' as const,
      projectId,
      monitorIds: [] as string[],
      limit: 20,
    });
    const a = (await fetchPanelData(mk(projectA), ctx())) as { monitors: Array<{ name: string }> };
    expect(a.monitors.map((m) => m.name)).toEqual(['Mon A']);
    const all = (await fetchPanelData(mk(null), ctx())) as { monitors: unknown[] };
    expect(all.monitors).toHaveLength(3);
  });

  it('system_status: counts only A monitors', async () => {
    const mk = (projectId: string | null) => ({
      type: 'system_status' as const,
      title: 'SS',
      source: 'monitors' as const,
      projectId,
      showCounts: true,
    });
    const a = (await fetchPanelData(mk(projectA), ctx())) as { totalMonitors: number };
    expect(a.totalMonitors).toBe(1);
    const all = (await fetchPanelData(mk(null), ctx())) as { totalMonitors: number };
    expect(all.totalMonitors).toBe(3);
  });
});

// ─── traces ─────────────────────────────────────────────────────────────────

describe('project scope: traces', () => {
  it('trace_volume: only A spans', async () => {
    const mk = (projectId: string | null) => ({
      type: 'trace_volume' as const,
      title: 'TV',
      source: 'traces' as const,
      projectId,
      serviceName: null,
      timeRange: '24h' as const,
      showErrors: true,
    });
    const sum = (r: unknown) =>
      (r as { series: Array<{ total: number }> }).series.reduce((a, p) => a + p.total, 0);
    expect(sum(await fetchPanelData(mk(projectA), ctx()))).toBe(1);
    expect(sum(await fetchPanelData(mk(null), ctx()))).toBe(4);
  });

  it('trace_latency: only A spans', async () => {
    const mk = (projectId: string | null) => ({
      type: 'trace_latency' as const,
      title: 'TL',
      source: 'traces' as const,
      projectId,
      serviceName: null,
      timeRange: '24h' as const,
      showPercentiles: ['p50'] as Array<'p50' | 'p95' | 'p99'>,
    });
    const sum = (r: unknown) =>
      (r as { series: Array<{ spanCount: number }> }).series.reduce((a, p) => a + p.spanCount, 0);
    expect(sum(await fetchPanelData(mk(projectA), ctx()))).toBe(1);
    expect(sum(await fetchPanelData(mk(null), ctx()))).toBe(4);
  });
});

// ─── metric panels (mocked aggregation) ─────────────────────────────────────

describe('project scope: metric panels', () => {
  function mockAggregation() {
    return vi.spyOn(reservoir, 'aggregateMetrics').mockResolvedValue({
      metricName: 'm',
      metricType: 'gauge',
      timeseries: [{ bucket: new Date(), value: 1, labels: {} }],
      executionTimeMs: 1,
    } as Awaited<ReturnType<typeof reservoir.aggregateMetrics>>);
  }

  it('metric_chart: aggregateMetrics is called with projectId [A]', async () => {
    const spy = mockAggregation();
    await fetchPanelData(
      {
        type: 'metric_chart', title: 'MC', source: 'metrics', projectId: projectA,
        metricName: 'm', aggregation: 'avg', interval: '1h', timeRange: '24h', serviceName: null,
      },
      ctx(),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].projectId).toEqual([projectA]);
  });

  it('metric_chart: null resolves to both org projects only', async () => {
    const spy = mockAggregation();
    await fetchPanelData(
      {
        type: 'metric_chart', title: 'MC', source: 'metrics', projectId: null,
        metricName: 'm', aggregation: 'avg', interval: '1h', timeRange: '24h', serviceName: null,
      },
      ctx(),
    );
    const ids = spy.mock.calls[0][0].projectId as string[];
    expect([...ids].sort()).toEqual([projectA, projectB].sort());
    expect(ids).not.toContain(foreignProject);
  });

  it('metric_stat: aggregateMetrics is called with projectId [A]', async () => {
    const spy = mockAggregation();
    await fetchPanelData(
      {
        type: 'metric_stat', title: 'MS', source: 'metrics', projectId: projectA,
        metricName: 'm', aggregation: 'avg', timeRange: '24h', serviceName: null,
      },
      ctx(),
    );
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(call[0].projectId).toEqual([projectA]);
    }
  });
});

// ─── batch isolation ────────────────────────────────────────────────────────

describe('project scope: batch endpoint', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(customDashboardsRoutes, { prefix: '/api/v1/custom-dashboards' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('isolates a deleted project', async () => {
    const doomed = await createTestProject({ organizationId: orgId, userId });
    const mkPanel = (id: string, projectId: string) => ({
      id,
      layout: { x: 0, y: 0, w: 4, h: 3 },
      config: {
        type: 'time_series' as const,
        title: id,
        source: 'logs' as const,
        projectId,
        interval: '24h' as const,
        levels: levels(),
        service: null,
      },
    });
    const dashboard = await customDashboardsService.create(
      {
        organizationId: orgId,
        name: 'Scope',
        panels: [mkPanel('healthy', projectA), mkPanel('doomed', doomed.id)],
      },
      userId,
    );
    await db.deleteFrom('api_keys').where('project_id', '=', doomed.id).execute();
    await db.deleteFrom('projects').where('id', '=', doomed.id).execute();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/custom-dashboards/${dashboard.id}/panels/data`,
      headers: { Authorization: `Bearer ${sessionToken}` },
      payload: { organizationId: orgId },
    });
    expect(res.statusCode).toBe(200);
    const { panels } = JSON.parse(res.payload) as {
      panels: Record<string, { data: unknown; error?: string }>;
    };
    expect(panels.healthy.error).toBeUndefined();
    expect(panels.healthy.data).toBeTruthy();
    expect(panels.doomed.error).toContain('does not belong');
  });
});
