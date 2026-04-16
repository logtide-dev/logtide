import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MonitorService } from '../../../modules/monitoring/service.js';
import { createTestContext } from '../../helpers/index.js';
import { db } from '../../../database/index.js';

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
vi.mock('../../../modules/monitoring/checker.js', () => ({
  runHttpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null }),
  runTcpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 10, statusCode: null, errorCode: null }),
  runHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
  runLogHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
  parseTcpTarget: vi.fn().mockReturnValue({ host: 'localhost', port: 5432 }),
}));

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

describe('MonitorService.getProjectBySlug', () => {
  it('returns project when found', async () => {
    const project = await service.getProjectBySlug(ctx.project.slug);
    expect(project).not.toBeNull();
    expect(project!.id).toBe(ctx.project.id);
  });

  it('returns null/undefined for unknown slug', async () => {
    const project = await service.getProjectBySlug('not-a-real-slug-xyz');
    expect(project ?? null).toBeNull();
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
