// ============================================================================
// panel-data-service integration tests
// ============================================================================
//
// Integration-style: real test db + real reservoir (timescale). Each panel type
// gets three cases: happy path, tenancy (org isolation), empty/no-data.
// Metric panels mock reservoir.aggregateMetrics via vi.spyOn (reservoir goes
// through an ORM rollup path that needs cagg tables; spy keeps the rest real).
//
// NOTE: helpers timeRangeToMs, buildBucketTimes, intervalToMs are file-local.
// They are exercised indirectly via fetchPanelData. The `export` keyword was NOT
// added to them because all branches are reachable through the public surface.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { fetchPanelData } from '../../../modules/custom-dashboards/panel-data-service.js';
import { MonitorService } from '../../../modules/monitoring/service.js';
import { SiemService } from '../../../modules/siem/service.js';
import {
  createTestContext,
  createTestProject,
  createTestAlertRule,
  createTestLog,
  createTestSpan,
} from '../../helpers/factories.js';

// Mock monitor notification queue to avoid BullMQ connections
vi.mock('../../../queue/jobs/monitor-notification.js', () => ({
  monitorNotificationQueue: {
    add: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock maintenanceService used inside MonitorService
vi.mock('../../../modules/maintenances/service.js', () => ({
  maintenanceService: {
    getProjectsUnderMaintenance: vi.fn().mockResolvedValue(new Set()),
  },
}));

// Mock checker so createMonitor doesn't do real network checks
vi.mock('../../../modules/monitoring/checker.js', () => ({
  runHttpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null }),
  runTcpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 10, statusCode: null, errorCode: null }),
  runHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
  runLogHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
  parseTcpTarget: vi.fn().mockReturnValue({ host: 'localhost', port: 5432 }),
}));

// ─── Shared seeded state (re-created each test by setup.ts cleanup + beforeEach) ─

const siemService = new SiemService(db);

// Per-test fixtures populated in beforeEach
let orgId: string;
let projectId: string;
let userId: string;
let otherOrgId: string;
let otherProjectId: string;
let alertRuleId: string;
let monitorId: string;
let sigmaRuleId: string;
const monitorServiceInstance = new MonitorService(db);

async function seedShared() {
  // Primary org/project/user
  const ctx = await createTestContext();
  orgId = ctx.organization.id;
  projectId = ctx.project.id;
  userId = ctx.user.id;

  // Second org for tenancy checks
  const otherCtx = await createTestContext();
  otherOrgId = otherCtx.organization.id;
  otherProjectId = otherCtx.project.id;

  // Logs within the last 5 min (live_log_stream window)
  const now = new Date();
  const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000);
  const threeMinAgo = new Date(now.getTime() - 3 * 60 * 1000);

  await createTestLog({ projectId, service: 'api', level: 'info', message: 'hello', time: twoMinAgo });
  await createTestLog({ projectId, service: 'api', level: 'error', message: 'boom', time: threeMinAgo });
  await createTestLog({ projectId, service: 'worker', level: 'warn', message: 'slow', time: twoMinAgo });

  // Log for other org
  await createTestLog({ projectId: otherProjectId, service: 'spy', level: 'info', message: 'foreign log' });

  // Spans for primary project
  await createTestSpan({ projectId, organizationId: orgId, serviceName: 'api', statusCode: 'OK', startTime: twoMinAgo });
  await createTestSpan({ projectId, organizationId: orgId, serviceName: 'api', statusCode: 'ERROR', startTime: threeMinAgo });

  // Alert rule + history
  const rule = await createTestAlertRule({ organizationId: orgId, projectId, name: 'High errors' });
  alertRuleId = rule.id;

  await db
    .insertInto('alert_history')
    .values({ rule_id: alertRuleId, triggered_at: new Date(), log_count: 5, notified: true })
    .execute();

  // Alert rule for other org (must NOT leak)
  const otherRule = await createTestAlertRule({ organizationId: otherOrgId, projectId: otherProjectId, name: 'Foreign rule' });
  await db
    .insertInto('alert_history')
    .values({ rule_id: otherRule.id, triggered_at: new Date(), log_count: 99, notified: false })
    .execute();

  // Sigma rule for primary org
  const sigmaRule = await db
    .insertInto('sigma_rules')
    .values({
      organization_id: orgId,
      project_id: projectId,
      sigma_id: `sigma-panel-test-${Date.now()}`,
      title: 'Panel Test Rule',
      description: 'used by panel tests',
      level: 'high',
      status: 'stable',
      logsource: { product: 'linux' },
      detection: { selection: { 'message|contains': 'boom' }, condition: 'selection' },
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

  sigmaRuleId = sigmaRule.id;

  // Detection event for primary org
  const seededLog = await db
    .selectFrom('logs')
    .select('id')
    .where('project_id', '=', projectId)
    .executeTakeFirstOrThrow();

  await siemService.createDetectionEvent({
    organizationId: orgId,
    projectId,
    sigmaRuleId,
    logId: seededLog.id,
    severity: 'high',
    ruleTitle: 'Panel Test Rule',
    service: 'api',
    logLevel: 'error',
    logMessage: 'boom',
  });

  // Monitor for primary org
  const monitor = await monitorServiceInstance.createMonitor({
    organizationId: orgId,
    projectId,
    name: 'API Check',
    type: 'heartbeat',
    intervalSeconds: 60,
  });
  monitorId = monitor.id;

  // Update status to 'up' (createMonitor seeds 'unknown')
  await db
    .updateTable('monitor_status')
    .set({ status: 'up', consecutive_failures: 0, consecutive_successes: 3, last_checked_at: new Date(), response_time_ms: 45 })
    .where('monitor_id', '=', monitorId)
    .execute();

  // Monitor for other org (must NOT appear in primary org queries)
  await monitorServiceInstance.createMonitor({
    organizationId: otherOrgId,
    projectId: otherProjectId,
    name: 'Foreign Monitor',
    type: 'heartbeat',
    intervalSeconds: 60,
  });
}

beforeEach(async () => {
  await seedShared();
});

// ─── Context helpers ─────────────────────────────────────────────────────────

function ctx() {
  return { organizationId: orgId, userId };
}

// ─── time_series ──────────────────────────────────────────────────────────────

describe('time_series panel', () => {
  it('happy path: returns series with correct shape', async () => {
    const result = (await fetchPanelData(
      {
        type: 'time_series',
        title: 'Test',
        source: 'logs',
        projectId,
        interval: '24h',
        levels: ['info', 'error', 'warn', 'debug', 'critical'],
        service: null,
      },
      ctx(),
    )) as { series: Array<{ time: string; total: number; info: number; error: number; warn: number; debug: number; critical: number }>; interval: string };

    expect(result.interval).toBe('24h');
    expect(Array.isArray(result.series)).toBe(true);
    for (const point of result.series) {
      expect(typeof point.time).toBe('string');
      expect(typeof point.total).toBe('number');
      expect(point.total).toBe(point.debug + point.info + point.warn + point.error + point.critical);
    }
  });

  it('level filter: excluded levels are zeroed out', async () => {
    const result = (await fetchPanelData(
      {
        type: 'time_series',
        title: 'Test',
        source: 'logs',
        projectId,
        interval: '1h',
        levels: ['info'],
        service: null,
      },
      ctx(),
    )) as { series: Array<{ error: number; warn: number; debug: number; critical: number }> };

    for (const point of result.series) {
      expect(point.error).toBe(0);
      expect(point.warn).toBe(0);
      expect(point.debug).toBe(0);
      expect(point.critical).toBe(0);
    }
  });

  it('org-wide (projectId null) returns series', async () => {
    const result = (await fetchPanelData(
      {
        type: 'time_series',
        title: 'Org-wide',
        source: 'logs',
        projectId: null,
        interval: '24h',
        levels: ['info', 'error', 'warn', 'debug', 'critical'],
        service: null,
      },
      ctx(),
    )) as { series: unknown[] };
    expect(Array.isArray(result.series)).toBe(true);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'time_series',
          title: 'X',
          source: 'logs',
          projectId: otherProjectId,
          interval: '24h',
          levels: ['info'],
          service: null,
        },
        ctx(), // orgId doesn't own otherProjectId
      ),
    ).rejects.toThrow(/belong/);
  });
});

