import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MonitorService } from '../../../modules/monitoring/service.js';
import { createTestContext } from '../../helpers/index.js';
import { db } from '../../../database/index.js';
import { monitorNotificationQueue } from '../../../queue/jobs/monitor-notification.js';
import { insertIncident } from '../incidents/fixtures.js';
import { notificationChannelsService } from '../../../modules/notification-channels/index.js';

// F4 seam: the shared incidents service is mocked (its own suite covers it)
const { openOrUpdateFromSource, resolveFromSource } = vi.hoisted(() => ({
  openOrUpdateFromSource: vi.fn(),
  resolveFromSource: vi.fn(),
}));
vi.mock('../../../modules/incidents/service.js', () => ({
  incidentsService: { openOrUpdateFromSource, resolveFromSource },
}));

// Mock the notification queue to avoid real BullMQ connections
vi.mock('../../../queue/jobs/monitor-notification.js', () => ({
  monitorNotificationQueue: {
    add: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock maintenanceService
vi.mock('../../../modules/maintenances/service.js', () => ({
  maintenanceService: {
    getProjectsUnderMaintenance: vi.fn().mockResolvedValue(new Set()),
  },
}));

// Mock checker functions
vi.mock('../../../modules/monitoring/checker.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    runHttpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null }),
    runTcpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 10, statusCode: null, errorCode: null }),
    runHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
    runLogHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
    runSslCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 30, statusCode: null, errorCode: null }),
    runDnsCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 5, statusCode: null, errorCode: null }),
    parseTcpTarget: vi.fn().mockReturnValue({ host: 'localhost', port: 5432 }),
    // pure helpers stay real so target validation is exercised
    parseHostPort: actual.parseHostPort,
    isValidDnsHostname: actual.isValidDnsHostname,
  };
});

// Mock reservoir
vi.mock('../../../database/reservoir.js', () => ({
  reservoir: {},
}));

let service: MonitorService;
let ctx: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  service = new MonitorService(db);
  ctx = await createTestContext();
});

describe('MonitorService.createMonitor', () => {
  it('creates an HTTP monitor', async () => {
    const monitor = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'API Health',
      type: 'http',
      target: 'https://example.com/health',
      intervalSeconds: 60,
      timeoutSeconds: 10,
      severity: 'high',
    });

    expect(monitor.id).toBeDefined();
    expect(monitor.name).toBe('API Health');
    expect(monitor.type).toBe('http');
    expect(monitor.target).toBe('https://example.com/health');
    expect(monitor.enabled).toBe(true);
    // status is populated by getMonitor (which does the JOIN), not createMonitor
    const fetched = await service.getMonitor(monitor.id, ctx.organization.id);
    expect(fetched!.status).toBeDefined();
  });

  it('creates a heartbeat monitor', async () => {
    const monitor = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Cron Heartbeat',
      type: 'heartbeat',
      intervalSeconds: 300,
    });

    expect(monitor.type).toBe('heartbeat');
    expect(monitor.target).toBeNull();
  });

  it('creates a TCP monitor', async () => {
    const monitor = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'DB Port',
      type: 'tcp',
      target: 'localhost:5432',
    });

    expect(monitor.type).toBe('tcp');
    expect(monitor.target).toBe('localhost:5432');
  });

  it('creates a log_heartbeat monitor', async () => {
    const monitor = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Service Heartbeat',
      type: 'log_heartbeat',
      target: 'my-service',
      gracePeriodSeconds: 120,
    });

    expect(monitor.type).toBe('log_heartbeat');
    expect(monitor.gracePeriodSeconds).toBe(120);
  });
});

describe('MonitorService.listMonitors', () => {
  it('lists monitors for an organization', async () => {
    await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'M1',
      type: 'heartbeat',
    });
    await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'M2',
      type: 'heartbeat',
    });

    const monitors = await service.listMonitors(ctx.organization.id);
    expect(monitors.length).toBe(2);
  });

  it('filters by projectId', async () => {
    const { createTestProject } = await import('../../helpers/factories.js');
    const otherProject = await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id });

    await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Project 1 monitor',
      type: 'heartbeat',
    });
    await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: otherProject.id,
      name: 'Project 2 monitor',
      type: 'heartbeat',
    });

    const monitors = await service.listMonitors(ctx.organization.id, ctx.project.id);
    expect(monitors.length).toBe(1);
    expect(monitors[0].name).toBe('Project 1 monitor');
  });

  it('returns empty array when no monitors', async () => {
    const monitors = await service.listMonitors(ctx.organization.id);
    expect(monitors).toHaveLength(0);
  });
});

