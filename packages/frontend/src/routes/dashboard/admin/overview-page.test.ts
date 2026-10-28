import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const ok = <T,>(v: T) => vi.fn().mockResolvedValue(v);

const h = vi.hoisted(() => ({ api: {} as Record<string, (...args: unknown[]) => unknown> }));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/admin', () => ({
  adminAPI: new Proxy({}, { get: (_t, prop: string) => (...args: unknown[]) => h.api[prop]?.(...args) }),
}));

import { authStore } from '$lib/stores/auth';
import Overview from './+page.svelte';

function setApi(overrides: Record<string, unknown> = {}) {
  h.api = {
    getSystemStats: ok({
      users: { total: 1500, active: 1200, growth: { today: 3, week: 10, month: 40 } },
      organizations: { total: 20, growth: { today: 0, week: 2, month: 5 } },
      projects: { total: 45, growth: { today: 0, week: 4, month: 9 } },
    }),
    getLogsStats: ok({
      total: 2_500_000,
      perDay: [],
      topOrganizations: [{ organizationId: 'o1', organizationName: 'Acme', count: 1000 }],
      topProjects: [{ projectId: 'p1', projectName: 'Web', organizationName: 'Acme', count: 600 }],
      growth: { logsPerHour: 1000, logsPerDay: 24000 },
    }),
    getPerformanceStats: ok({ ingestion: { throughput: 2.5, avgLatency: 1 }, storage: { logsSize: '1 GB', compressionRatio: 3 } }),
    getAlertsStats: ok({
      rules: { total: 3, active: 2, disabled: 1 },
      triggered: { last24h: 4, last7days: 9 },
      perOrganization: [],
      notifications: { success: 9, failed: 1 },
    }),
    getRedisStats: ok({
      memory: { used: '1MB', peak: '2MB' },
      queues: {
        alertNotifications: { waiting: 1, active: 0, completed: 0, failed: 0 },
        sigmaDetection: { waiting: 2, active: 0, completed: 0, failed: 1 },
      },
      connections: 3,
    }),
    getHealthStats: ok({
      storageEngine: 'timescale',
      database: { status: 'healthy', latency: 3, connections: 4 },
      redis: { status: 'healthy', latency: 1 },
      pool: { totalConnections: 1, idleConnections: 1, waitingRequests: 0 },
      overall: 'healthy',
    }),
    getPlatformTimeline: ok({ timeline: [] }),
    getActiveIssues: ok({ openIncidents: 2, criticalDetections24h: 1, failedNotifications24h: 0, openErrorGroups: 5 }),
    getVersionCheck: ok({ currentVersion: '1.6.0', channel: 'stable', latestStable: null, latestBeta: null, updateAvailable: false, checkedAt: '2026-10-28T00:00:00Z' }),
    getIngestionHealth: ok({
      counters24h: { piiRejected: 0, detectionEnqueueFailed: 0, exceptionEnqueueFailed: 0, identifierFailed: 0, timestampSkew: 0, spanTimestampSkew: 0, metricTimestampSkew: 0 },
      enrichment: { ipReputation: { configured: true, ready: true, lastUpdate: null, source: 'x', totalIps: 0 }, geoIp: { configured: true, ready: true, lastUpdate: null, source: 'x' } },
    }),
    ...(overrides as Record<string, (...args: unknown[]) => unknown>),
  };
}

describe('instance overview', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A', is_admin: true }, 'token');
  });

  it('shows the health line, windowed KPIs, a broken-down issue list and linked top lists', async () => {
    setApi();
    render(Overview as never);
    expect(await screen.findByText('All systems healthy')).toBeInTheDocument();
    expect(await screen.findByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('24K ingested in the last 24 hours', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Open incidents/)).toBeInTheDocument();
    expect(screen.getByText(/Open error groups/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/dashboard/admin/organizations/o1');
    expect(screen.getByRole('link', { name: 'Web' })).toHaveAttribute('href', '/dashboard/admin/projects/p1');
  });

  it('one failing widget does not blank the rest', async () => {
    setApi({ getLogsStats: vi.fn().mockRejectedValue(new Error('logs down')) });
    render(Overview as never);
    expect(await screen.findByText('1,500')).toBeInTheDocument();
    expect(await screen.findByText(/Some widgets could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeNull();
  });

  it('a total failure shows an error state that retries', async () => {
    const fail = () => vi.fn().mockRejectedValue(new Error('offline'));
    setApi({
      getSystemStats: fail(), getLogsStats: fail(), getPerformanceStats: fail(), getAlertsStats: fail(), getRedisStats: fail(),
      getHealthStats: fail(), getPlatformTimeline: fail(), getActiveIssues: fail(), getVersionCheck: fail(), getIngestionHealth: fail(),
    });
    render(Overview as never);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the overview');
    setApi();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('All systems healthy')).toBeInTheDocument());
  });
});
