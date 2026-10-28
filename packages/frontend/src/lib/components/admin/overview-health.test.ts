import { describe, it, expect } from 'vitest';
import type { HealthStats } from '$lib/api/admin';
import { activeIssueItems, ingestionCounterItems, overallHealth } from './overview-health';
import { mergeDaily, sumQuantity } from './usage-data';

const healthy: HealthStats = {
  storageEngine: 'timescale',
  database: { status: 'healthy', latency: 3, connections: 4 },
  redis: { status: 'healthy', latency: 1 },
  pool: { totalConnections: 10, idleConnections: 9, waitingRequests: 0 },
  overall: 'healthy',
};

describe('overallHealth', () => {
  it('is unknown without data', () => {
    expect(overallHealth(null).state).toBe('unknown');
  });

  it('reports healthy with no problems', () => {
    const h = overallHealth(healthy);
    expect(h.state).toBe('ok');
    expect(h.problems).toEqual([]);
  });

  it('names the components that pull the status down', () => {
    const h = overallHealth({
      ...healthy,
      overall: 'degraded',
      redis: { status: 'down', latency: -1 },
      database: { status: 'degraded', latency: 900, connections: 4 },
    });
    expect(h.state).toBe('degraded');
    expect(h.problems).toEqual(['PostgreSQL is degraded', 'Redis is down']);
  });

  it('ignores a Redis that is not configured', () => {
    expect(overallHealth({ ...healthy, redis: { status: 'not_configured', latency: 0 } }).problems).toEqual([]);
  });
});

describe('activeIssueItems', () => {
  it('keeps each kind apart with its own window', () => {
    const items = activeIssueItems({
      openIncidents: 2,
      criticalDetections24h: 5,
      failedNotifications24h: 0,
      openErrorGroups: 7,
    });
    expect(items.map((i) => [i.key, i.count, i.window])).toEqual([
      ['incidents', 2, 'right now'],
      ['critical', 5, 'last 24 hours'],
      ['notifications', 0, 'last 24 hours'],
      ['errors', 7, 'right now'],
    ]);
  });
});

describe('ingestionCounterItems', () => {
  it('labels counters and flags the alarming ones', () => {
    const items = ingestionCounterItems({
      piiRejected: 1,
      detectionEnqueueFailed: 0,
      exceptionEnqueueFailed: 0,
      identifierFailed: 3,
      timestampSkew: 4,
      spanTimestampSkew: 0,
      metricTimestampSkew: 0,
    });
    expect(items).toHaveLength(7);
    expect(items.find((i) => i.key === 'piiRejected')?.alarm).toBe(true);
    expect(items.find((i) => i.key === 'timestampSkew')?.alarm).toBe(false);
  });
});

describe('usage data', () => {
  it('merges days newest first', () => {
    const rows = mergeDaily(
      [
        { type: 'e', project_id: null, bucket: '2026-10-01', quantity: 5 },
        { type: 'e', project_id: null, bucket: '2026-10-02', quantity: 7 },
      ],
      [{ type: 'b', project_id: null, bucket: '2026-10-02', quantity: 100 }],
    );
    expect(rows).toEqual([
      { date: '2026-10-02', events: 7, bytes: 100 },
      { date: '2026-10-01', events: 5, bytes: 0 },
    ]);
    expect(sumQuantity([{ type: 'e', project_id: null, quantity: 2 }, { type: 'e', project_id: null, quantity: 3 }])).toBe(5);
  });
});