describe('MonitorService.getMonitor', () => {
  it('returns monitor by id', async () => {
    const created = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Find me',
      type: 'http',
      target: 'https://example.com',
    });

    const found = await service.getMonitor(created.id, ctx.organization.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Find me');
  });

  it('returns null for unknown id', async () => {
    const found = await service.getMonitor('00000000-0000-0000-0000-000000000000', ctx.organization.id);
    expect(found).toBeNull();
  });

  it('does not return monitors from other organizations', async () => {
    const { createTestOrganization } = await import('../../helpers/factories.js');
    const otherOrg = await createTestOrganization({ ownerId: ctx.user.id });
    const { createTestProject } = await import('../../helpers/factories.js');
    const otherProject = await createTestProject({ organizationId: otherOrg.id, userId: ctx.user.id });

    const monitor = await service.createMonitor({
      organizationId: otherOrg.id,
      projectId: otherProject.id,
      name: 'Other org',
      type: 'heartbeat',
    });

    const found = await service.getMonitor(monitor.id, ctx.organization.id);
    expect(found).toBeNull();
  });
});

describe('MonitorService.updateMonitor', () => {
  it('updates monitor name and interval', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Old name',
      type: 'heartbeat',
      intervalSeconds: 60,
    });

    const updated = await service.updateMonitor(m.id, ctx.organization.id, {
      name: 'New name',
      intervalSeconds: 120,
    });

    expect(updated!.name).toBe('New name');
    expect(updated!.intervalSeconds).toBe(120);
  });

  it('returns null for unknown monitor', async () => {
    const result = await service.updateMonitor(
      '00000000-0000-0000-0000-000000000000',
      ctx.organization.id,
      { name: 'x' }
    );
    expect(result).toBeNull();
  });

  it('can disable a monitor', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Toggle',
      type: 'heartbeat',
    });

    const updated = await service.updateMonitor(m.id, ctx.organization.id, { enabled: false });
    expect(updated!.enabled).toBe(false);
  });
});

describe('MonitorService.deleteMonitor', () => {
  it('deletes a monitor', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Delete me',
      type: 'heartbeat',
    });

    await service.deleteMonitor(m.id, ctx.organization.id);

    const found = await service.getMonitor(m.id, ctx.organization.id);
    expect(found).toBeNull();
  });
});

describe('MonitorService.recordHeartbeat', () => {
  it('records a heartbeat ping', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Heartbeat',
      type: 'heartbeat',
    });

    await expect(service.recordHeartbeat(m.id, ctx.organization.id)).resolves.not.toThrow();

    const results = await service.getRecentResults(m.id, ctx.organization.id);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].isHeartbeat).toBe(true);
    expect(results[0].status).toBe('up');
  });

  it('throws for non-existent or non-heartbeat monitor', async () => {
    await expect(
      service.recordHeartbeat('00000000-0000-0000-0000-000000000000', ctx.organization.id)
    ).rejects.toThrow();
  });

  it('throws for disabled monitor', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Disabled',
      type: 'heartbeat',
      enabled: false,
    });

    await expect(service.recordHeartbeat(m.id, ctx.organization.id)).rejects.toThrow();
  });
});

describe('MonitorService.getRecentResults', () => {
  it('returns recent results ordered by time desc', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Results monitor',
      type: 'heartbeat',
    });

    await service.recordHeartbeat(m.id, ctx.organization.id);
    await service.recordHeartbeat(m.id, ctx.organization.id);

    const results = await service.getRecentResults(m.id, ctx.organization.id, 10);
    expect(results.length).toBe(2);
    expect(results[0].time >= results[1].time).toBe(true);
  });

  it('respects the limit parameter', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Limited',
      type: 'heartbeat',
    });

    for (let i = 0; i < 5; i++) {
      await service.recordHeartbeat(m.id, ctx.organization.id);
    }

    const results = await service.getRecentResults(m.id, ctx.organization.id, 3);
    expect(results.length).toBe(3);
  });

  it('returns empty for monitor with no results', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Empty',
      type: 'heartbeat',
    });

    const results = await service.getRecentResults(m.id, ctx.organization.id);
    expect(results).toHaveLength(0);
  });
});

