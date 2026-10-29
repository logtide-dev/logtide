import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const api = vi.hoisted(() => ({
  listMonitors: vi.fn(),
  getMonitor: vi.fn(),
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
  getMonitorResults: vi.fn(),
  getMonitorUptime: vi.fn(),
  getMonitorUptimeSummary: vi.fn(),
  getMonitorResponseTimes: vi.fn(),
  getMonitorOutages: vi.fn(),
}));

vi.mock('$lib/api/monitoring', () => api);

import { monitoringStore } from './monitoring';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wire(id: string, monitorPromise?: Promise<unknown>) {
  api.getMonitor.mockImplementationOnce(() => monitorPromise ?? Promise.resolve({ monitor: { id } }));
  api.getMonitorResults.mockResolvedValueOnce({ results: [] });
  api.getMonitorUptime.mockResolvedValueOnce({ history: [] });
  api.getMonitorUptimeSummary.mockResolvedValueOnce({
    windows: { '24h': { uptimePct: 100, totalChecks: 1 } },
  });
  api.getMonitorResponseTimes.mockResolvedValueOnce({ bucketSeconds: 300, points: [{ time: 't', avgMs: 1, p95Ms: 2, failures: 0 }] });
  api.getMonitorOutages.mockResolvedValueOnce({ outages: [] });
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  monitoringStore.clear();
});

describe('monitoringStore.loadDetail', () => {
  it('ignores a stale response when navigating between monitors', async () => {
    const slow = deferred<unknown>();
    wire('a', slow.promise);
    const first = monitoringStore.loadDetail('a', 'org-1');

    wire('b');
    const second = monitoringStore.loadDetail('b', 'org-1');
    await second;
    expect(get(monitoringStore).selectedMonitor?.id).toBe('b');

    slow.resolve({ monitor: { id: 'a' } });
    await first;
    // The late answer for monitor a must not replace monitor b.
    expect(get(monitoringStore).selectedMonitor?.id).toBe('b');
    expect(get(monitoringStore).detailLoading).toBe(false);
  });

  it('ignores a stale failure as well', async () => {
    const slow = deferred<unknown>();
    wire('a', slow.promise);
    const first = monitoringStore.loadDetail('a', 'org-1');
    wire('b');
    await monitoringStore.loadDetail('b', 'org-1');
    slow.reject(new Error('boom'));
    await first;
    expect(get(monitoringStore).detailError).toBeNull();
    expect(get(monitoringStore).selectedMonitor?.id).toBe('b');
  });

  it('stores summary, response times and outages, and tolerates their failure', async () => {
    wire('a');
    await monitoringStore.loadDetail('a', 'org-1');
    let state = get(monitoringStore);
    expect(state.selectedMonitorSummary?.windows['24h'].uptimePct).toBe(100);
    expect(state.selectedMonitorResponseTimes).toHaveLength(1);

    api.getMonitor.mockResolvedValueOnce({ monitor: { id: 'a' } });
    api.getMonitorResults.mockResolvedValueOnce({ results: [] });
    api.getMonitorUptime.mockResolvedValueOnce({ history: [] });
    api.getMonitorUptimeSummary.mockRejectedValueOnce(new Error('x'));
    api.getMonitorResponseTimes.mockRejectedValueOnce(new Error('x'));
    api.getMonitorOutages.mockRejectedValueOnce(new Error('x'));
    await monitoringStore.loadDetail('a', 'org-1');
    state = get(monitoringStore);
    expect(state.detailError).toBeNull();
    expect(state.selectedMonitorSummary).toBeNull();
    expect(state.selectedMonitorResponseTimes).toEqual([]);
    expect(state.selectedMonitorOutages).toEqual([]);
  });

  it('a slow range reload does not overwrite a newer one', async () => {
    const slow = deferred<unknown>();
    api.getMonitorResponseTimes.mockImplementationOnce(() => slow.promise);
    const first = monitoringStore.loadResponseTimes('a', 'org-1', '7d');
    api.getMonitorResponseTimes.mockResolvedValueOnce({
      bucketSeconds: 300,
      points: [{ time: 'new', avgMs: 5, p95Ms: 6, failures: 0 }],
    });
    await monitoringStore.loadResponseTimes('a', 'org-1', '24h');
    slow.resolve({ bucketSeconds: 3600, points: [{ time: 'old', avgMs: 1, p95Ms: 1, failures: 0 }] });
    await first;
    const state = get(monitoringStore);
    expect(state.selectedMonitorResponseTimes[0].time).toBe('new');
    expect(state.responseTimeRange).toBe('24h');
  });
});