// ─── single_stat ──────────────────────────────────────────────────────────────

describe('single_stat panel', () => {
  const makeBase = () => ({
    type: 'single_stat' as const,
    title: 'Test',
    source: 'logs' as const,
    projectId: null as null,
    compareWithPrevious: false,
  });

  it('total_logs metric', async () => {
    const r = (await fetchPanelData({ ...makeBase(), metric: 'total_logs' }, ctx())) as {
      value: number; unit: string; metric: string;
    };
    expect(r.unit).toBe('count');
    expect(r.metric).toBe('total_logs');
    expect(typeof r.value).toBe('number');
  });

  it('error_rate metric', async () => {
    const r = (await fetchPanelData({ ...makeBase(), metric: 'error_rate' }, ctx())) as { unit: string; metric: string };
    expect(r.unit).toBe('percent');
    expect(r.metric).toBe('error_rate');
  });

  it('active_services metric', async () => {
    const r = (await fetchPanelData({ ...makeBase(), metric: 'active_services' }, ctx())) as { unit: string; metric: string };
    expect(r.unit).toBe('count');
    expect(r.metric).toBe('active_services');
  });

  it('throughput metric', async () => {
    const r = (await fetchPanelData({ ...makeBase(), metric: 'throughput' }, ctx())) as { unit: string; metric: string };
    expect(r.unit).toBe('rate');
    expect(r.metric).toBe('throughput');
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData({ ...makeBase(), metric: 'total_logs', projectId: otherProjectId }, ctx()),
    ).rejects.toThrow(/belong/);
  });
});

// ─── top_n_table ─────────────────────────────────────────────────────────────