describe('MonitorService.getUptimeHistory', () => {
  it('returns empty array when no data', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Uptime',
      type: 'heartbeat',
    });

    const history = await service.getUptimeHistory(m.id, ctx.organization.id, 90);
    expect(history).toEqual([]);
  });
});

describe('MonitorService.runCheck', () => {
  it('runs HTTP check and records result', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'HTTP check',
      type: 'http',
      target: 'https://example.com',
    });

    await expect(service.runCheck(m)).resolves.not.toThrow();

    const results = await service.getRecentResults(m.id, ctx.organization.id);
    expect(results.length).toBeGreaterThan(0);
  });

  it('runs heartbeat check (skips writing up results)', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'HB check',
      type: 'heartbeat',
    });

    await expect(service.runCheck(m)).resolves.not.toThrow();
    // Heartbeat 'up' results are NOT written by runCheck
    const results = await service.getRecentResults(m.id, ctx.organization.id);
    expect(results).toHaveLength(0);
  });
});

describe('MonitorService.runCheck - down/recovery paths', () => {
  it('records a down result and updates monitor status', async () => {
    const { runHttpCheck } = await import('../../../modules/monitoring/checker.js');
    vi.mocked(runHttpCheck).mockResolvedValueOnce({ status: 'down', responseTimeMs: null, statusCode: 503, errorCode: 'http_error' });

    const created = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Down check',
      type: 'http',
      target: 'https://example.com',
      failureThreshold: 1,
    });
    // createMonitor doesn't join monitor_status; fetch full monitor with status
    const m = (await service.getMonitor(created.id, ctx.organization.id))!;

    await service.runCheck(m);

    const results = await service.getRecentResults(m.id, ctx.organization.id);
    expect(results[0].status).toBe('down');

    const updated = await service.getMonitor(m.id, ctx.organization.id);
    expect(updated!.status!.status).toBe('down');
  });

  it('records a recovery after being down', async () => {
    const { runHttpCheck } = await import('../../../modules/monitoring/checker.js');

    const created = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Recovery check',
      type: 'http',
      target: 'https://example.com',
      failureThreshold: 1,
    });
    const m = (await service.getMonitor(created.id, ctx.organization.id))!;

    // First: go down
    vi.mocked(runHttpCheck).mockResolvedValueOnce({ status: 'down', responseTimeMs: null, statusCode: 503, errorCode: 'http_error' });
    await service.runCheck(m);

    // Second: recover (read monitor again to get updated status)
    const downMonitor = await service.getMonitor(m.id, ctx.organization.id);
    vi.mocked(runHttpCheck).mockResolvedValueOnce({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null });
    await service.runCheck(downMonitor!);

    const recovered = await service.getMonitor(m.id, ctx.organization.id);
    expect(recovered!.status!.status).toBe('up');
  });

  it('handles tcp check down result', async () => {
    const { runTcpCheck } = await import('../../../modules/monitoring/checker.js');
    vi.mocked(runTcpCheck).mockResolvedValueOnce({ status: 'down', responseTimeMs: null, statusCode: null, errorCode: 'connection_refused' });

    const created = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'TCP down',
      type: 'tcp',
      target: 'localhost:9999',
      failureThreshold: 1,
    });
    const m = (await service.getMonitor(created.id, ctx.organization.id))!;

    await service.runCheck(m);

    const updated = await service.getMonitor(m.id, ctx.organization.id);
    expect(updated!.status!.status).toBe('down');
  });

  it('records recovery with minutes-ago downtime', async () => {
    const { runHttpCheck } = await import('../../../modules/monitoring/checker.js');

    const created = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Recovery minutes',
      type: 'http',
      target: 'https://example.com',
      failureThreshold: 1,
    });

    // Manually set lastStatusChangeAt to 2 minutes ago to trigger minutes duration
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await db
      .updateTable('monitor_status')
      .set({ status: 'down', last_status_change_at: twoMinutesAgo, consecutive_failures: 1 })
      .where('monitor_id', '=', created.id)
      .execute();

    const m = (await service.getMonitor(created.id, ctx.organization.id))!;
    vi.mocked(runHttpCheck).mockResolvedValueOnce({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null });
    await service.runCheck(m);

    const recovered = await service.getMonitor(m.id, ctx.organization.id);
    expect(recovered!.status!.status).toBe('up');
  });

  it('records recovery with hours-ago downtime', async () => {
    const { runHttpCheck } = await import('../../../modules/monitoring/checker.js');

    const created = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Recovery hours',
      type: 'http',
      target: 'https://example.com',
      failureThreshold: 1,
    });

    // Set lastStatusChangeAt to 2 hours ago to trigger hours duration
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await db
      .updateTable('monitor_status')
      .set({ status: 'down', last_status_change_at: twoHoursAgo, consecutive_failures: 1 })
      .where('monitor_id', '=', created.id)
      .execute();

    const m = (await service.getMonitor(created.id, ctx.organization.id))!;
    vi.mocked(runHttpCheck).mockResolvedValueOnce({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null });
    await service.runCheck(m);

    const recovered = await service.getMonitor(m.id, ctx.organization.id);
    expect(recovered!.status!.status).toBe('up');
  });
});

describe('MonitorService.runAllDueChecks', () => {
  it('runs checks for due monitors', async () => {
    await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Due HTTP',
      type: 'http',
      target: 'https://example.com',
      intervalSeconds: 60,
    });

    await expect(service.runAllDueChecks()).resolves.not.toThrow();
  });

  it('recovers when monitor has no status object', async () => {
    const monitor = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'No Status',
      type: 'http',
      target: 'https://example.com',
      intervalSeconds: 60,
    });

    // Delete the status row so that processCheckResult must re-read or re-create it
    await db.deleteFrom('monitor_status').where('monitor_id', '=', monitor.id).execute();

    // Call runCheck with a monitor that has status: undefined to trigger the recovery path
    const monitorWithoutStatus = { ...monitor, status: undefined };
    await expect(service.runCheck(monitorWithoutStatus)).resolves.not.toThrow();

    // Verify status row was recreated
    const statusRow = await db
      .selectFrom('monitor_status')
      .selectAll()
      .where('monitor_id', '=', monitor.id)
      .executeTakeFirst();
    expect(statusRow).toBeDefined();
  });

  it('recovers when monitor_status row exists in DB but not preloaded', async () => {
    const monitor = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Status Exists',
      type: 'http',
      target: 'https://example.com',
      intervalSeconds: 60,
    });

    // Status row exists in DB but we pass a monitor without preloaded status
    const monitorWithoutStatus = { ...monitor, status: undefined };
    await expect(service.runCheck(monitorWithoutStatus)).resolves.not.toThrow();
  });

  it('skips monitors whose projects are under maintenance', async () => {
    const { maintenanceService } = await import('../../../modules/maintenances/service.js');
    vi.mocked(maintenanceService.getProjectsUnderMaintenance).mockResolvedValueOnce(
      new Set([ctx.project.id])
    );

    await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Skipped',
      type: 'http',
      target: 'https://example.com',
    });

    await expect(service.runAllDueChecks()).resolves.not.toThrow();
    // Monitor should not have been checked
    const monitors = await service.listMonitors(ctx.organization.id);
    expect(monitors[0].status?.lastCheckedAt).toBeNull();
  });
});