describe('top_n_table panel', () => {
  it('happy path (service dimension): returns rows', async () => {
    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Top services',
        source: 'logs',
        dimension: 'service',
        limit: 10,
        projectId,
        interval: '24h',
      },
      ctx(),
    )) as { rows: Array<{ key: string; count: number; percentage: number }>; total: number };

    expect(typeof r.total).toBe('number');
    expect(Array.isArray(r.rows)).toBe(true);
    for (const row of r.rows) {
      expect(typeof row.key).toBe('string');
      expect(typeof row.count).toBe('number');
    }
  });

  it('error_message dimension: rows from reservoir', async () => {
    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Top errors',
        source: 'logs',
        dimension: 'error_message',
        limit: 5,
        projectId,
        interval: '24h',
      },
      ctx(),
    )) as { rows: Array<unknown>; total: number };

    expect(typeof r.total).toBe('number');
    expect(Array.isArray(r.rows)).toBe(true);
  });

  it('error_message org-wide: empty org returns empty shape', async () => {
    const emptyCtx = await createTestContext();
    // Delete the auto-created project so the org has none
    await db.deleteFrom('api_keys').where('project_id', '=', emptyCtx.project.id).execute();
    await db.deleteFrom('projects').where('id', '=', emptyCtx.project.id).execute();

    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Empty',
        source: 'logs',
        dimension: 'error_message',
        limit: 5,
        projectId: null,
        interval: '7d',
      },
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id },
    )) as { rows: unknown[]; total: number };

    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'top_n_table',
          title: 'X',
          source: 'logs',
          dimension: 'service',
          limit: 5,
          projectId: otherProjectId,
          interval: '24h',
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('metadata dimension: ranks values with counts and lastSeen', async () => {
    const now = new Date();
    const newest = new Date(now.getTime() - 60 * 1000);
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'NY' }, time: new Date(now.getTime() - 5 * 60 * 1000) });
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'NY' }, time: new Date(now.getTime() - 3 * 60 * 1000) });
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'NY' }, time: newest });
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'LA' }, time: new Date(now.getTime() - 4 * 60 * 1000) });

    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Top places',
        source: 'logs',
        dimension: 'metadata',
        metadataField: 'geo_place',
        limit: 10,
        projectId,
        interval: '24h',
        showLastSeen: true,
      },
      ctx(),
    )) as { rows: Array<{ key: string; count: number; percentage: number; lastSeen?: string }>; total: number };

    expect(r.rows[0].key).toBe('NY');
    expect(r.rows[0].count).toBe(3);
    expect(r.rows[0].lastSeen).toBe(newest.toISOString());
    const la = r.rows.find((row) => row.key === 'LA');
    expect(la!.count).toBe(1);
  });

  it('metadata dimension: omits lastSeen when showLastSeen is off', async () => {
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'NY' } });

    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Top places',
        source: 'logs',
        dimension: 'metadata',
        metadataField: 'geo_place',
        limit: 10,
        projectId,
        interval: '24h',
      },
      ctx(),
    )) as { rows: Array<Record<string, unknown>> };

    expect(r.rows.length).toBeGreaterThan(0);
    expect('lastSeen' in r.rows[0]).toBe(false);
  });

  it('metadata dimension: respects levels filter', async () => {
    await createTestLog({ projectId, service: 'edge', level: 'error', metadata: { geo_place: 'ERR' } });
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'INFO' } });

    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Top places',
        source: 'logs',
        dimension: 'metadata',
        metadataField: 'geo_place',
        limit: 10,
        projectId,
        interval: '24h',
        levels: ['error'],
      },
      ctx(),
    )) as { rows: Array<{ key: string }> };

    expect(r.rows.map((row) => row.key)).toEqual(['ERR']);
  });

  it('metadata dimension: respects service filter', async () => {
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'EDGE' } });
    await createTestLog({ projectId, service: 'other', level: 'info', metadata: { geo_place: 'OTHER' } });

    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Top places',
        source: 'logs',
        dimension: 'metadata',
        metadataField: 'geo_place',
        limit: 10,
        projectId,
        interval: '24h',
        service: 'edge',
      },
      ctx(),
    )) as { rows: Array<{ key: string }> };

    expect(r.rows.map((row) => row.key)).toEqual(['EDGE']);
  });

  it('metadata dimension: rejects invalid field at the fetcher barrier', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'top_n_table',
          title: 'Bad',
          source: 'logs',
          dimension: 'metadata',
          metadataField: "bad'key",
          limit: 10,
          projectId,
          interval: '24h',
        },
        ctx(),
      ),
    ).rejects.toThrow(/Invalid top-n metadata field/);
  });

  it('metadata dimension: org isolation', async () => {
    await createTestLog({ projectId: otherProjectId, service: 'spy', level: 'info', metadata: { geo_place: 'FOREIGN' } });
    await createTestLog({ projectId, service: 'edge', level: 'info', metadata: { geo_place: 'MINE' } });

    const r = (await fetchPanelData(
      {
        type: 'top_n_table',
        title: 'Top places',
        source: 'logs',
        dimension: 'metadata',
        metadataField: 'geo_place',
        limit: 10,
        projectId: null,
        interval: '24h',
      },
      ctx(),
    )) as { rows: Array<{ key: string }> };

    expect(r.rows.map((row) => row.key)).toContain('MINE');
    expect(r.rows.map((row) => row.key)).not.toContain('FOREIGN');
  });

  it('tenancy: foreign projectId throws for metadata dimension', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'top_n_table',
          title: 'X',
          source: 'logs',
          dimension: 'metadata',
          metadataField: 'geo_place',
          limit: 5,
          projectId: otherProjectId,
          interval: '24h',
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });
});

// ─── live_log_stream ─────────────────────────────────────────────────────────