describe('MonitorService ssl and dns (W12)', () => {
  it('runCheck stores ssl detail in monitor_status.detail', async () => {
    const checker = await import('../../../modules/monitoring/checker.js');
    const detail = { expiresAt: '2030-01-01T00:00:00.000Z', daysRemaining: 40, issuer: 'Test CA', subject: 'example.com' };
    vi.mocked(checker.runSslCheck).mockResolvedValueOnce({
      status: 'up',
      responseTimeMs: 42,
      statusCode: null,
      errorCode: null,
      detail,
    });

    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Cert',
      type: 'ssl',
      target: 'example.com:8443',
      checkConfig: { warnDays: 21 },
    });
    await service.runCheck(m);

    expect(checker.runSslCheck).toHaveBeenLastCalledWith('example.com', 8443, m.timeoutSeconds, 21, expect.any(Boolean));
    const fetched = await service.getMonitor(m.id, ctx.organization.id);
    expect(fetched!.status!.detail).toEqual(detail);
    expect(fetched!.checkConfig).toEqual({ warnDays: 21 });
  });

  it('clears the stored detail when a later check returns none', async () => {
    const checker = await import('../../../modules/monitoring/checker.js');
    vi.mocked(checker.runSslCheck).mockResolvedValueOnce({
      status: 'up', responseTimeMs: 1, statusCode: null, errorCode: null, detail: { daysRemaining: 5 },
    });
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Cert 2',
      type: 'ssl',
      target: 'example.com',
    });
    await service.runCheck(m);
    vi.mocked(checker.runSslCheck).mockResolvedValueOnce({
      status: 'down', responseTimeMs: 1, statusCode: null, errorCode: 'timeout',
    });
    await service.runCheck((await service.getMonitor(m.id, ctx.organization.id))!);
    const fetched = await service.getMonitor(m.id, ctx.organization.id);
    expect(fetched!.status!.detail).toBeNull();
  });

  it('runCheck dispatches dns monitors to runDnsCheck with the stored checkConfig', async () => {
    const checker = await import('../../../modules/monitoring/checker.js');
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'MX record',
      type: 'dns',
      target: 'example.com',
      checkConfig: { recordType: 'MX', expectedValue: 'mx.example.com' },
    });
    await service.runCheck(m);
    expect(checker.runDnsCheck).toHaveBeenLastCalledWith('example.com', 'MX', 'mx.example.com', m.timeoutSeconds);
  });

  it('maps display fields on create, list and update', async () => {
    const m = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'Raw name',
      type: 'heartbeat',
      displayName: 'Pretty name',
      groupName: 'Core',
      displayOrder: 2,
    });
    expect(m).toMatchObject({ displayName: 'Pretty name', groupName: 'Core', displayOrder: 2 });

    const updated = await service.updateMonitor(m.id, ctx.organization.id, { displayName: null, displayOrder: 5 });
    expect(updated!.displayName).toBeNull();
    expect(updated!.displayOrder).toBe(5);
    expect(updated!.groupName).toBe('Core');

    const list = await service.listMonitors(ctx.organization.id);
    expect(list[0].groupName).toBe('Core');
  });
});

// ===========================================================================
// W12: monitors open and resolve shared incidents (F4 seam)
// ===========================================================================
describe('MonitorService incidents (W12)', () => {
  let checker: typeof import('../../../modules/monitoring/checker.js');

  beforeEach(async () => {
    checker = await import('../../../modules/monitoring/checker.js');
    vi.mocked(checker.runHttpCheck).mockReset();
    vi.mocked(checker.runHttpCheck).mockResolvedValue({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null });
    openOrUpdateFromSource.mockReset();
    resolveFromSource.mockReset().mockResolvedValue(null);
    vi.mocked(monitorNotificationQueue.add).mockClear();
  });

  async function makeMonitor(overrides: Record<string, unknown> = {}) {
    const created = await service.createMonitor({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      name: 'API Health',
      type: 'http',
      target: 'https://example.com/health',
      failureThreshold: 1,
      severity: 'critical',
      ...overrides,
    });
    return created;
  }

  async function runWith(monitorId: string, status: 'up' | 'down') {
    vi.mocked(checker.runHttpCheck).mockResolvedValueOnce(
      status === 'down'
        ? { status: 'down', responseTimeMs: 120, statusCode: 503, errorCode: 'http_error' }
        : { status: 'up', responseTimeMs: 40, statusCode: 200, errorCode: null }
    );
    const m = (await service.getMonitor(monitorId, ctx.organization.id))!;
    await service.runCheck(m);
    return (await service.getMonitor(monitorId, ctx.organization.id))!;
  }

  async function realIncident(monitorId: string, status: 'open' | 'resolved' = 'open') {
    return insertIncident({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      source: 'monitor',
      monitorId,
      status,
    });
  }

  const queueCalls = (name: string) =>
    vi.mocked(monitorNotificationQueue.add).mock.calls.filter((c) => c[0] === name);

  it('opens a monitor incident when the failure threshold is reached', async () => {
    const m = await makeMonitor({ failureThreshold: 2 });
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });

    await runWith(m.id, 'down');
    expect(openOrUpdateFromSource).not.toHaveBeenCalled();
    await runWith(m.id, 'down');

    expect(openOrUpdateFromSource).toHaveBeenCalledTimes(1);
    expect(openOrUpdateFromSource).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        source: 'monitor',
        sourceId: m.id,
        severity: 'critical',
        title: 'Monitor down: API Health',
        occurredAt: expect.any(Date),
        metadata: expect.objectContaining({
          monitorId: m.id,
          monitorName: 'API Health',
          monitorType: 'http',
          target: 'https://example.com/health',
          errorCode: 'http_error',
          statusCode: 503,
          responseTimeMs: 120,
          consecutiveFailures: 2,
          link: `/dashboard/uptime/${m.id}`,
        }),
      })
    );
  });

  it('stores the incident id in monitor_status and passes it to the notification queue', async () => {
    const m = await makeMonitor();
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });

    const after = await runWith(m.id, 'down');

    expect(after.status!.incidentId).toBe(incident.id);
    expect(queueCalls('monitor-down')).toHaveLength(1);
    expect(queueCalls('monitor-down')[0][1]).toMatchObject({ monitorId: m.id, incidentId: incident.id });
  });

  it('does not open an incident before the threshold (threshold 3, one failure)', async () => {
    const m = await makeMonitor({ failureThreshold: 3 });
    await runWith(m.id, 'down');
    expect(openOrUpdateFromSource).not.toHaveBeenCalled();
    expect(queueCalls('monitor-down')).toHaveLength(0);
  });

  it('does not open a second incident on further failures', async () => {
    const m = await makeMonitor();
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });

    await runWith(m.id, 'down');
    await runWith(m.id, 'down');
    await runWith(m.id, 'down');

    expect(openOrUpdateFromSource).toHaveBeenCalledTimes(1);
    expect(queueCalls('monitor-down')).toHaveLength(1);
  });

  it('uses displayName in the title when set', async () => {
    const m = await makeMonitor({ displayName: 'Public API' });
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });

    await runWith(m.id, 'down');

    expect(openOrUpdateFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Monitor down: Public API' })
    );
  });

  it('resolves on recovery when autoResolve is true (reason recovered) and clears incident_id', async () => {
    const m = await makeMonitor({ autoResolve: true });
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });

    await runWith(m.id, 'down');
    const after = await runWith(m.id, 'up');

    expect(resolveFromSource).toHaveBeenCalledTimes(1);
    expect(resolveFromSource).toHaveBeenCalledWith({
      organizationId: ctx.organization.id,
      source: 'monitor',
      sourceId: m.id,
      resolvedAt: expect.any(Date),
      reason: 'recovered',
    });
    expect(after.status!.incidentId).toBeNull();
    expect(queueCalls('monitor-recovered')).toHaveLength(1);
  });

  it('keeps the incident open and incident_id when autoResolve is false but still queues the recovery notification', async () => {
    const m = await makeMonitor({ autoResolve: false });
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });

    await runWith(m.id, 'down');
    const after = await runWith(m.id, 'up');

    expect(resolveFromSource).not.toHaveBeenCalled();
    expect(after.status!.incidentId).toBe(incident.id);
    expect(queueCalls('monitor-recovered')).toHaveLength(1);
    expect(queueCalls('monitor-recovered')[0][1]).toMatchObject({ incidentId: incident.id });
  });

  it('does not queue a recovery notification or resolve when the threshold was never reached', async () => {
    const m = await makeMonitor({ failureThreshold: 3 });

    await runWith(m.id, 'down');
    const after = await runWith(m.id, 'up');

    expect(after.status!.status).toBe('up');
    expect(queueCalls('monitor-recovered')).toHaveLength(0);
    expect(resolveFromSource).not.toHaveBeenCalled();
    expect(openOrUpdateFromSource).not.toHaveBeenCalled();
  });

  it('a rejecting incidents service does not stop the state machine', async () => {
    const m = await makeMonitor();
    openOrUpdateFromSource.mockRejectedValue(new Error('incident service down'));

    const after = await runWith(m.id, 'down');

    expect(after.status!.status).toBe('down');
    expect(after.status!.incidentId).toBeNull();
    expect(queueCalls('monitor-down')).toHaveLength(1);
    expect(queueCalls('monitor-down')[0][1]).toMatchObject({ incidentId: null });
  });

  it('a rejecting resolve keeps the incident id and still marks the monitor up', async () => {
    const m = await makeMonitor();
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });
    resolveFromSource.mockRejectedValue(new Error('incident service down'));

    await runWith(m.id, 'down');
    const after = await runWith(m.id, 'up');

    expect(after.status!.status).toBe('up');
    expect(after.status!.incidentId).toBe(incident.id);
    expect(queueCalls('monitor-recovered')).toHaveLength(1);
  });

  it('deleting a monitor with an open incident resolves it with reason manual', async () => {
    const m = await makeMonitor();
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });
    await runWith(m.id, 'down');

    await service.deleteMonitor(m.id, ctx.organization.id);

    expect(resolveFromSource).toHaveBeenCalledWith({
      organizationId: ctx.organization.id,
      source: 'monitor',
      sourceId: m.id,
      resolvedAt: expect.any(Date),
      reason: 'manual',
    });
    expect(await service.getMonitor(m.id, ctx.organization.id)).toBeNull();
  });

  it('deleting a monitor of another organization resolves nothing and deletes nothing', async () => {
    const m = await makeMonitor();
    const other = await createTestContext();

    await service.deleteMonitor(m.id, other.organization.id);

    expect(resolveFromSource).not.toHaveBeenCalled();
    expect(await service.getMonitor(m.id, ctx.organization.id)).not.toBeNull();
  });

  it('disabling a monitor resolves its incident with reason manual and clears the status', async () => {
    const m = await makeMonitor();
    const incident = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValue({ incident: { id: incident.id }, created: true });
    await runWith(m.id, 'down');

    await service.updateMonitor(m.id, ctx.organization.id, { enabled: false });

    expect(resolveFromSource).toHaveBeenCalledWith({
      organizationId: ctx.organization.id,
      source: 'monitor',
      sourceId: m.id,
      resolvedAt: expect.any(Date),
      reason: 'manual',
    });
    const after = (await service.getMonitor(m.id, ctx.organization.id))!;
    expect(after.enabled).toBe(false);
    expect(after.status!.incidentId).toBeNull();
    expect(after.status!.consecutiveFailures).toBe(0);
  });

  it('disabling or deleting a monitor whose outage was reported queues the recovery', async () => {
    const m = await makeMonitor();
    const channel = await notificationChannelsService.createChannel(ctx.organization.id, {
      name: 'hook',
      type: 'webhook',
      config: { url: 'https://example.com/hook' },
    } as any);
    await notificationChannelsService.setMonitorChannels(m.id, [channel.id], ctx.organization.id);
    await runWith(m.id, 'down');
    vi.mocked(monitorNotificationQueue.add).mockClear();

    await service.updateMonitor(m.id, ctx.organization.id, { enabled: false });
    expect(queueCalls('monitor-recovered')).toHaveLength(1);
    expect(queueCalls('monitor-recovered')[0][1]).toMatchObject({
      monitorId: m.id,
      organizationId: ctx.organization.id,
      status: 'up',
      channelIds: [channel.id],
    });

    const m2 = await makeMonitor();
    await notificationChannelsService.setMonitorChannels(m2.id, [channel.id], ctx.organization.id);
    await runWith(m2.id, 'down');
    vi.mocked(monitorNotificationQueue.add).mockClear();
    await service.deleteMonitor(m2.id, ctx.organization.id);
    expect(queueCalls('monitor-recovered')).toHaveLength(1);
    expect(queueCalls('monitor-recovered')[0][1]).toMatchObject({ monitorId: m2.id, channelIds: [channel.id] });
  });

  it('disabling a monitor that is up or whose outage was never reported queues nothing', async () => {
    const up = await makeMonitor();
    await runWith(up.id, 'up');
    const pending = await makeMonitor({ failureThreshold: 3 });
    await runWith(pending.id, 'down');
    vi.mocked(monitorNotificationQueue.add).mockClear();

    await service.updateMonitor(up.id, ctx.organization.id, { enabled: false });
    await service.deleteMonitor(pending.id, ctx.organization.id);
    expect(queueCalls('monitor-recovered')).toHaveLength(0);
  });

  it('updating without disabling does not resolve anything', async () => {
    const m = await makeMonitor();
    await service.updateMonitor(m.id, ctx.organization.id, { name: 'Renamed' });
    await service.updateMonitor(m.id, ctx.organization.id, { enabled: true });
    expect(resolveFromSource).not.toHaveBeenCalled();
  });

  it('down, up, down opens a new incident for the second outage', async () => {
    const m = await makeMonitor({ autoResolve: true });
    const first = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValueOnce({ incident: { id: first.id }, created: true });

    await runWith(m.id, 'down');
    await runWith(m.id, 'up');

    await db.updateTable('incidents').set({ status: 'resolved' }).where('id', '=', first.id).where('organization_id', '=', ctx.organization.id).execute();
    const second = await realIncident(m.id);
    openOrUpdateFromSource.mockResolvedValueOnce({ incident: { id: second.id }, created: true });

    const after = await runWith(m.id, 'down');

    expect(openOrUpdateFromSource).toHaveBeenCalledTimes(2);
    expect(after.status!.incidentId).toBe(second.id);
    expect(queueCalls('monitor-down')).toHaveLength(2);
  });
});