describe('live_log_stream panel', () => {
  it('happy path: returns recent logs for project', async () => {
    const r = (await fetchPanelData(
      {
        type: 'live_log_stream',
        title: 'Live',
        source: 'logs',
        projectId,
        service: null,
        levels: ['info', 'error', 'warn', 'debug', 'critical'],
        maxRows: 50,
      },
      ctx(),
    )) as { logs: Array<{ time: string; service: string; level: string; message: string; projectId: string }> };

    expect(Array.isArray(r.logs)).toBe(true);
    expect(r.logs.length).toBeGreaterThan(0);
    for (const log of r.logs) {
      expect(log.projectId).toBe(projectId);
    }
  });

  it('level filter: only returns matching levels', async () => {
    const r = (await fetchPanelData(
      {
        type: 'live_log_stream',
        title: 'Live errors',
        source: 'logs',
        projectId,
        service: null,
        levels: ['error'],
        maxRows: 50,
      },
      ctx(),
    )) as { logs: Array<{ level: string }> };

    for (const log of r.logs) {
      expect(log.level).toBe('error');
    }
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'live_log_stream',
          title: 'X',
          source: 'logs',
          projectId: otherProjectId,
          service: null,
          levels: ['info'],
          maxRows: 10,
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('empty: project with no logs returns empty array', async () => {
    const fresh = await createTestProject({ organizationId: orgId, userId });
    const r = (await fetchPanelData(
      {
        type: 'live_log_stream',
        title: 'Empty',
        source: 'logs',
        projectId: fresh.id,
        service: null,
        levels: ['info', 'error'],
        maxRows: 10,
      },
      ctx(),
    )) as { logs: unknown[] };

    expect(r.logs).toEqual([]);
  });

  it('org-wide with no projects returns empty logs', async () => {
    const emptyCtx = await createTestContext();
    await db.deleteFrom('api_keys').where('project_id', '=', emptyCtx.project.id).execute();
    await db.deleteFrom('projects').where('id', '=', emptyCtx.project.id).execute();

    const r = (await fetchPanelData(
      {
        type: 'live_log_stream',
        title: 'Org-wide',
        source: 'logs',
        projectId: null,
        service: null,
        levels: ['info'],
        maxRows: 10,
      },
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id },
    )) as { logs: unknown[] };

    expect(r.logs).toEqual([]);
  });
});

// ─── alert_status ────────────────────────────────────────────────────────────

describe('alert_status panel', () => {
  it('happy path: returns the seeded rule and history', async () => {
    const r = (await fetchPanelData(
      {
        type: 'alert_status',
        title: 'Alerts',
        source: 'alerts',
        projectId,
        ruleIds: [],
        showHistory: true,
        limit: 20,
      },
      ctx(),
    )) as {
      rules: Array<{ id: string; name: string; enabled: boolean; triggerCount24h: number; lastTriggeredAt: string | null }>;
      recentHistory: Array<{ id: string; ruleName: string; logCount: number }>;
    };

    expect(r.rules.some((r) => r.id === alertRuleId)).toBe(true);
    expect(r.recentHistory.length).toBeGreaterThan(0);
    const entry = r.recentHistory.find((h) => h.ruleName === 'High errors');
    expect(entry).toBeDefined();
    expect(entry!.logCount).toBe(5);
  });

  it('ruleIds filter: only listed rule returned', async () => {
    const r = (await fetchPanelData(
      {
        type: 'alert_status',
        title: 'Filtered',
        source: 'alerts',
        projectId,
        ruleIds: [alertRuleId],
        showHistory: false,
        limit: 5,
      },
      ctx(),
    )) as { rules: Array<{ id: string }>; recentHistory: Array<unknown> };

    expect(r.rules).toHaveLength(1);
    expect(r.rules[0].id).toBe(alertRuleId);
    expect(r.recentHistory).toHaveLength(0);
  });

  it('tenancy: org isolation, foreign org rules not visible', async () => {
    const r = (await fetchPanelData(
      {
        type: 'alert_status',
        title: 'Isolation',
        source: 'alerts',
        projectId: null,
        ruleIds: [],
        showHistory: true,
        limit: 100,
      },
      ctx(),
    )) as {
      rules: Array<{ name: string }>;
      recentHistory: Array<{ logCount: number }>;
    };

    expect(r.rules.every((r) => r.name !== 'Foreign rule')).toBe(true);
    expect(r.recentHistory.every((h) => h.logCount !== 99)).toBe(true);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'alert_status',
          title: 'X',
          source: 'alerts',
          projectId: otherProjectId,
          ruleIds: [],
          showHistory: false,
          limit: 5,
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('empty: fresh project returns zero rules', async () => {
    const fresh = await createTestProject({ organizationId: orgId, userId });
    const r = (await fetchPanelData(
      {
        type: 'alert_status',
        title: 'Empty',
        source: 'alerts',
        projectId: fresh.id,
        ruleIds: [],
        showHistory: true,
        limit: 10,
      },
      ctx(),
    )) as { rules: unknown[]; recentHistory: unknown[] };

    expect(r.rules).toHaveLength(0);
    expect(r.recentHistory).toHaveLength(0);
  });
});

// ─── metric_chart ────────────────────────────────────────────────────────────

describe('metric_chart panel', () => {
  it('happy path: returns series from mocked aggregation', async () => {
    const now = new Date();
    const bucket = new Date(now.getTime() - 10 * 60 * 1000);

    const spy = vi.spyOn(reservoir, 'aggregateMetrics').mockResolvedValueOnce({
      metricName: 'http_requests',
      metricType: 'sum',
      timeseries: [{ bucket, value: 42, labels: {} }],
      executionTimeMs: 1,
    } as Awaited<ReturnType<typeof reservoir.aggregateMetrics>>);

    const r = (await fetchPanelData(
      {
        type: 'metric_chart',
        title: 'Requests',
        source: 'metrics',
        projectId,
        metricName: 'http_requests',
        aggregation: 'sum',
        interval: '1h',
        timeRange: '24h',
        serviceName: null,
      },
      ctx(),
    )) as {
      metricName: string; metricType: string;
      series: Array<{ time: string; value: number }>; aggregation: string; interval: string;
    };

    spy.mockRestore();

    expect(r.metricName).toBe('http_requests');
    expect(r.aggregation).toBe('sum');
    expect(r.interval).toBe('1h');
    expect(r.series).toHaveLength(1);
    expect(r.series[0].value).toBe(42);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'metric_chart',
          title: 'X',
          source: 'metrics',
          projectId: otherProjectId,
          metricName: 'foo',
          aggregation: 'avg',
          interval: '1h',
          timeRange: '24h',
          serviceName: null,
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('empty: no projects -> empty series without throwing', async () => {
    const emptyCtx = await createTestContext();
    await db.deleteFrom('api_keys').where('project_id', '=', emptyCtx.project.id).execute();
    await db.deleteFrom('projects').where('id', '=', emptyCtx.project.id).execute();

    const r = (await fetchPanelData(
      {
        type: 'metric_chart',
        title: 'Empty',
        source: 'metrics',
        projectId: null,
        metricName: 'foo',
        aggregation: 'avg',
        interval: '1h',
        timeRange: '24h',
        serviceName: null,
      },
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id },
    )) as { series: unknown[]; metricName: string };

    expect(r.series).toEqual([]);
    expect(r.metricName).toBe('foo');
  });
});

// ─── metric_stat ─────────────────────────────────────────────────────────────

describe('metric_stat panel', () => {
  it('happy path: returns latest value from mocked aggregation', async () => {
    const now = new Date();
    const spy = vi.spyOn(reservoir, 'aggregateMetrics').mockResolvedValueOnce({
      metricName: 'cpu_usage',
      metricType: 'gauge',
      timeseries: [
        { bucket: new Date(now.getTime() - 3600_000), value: 0.5, labels: {} },
        { bucket: new Date(now.getTime() - 1800_000), value: 0.7, labels: {} },
      ],
      executionTimeMs: 1,
    } as Awaited<ReturnType<typeof reservoir.aggregateMetrics>>);

    const r = (await fetchPanelData(
      {
        type: 'metric_stat',
        title: 'CPU',
        source: 'metrics',
        projectId,
        metricName: 'cpu_usage',
        aggregation: 'avg',
        timeRange: '24h',
        serviceName: null,
        unit: '%',
      },
      ctx(),
    )) as { metricName: string; value: number | null; unit: string | null; aggregation: string };

    spy.mockRestore();

    expect(r.metricName).toBe('cpu_usage');
    expect(r.value).toBe(0.7); // latest non-null bucket
    expect(r.unit).toBe('%');
  });

  it('sums across all buckets for sum aggregation (no undercount)', async () => {
    const now = new Date();
    const spy = vi.spyOn(reservoir, 'aggregateMetrics').mockResolvedValueOnce({
      metricName: 'requests',
      metricType: 'counter',
      timeseries: [
        { bucket: new Date(now.getTime() - 3600_000), value: 100, labels: {} },
        { bucket: new Date(now.getTime() - 1800_000), value: 40, labels: {} },
      ],
      executionTimeMs: 1,
    } as Awaited<ReturnType<typeof reservoir.aggregateMetrics>>);

    const r = (await fetchPanelData(
      {
        type: 'metric_stat',
        title: 'Requests',
        source: 'metrics',
        projectId,
        metricName: 'requests',
        aggregation: 'sum',
        timeRange: '24h',
        serviceName: null,
        unit: null,
      },
      ctx(),
    )) as { value: number | null };

    spy.mockRestore();
    expect(r.value).toBe(140); // 100 + 40, not just the latest bucket
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'metric_stat',
          title: 'X',
          source: 'metrics',
          projectId: otherProjectId,
          metricName: 'foo',
          aggregation: 'avg',
          timeRange: '24h',
          serviceName: null,
          unit: null,
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('empty: no projects -> null value without throwing', async () => {
    const emptyCtx = await createTestContext();
    await db.deleteFrom('api_keys').where('project_id', '=', emptyCtx.project.id).execute();
    await db.deleteFrom('projects').where('id', '=', emptyCtx.project.id).execute();

    const r = (await fetchPanelData(
      {
        type: 'metric_stat',
        title: 'Empty',
        source: 'metrics',
        projectId: null,
        metricName: 'foo',
        aggregation: 'avg',
        timeRange: '1h',
        serviceName: null,
        unit: null,
      },
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id },
    )) as { value: null };

    expect(r.value).toBeNull();
  });
});

// ─── trace_latency ───────────────────────────────────────────────────────────

describe('trace_latency panel', () => {
  it('happy path: returns series array with correct field shapes', async () => {
    const r = (await fetchPanelData(
      {
        type: 'trace_latency',
        title: 'Latency',
        source: 'traces',
        projectId,
        serviceName: 'api',
        timeRange: '24h',
        showPercentiles: ['p50', 'p95', 'p99'],
      },
      ctx(),
    )) as {
      series: Array<{ time: string; p50: number | null; p95: number | null; p99: number | null; spanCount: number; errorRate: number }>;
      serviceName: string | null;
    };

    expect(r.serviceName).toBe('api');
    expect(Array.isArray(r.series)).toBe(true);
    for (const pt of r.series) {
      expect(typeof pt.time).toBe('string');
      expect(typeof pt.spanCount).toBe('number');
    }
  });

  it('7d timeRange uses daily bucket (> 48h)', async () => {
    // 7d path hits spans_daily_stats; should not throw even if cagg is empty
    const r = (await fetchPanelData(
      {
        type: 'trace_latency',
        title: 'Latency 7d',
        source: 'traces',
        projectId,
        serviceName: null,
        timeRange: '7d',
        showPercentiles: ['p50'],
      },
      ctx(),
    )) as { series: unknown[] };
    expect(Array.isArray(r.series)).toBe(true);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'trace_latency',
          title: 'X',
          source: 'traces',
          projectId: otherProjectId,
          serviceName: null,
          timeRange: '24h',
          showPercentiles: [],
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('empty: no projects -> empty series', async () => {
    const emptyCtx = await createTestContext();
    await db.deleteFrom('api_keys').where('project_id', '=', emptyCtx.project.id).execute();
    await db.deleteFrom('projects').where('id', '=', emptyCtx.project.id).execute();

    const r = (await fetchPanelData(
      {
        type: 'trace_latency',
        title: 'Empty',
        source: 'traces',
        projectId: null,
        serviceName: null,
        timeRange: '24h',
        showPercentiles: [],
      },
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id },
    )) as { series: unknown[] };

    expect(r.series).toEqual([]);
  });
});

// ─── trace_volume ────────────────────────────────────────────────────────────

describe('trace_volume panel', () => {
  it('happy path: returns series with correct fields', async () => {
    const r = (await fetchPanelData(
      {
        type: 'trace_volume',
        title: 'Volume',
        source: 'traces',
        projectId,
        serviceName: null,
        timeRange: '24h',
        showErrors: true,
      },
      ctx(),
    )) as {
      series: Array<{ time: string; total: number; errors: number }>;
      serviceName: null; timeRange: string; bucket: 'hour' | 'day';
    };

    expect(r.timeRange).toBe('24h');
    expect(r.bucket).toBe('hour'); // 24h <= 48h
    expect(Array.isArray(r.series)).toBe(true);
  });

  it('7d timeRange selects day bucket', async () => {
    const r = (await fetchPanelData(
      {
        type: 'trace_volume',
        title: 'Volume 7d',
        source: 'traces',
        projectId,
        serviceName: null,
        timeRange: '7d',
        showErrors: false,
      },
      ctx(),
    )) as { bucket: string };

    expect(r.bucket).toBe('day');
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'trace_volume',
          title: 'X',
          source: 'traces',
          projectId: otherProjectId,
          serviceName: null,
          timeRange: '24h',
          showErrors: false,
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('empty: no projects -> empty series', async () => {
    const emptyCtx = await createTestContext();
    await db.deleteFrom('api_keys').where('project_id', '=', emptyCtx.project.id).execute();
    await db.deleteFrom('projects').where('id', '=', emptyCtx.project.id).execute();

    const r = (await fetchPanelData(
      {
        type: 'trace_volume',
        title: 'Empty',
        source: 'traces',
        projectId: null,
        serviceName: null,
        timeRange: '24h',
        showErrors: false,
      },
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id },
    )) as { series: unknown[] };

    expect(r.series).toEqual([]);
  });
});

// ─── activity_overview (timescale path) ──────────────────────────────────────

describe('activity_overview panel (timescale path)', () => {
  it('happy path: 24h window returns hourly buckets', async () => {
    const r = (await fetchPanelData(
      {
        type: 'activity_overview',
        title: 'Activity',
        source: 'mixed',
        projectId,
        timeRange: '24h',
        series: ['logs', 'log_errors'],
      },
      ctx(),
    )) as {
      series: Array<{ time: string; logs: number; log_errors: number; spans: number; span_errors: number; detections: number; alerts: number }>;
      bucket: 'hour' | 'day'; timeRange: string; enabled: string[];
    };

    expect(r.bucket).toBe('hour');
    expect(r.timeRange).toBe('24h');
    expect(Array.isArray(r.series)).toBe(true);
    expect(r.series.length).toBeGreaterThanOrEqual(1);
    for (const b of r.series) {
      expect(typeof b.logs).toBe('number');
      expect(typeof b.log_errors).toBe('number');
    }
  });

  it('7d window uses day bucket', async () => {
    const r = (await fetchPanelData(
      {
        type: 'activity_overview',
        title: 'Activity',
        source: 'mixed',
        projectId,
        timeRange: '7d',
        series: ['logs'],
      },
      ctx(),
    )) as { bucket: string };

    expect(r.bucket).toBe('day');
  });

  it('spans series counts seeded spans', async () => {
    const r = (await fetchPanelData(
      {
        type: 'activity_overview',
        title: 'Activity',
        source: 'mixed',
        projectId,
        timeRange: '24h',
        series: ['spans', 'span_errors'],
      },
      ctx(),
    )) as { series: Array<{ spans: number; span_errors: number }> };

    const anySpans = r.series.some((s) => s.spans > 0);
    expect(anySpans).toBe(true);
    const anyErrors = r.series.some((s) => s.span_errors > 0);
    expect(anyErrors).toBe(true);
  });

  it('detections series counts detection events', async () => {
    const r = (await fetchPanelData(
      {
        type: 'activity_overview',
        title: 'Activity',
        source: 'mixed',
        projectId,
        timeRange: '24h',
        series: ['detections'],
      },
      ctx(),
    )) as { series: Array<{ detections: number }> };

    const total = r.series.reduce((s, b) => s + b.detections, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('alerts series counts alert history', async () => {
    const r = (await fetchPanelData(
      {
        type: 'activity_overview',
        title: 'Activity',
        source: 'mixed',
        projectId,
        timeRange: '24h',
        series: ['alerts'],
      },
      ctx(),
    )) as { series: Array<{ alerts: number }> };

    const total = r.series.reduce((s, b) => s + b.alerts, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'activity_overview',
          title: 'X',
          source: 'mixed',
          projectId: otherProjectId,
          timeRange: '24h',
          series: ['logs'],
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('empty: org with no projects returns all-zero series', async () => {
    const emptyCtx = await createTestContext();
    await db.deleteFrom('api_keys').where('project_id', '=', emptyCtx.project.id).execute();
    await db.deleteFrom('projects').where('id', '=', emptyCtx.project.id).execute();

    const r = (await fetchPanelData(
      {
        type: 'activity_overview',
        title: 'Empty',
        source: 'mixed',
        projectId: null,
        timeRange: '24h',
        series: ['logs', 'log_errors', 'spans', 'span_errors'],
      },
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id },
    )) as { series: Array<{ logs: number; spans: number }> };

    expect(r.series.every((s) => s.logs === 0 && s.spans === 0)).toBe(true);
  });
});

// ─── detection_events ────────────────────────────────────────────────────────

describe('detection_events panel', () => {
  it('happy path: totalDetections includes seeded event', async () => {
    const r = (await fetchPanelData(
      {
        type: 'detection_events',
        title: 'Detections',
        source: 'detections',
        projectId,
        timeRange: '24h',
        severities: [],
      },
      ctx(),
    )) as {
      series: Array<{ time: string; count: number }>;
      totalDetections: number;
      bySeverity: Array<{ severity: string; count: number }>;
    };

    expect(r.totalDetections).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(r.series)).toBe(true);
    expect(Array.isArray(r.bySeverity)).toBe(true);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'detection_events',
          title: 'X',
          source: 'detections',
          projectId: otherProjectId,
          timeRange: '24h',
          severities: [],
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('org isolation: other org detections not included', async () => {
    // Seed a 'critical' detection in the other org
    const otherSigma = await db
      .insertInto('sigma_rules')
      .values({
        organization_id: otherOrgId,
        project_id: otherProjectId,
        sigma_id: `sigma-other-${Date.now()}`,
        title: 'Other Rule',
        description: '',
        level: 'low',
        status: 'stable',
        logsource: { product: 'linux' },
        detection: { selection: {}, condition: 'selection' },
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

    const otherLog = await db
      .selectFrom('logs')
      .select('id')
      .where('project_id', '=', otherProjectId)
      .executeTakeFirstOrThrow();

    await siemService.createDetectionEvent({
      organizationId: otherOrgId,
      projectId: otherProjectId,
      sigmaRuleId: otherSigma.id,
      logId: otherLog.id,
      severity: 'critical',
      ruleTitle: 'Other Rule',
      service: 'spy',
      logLevel: 'error',
      logMessage: 'spy event',
    });

    // Primary org query should NOT see the critical from other org
    const r = (await fetchPanelData(
      {
        type: 'detection_events',
        title: 'Isolated',
        source: 'detections',
        projectId: null,
        timeRange: '24h',
        severities: [],
      },
      ctx(),
    )) as { bySeverity: Array<{ severity: string; count: number }> };

    // Our primary org only has 'high' severity; 'critical' belongs to other org
    const criticalInPrimary = r.bySeverity.find((b) => b.severity === 'critical');
    expect(criticalInPrimary?.count ?? 0).toBe(0);
  });

  it('empty: new org returns zero detections', async () => {
    const freshCtx = await createTestContext();

    const r = (await fetchPanelData(
      {
        type: 'detection_events',
        title: 'Empty',
        source: 'detections',
        projectId: null,
        timeRange: '24h',
        severities: [],
      },
      { organizationId: freshCtx.organization.id, userId: freshCtx.user.id },
    )) as { totalDetections: number };

    expect(r.totalDetections).toBe(0);
  });
});

// ─── monitor_status ───────────────────────────────────────────────────────────

describe('monitor_status panel', () => {
  it('happy path: returns the seeded monitor with correct status', async () => {
    const r = (await fetchPanelData(
      {
        type: 'monitor_status',
        title: 'Monitors',
        source: 'monitors',
        projectId: null,
        monitorIds: [],
        limit: 20,
      },
      ctx(),
    )) as {
      monitors: Array<{ id: string; name: string; status: string | null; enabled: boolean; severity: string }>;
      totalUp: number; totalDown: number; totalUnknown: number;
    };

    const found = r.monitors.find((m) => m.id === monitorId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('API Check');
    expect(found!.status).toBe('up');
    expect(r.totalUp).toBeGreaterThanOrEqual(1);
  });

  it('monitorIds filter: only listed monitor returned', async () => {
    const r = (await fetchPanelData(
      {
        type: 'monitor_status',
        title: 'Filtered',
        source: 'monitors',
        projectId: null,
        monitorIds: [monitorId],
        limit: 20,
      },
      ctx(),
    )) as { monitors: Array<{ id: string }> };

    expect(r.monitors).toHaveLength(1);
    expect(r.monitors[0].id).toBe(monitorId);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'monitor_status',
          title: 'X',
          source: 'monitors',
          projectId: otherProjectId,
          monitorIds: [],
          limit: 5,
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('org isolation: other org monitors NOT returned', async () => {
    const r = (await fetchPanelData(
      {
        type: 'monitor_status',
        title: 'Isolation',
        source: 'monitors',
        projectId: null,
        monitorIds: [],
        limit: 100,
      },
      ctx(),
    )) as { monitors: Array<{ name: string }> };

    expect(r.monitors.every((m) => m.name !== 'Foreign Monitor')).toBe(true);
  });

  it('empty: fresh org returns zero monitors', async () => {
    const freshCtx = await createTestContext();

    const r = (await fetchPanelData(
      {
        type: 'monitor_status',
        title: 'Empty',
        source: 'monitors',
        projectId: null,
        monitorIds: [],
        limit: 10,
      },
      { organizationId: freshCtx.organization.id, userId: freshCtx.user.id },
    )) as { monitors: unknown[]; totalUp: number; totalDown: number; totalUnknown: number };

    expect(r.monitors).toHaveLength(0);
    expect(r.totalUp).toBe(0);
    expect(r.totalDown).toBe(0);
    expect(r.totalUnknown).toBe(0);
  });
});

// ─── system_status ────────────────────────────────────────────────────────────

describe('system_status panel', () => {
  it('happy path: operational when all monitors are up', async () => {
    const r = (await fetchPanelData(
      {
        type: 'system_status',
        title: 'Status',
        source: 'monitors',
        projectId: null,
        showCounts: true,
      },
      ctx(),
    )) as { overallStatus: string; totalMonitors: number; upCount: number; downCount: number; unknownCount: number };

    expect(r.overallStatus).toBe('operational');
    expect(r.totalMonitors).toBeGreaterThanOrEqual(1);
    expect(r.upCount).toBeGreaterThanOrEqual(1);
    expect(r.downCount).toBe(0);
  });

  it('tenancy: foreign projectId throws', async () => {
    await expect(
      fetchPanelData(
        {
          type: 'system_status',
          title: 'X',
          source: 'monitors',
          projectId: otherProjectId,
          showCounts: false,
        },
        ctx(),
      ),
    ).rejects.toThrow(/belong/);
  });

  it('no_monitors status when fresh org has no monitors', async () => {
    const freshCtx = await createTestContext();

    const r = (await fetchPanelData(
      {
        type: 'system_status',
        title: 'Empty',
        source: 'monitors',
        projectId: null,
        showCounts: false,
      },
      { organizationId: freshCtx.organization.id, userId: freshCtx.user.id },
    )) as { overallStatus: string; totalMonitors: number };

    expect(r.overallStatus).toBe('no_monitors');
    expect(r.totalMonitors).toBe(0);
  });

  it('outage status when all monitors are down', async () => {
    const freshCtx = await createTestContext();
    const ms = new MonitorService(db);

    const m1 = await ms.createMonitor({ organizationId: freshCtx.organization.id, projectId: freshCtx.project.id, name: 'D1', type: 'heartbeat', intervalSeconds: 60 });
    const m2 = await ms.createMonitor({ organizationId: freshCtx.organization.id, projectId: freshCtx.project.id, name: 'D2', type: 'heartbeat', intervalSeconds: 60 });

    for (const mId of [m1.id, m2.id]) {
      await db.updateTable('monitor_status').set({ status: 'down', consecutive_failures: 3, consecutive_successes: 0, last_checked_at: new Date(), response_time_ms: null }).where('monitor_id', '=', mId).execute();
    }

    const r = (await fetchPanelData(
      { type: 'system_status', title: 'Outage', source: 'monitors', projectId: null, showCounts: true },
      { organizationId: freshCtx.organization.id, userId: freshCtx.user.id },
    )) as { overallStatus: string };

    expect(r.overallStatus).toBe('outage');
  });

  it('degraded status when some monitors are down', async () => {
    const freshCtx = await createTestContext();
    const ms = new MonitorService(db);

    const mUp = await ms.createMonitor({ organizationId: freshCtx.organization.id, projectId: freshCtx.project.id, name: 'Up', type: 'heartbeat', intervalSeconds: 60 });
    const mDown = await ms.createMonitor({ organizationId: freshCtx.organization.id, projectId: freshCtx.project.id, name: 'Down', type: 'heartbeat', intervalSeconds: 60 });

    await db.updateTable('monitor_status').set({ status: 'up', consecutive_failures: 0, consecutive_successes: 1, last_checked_at: new Date(), response_time_ms: 10 }).where('monitor_id', '=', mUp.id).execute();
    await db.updateTable('monitor_status').set({ status: 'down', consecutive_failures: 2, consecutive_successes: 0, last_checked_at: new Date(), response_time_ms: null }).where('monitor_id', '=', mDown.id).execute();

    const r = (await fetchPanelData(
      { type: 'system_status', title: 'Degraded', source: 'monitors', projectId: null, showCounts: true },
      { organizationId: freshCtx.organization.id, userId: freshCtx.user.id },
    )) as { overallStatus: string };

    expect(r.overallStatus).toBe('degraded');
  });
});
