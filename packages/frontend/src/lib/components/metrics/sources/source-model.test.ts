import { describe, it, expect } from 'vitest';
import type { HostSourceSummary, ServiceSourceSummary } from '@logtide/shared';
import { decodeExplorerQuery } from '$lib/utils/metrics-explorer-url';
import {
  buildExploreHref,
  buildServiceTracesHref,
  buildSourceLogsHref,
  filterHostRows,
  filterServiceRows,
  parseKind,
  sortHosts,
  sortServices,
  sourceHref,
} from './source-model';

const sig = (value: number | null) => ({ value, unit: '%', spark: [] });

function host(name: string, status: HostSourceSummary['status'], cpu: number | null, extra: Partial<HostSourceSummary> = {}): HostSourceSummary {
  return {
    kind: 'host',
    name,
    projectIds: [],
    lastSeen: '2026-11-25T10:00:00.000Z',
    status,
    statusReason: null,
    cpu: sig(cpu),
    memory: sig(1),
    disk: sig(1),
    network: sig(1),
    load: sig(1),
    hardwareStatus: null,
    hardwareHosts: [],
    services: [],
    os: null,
    metricCount: 1,
    ...extra,
  };
}

function service(name: string, status: ServiceSourceSummary['status'], extra: Partial<ServiceSourceSummary> = {}): ServiceSourceSummary {
  return {
    kind: 'service',
    name,
    projectIds: [],
    lastSeen: '2026-11-25T10:00:00.000Z',
    status,
    statusReason: null,
    requestRate: sig(1),
    errorRate: sig(1),
    p95: sig(1),
    hosts: [],
    metricCount: 1,
    hasTraces: true,
    redSource: 'traces',
    ...extra,
  };
}

describe('parseKind', () => {
  it('accepts host and service, everything else is all', () => {
    expect(parseKind('host')).toBe('host');
    expect(parseKind('service')).toBe('service');
    expect(parseKind('browser')).toBe('all');
    expect(parseKind(null)).toBe('all');
  });
});

describe('sorting', () => {
  it('orders worst status first by default, then by name', () => {
    const rows = [host('b', 'ok', 1), host('a', 'stale', 1), host('c', 'critical', 1), host('d', 'warning', 1), host('a2', 'ok', 1)];
    expect(sortHosts(rows).map((h) => h.name)).toEqual(['c', 'd', 'a', 'a2', 'b']);
  });

  it('puts rows without a value last in both directions', () => {
    const rows = [host('a', 'ok', null), host('b', 'ok', 5), host('c', 'ok', 9)];
    expect(sortHosts(rows, { key: 'cpu', dir: 'asc' }).map((h) => h.name)).toEqual(['b', 'c', 'a']);
    expect(sortHosts(rows, { key: 'cpu', dir: 'desc' }).map((h) => h.name)).toEqual(['c', 'b', 'a']);
  });

  it('sorts names naturally', () => {
    const rows = [host('web-10', 'ok', 1), host('web-2', 'ok', 1)];
    expect(sortHosts(rows, { key: 'name', dir: 'asc' }).map((h) => h.name)).toEqual(['web-2', 'web-10']);
  });

  it('sorts services by a signal and by host count', () => {
    const rows = [service('a', 'ok', { p95: sig(300), hosts: ['x'] }), service('b', 'ok', { p95: sig(100), hosts: ['x', 'y'] })];
    expect(sortServices(rows, { key: 'p95', dir: 'asc' }).map((s) => s.name)).toEqual(['b', 'a']);
    expect(sortServices(rows, { key: 'hosts', dir: 'desc' }).map((s) => s.name)).toEqual(['b', 'a']);
  });

  it('does not mutate its input', () => {
    const rows = [host('b', 'ok', 1), host('a', 'critical', 1)];
    sortHosts(rows);
    expect(rows.map((h) => h.name)).toEqual(['b', 'a']);
  });
});

describe('filtering', () => {
  it('matches name, os and services of hosts', () => {
    const rows = [host('alpha', 'ok', 1, { os: 'Debian 12', services: ['api'] }), host('beta', 'ok', 1)];
    expect(filterHostRows(rows, 'ALP').map((h) => h.name)).toEqual(['alpha']);
    expect(filterHostRows(rows, 'debian').map((h) => h.name)).toEqual(['alpha']);
    expect(filterHostRows(rows, 'api').map((h) => h.name)).toEqual(['alpha']);
    expect(filterHostRows(rows, '  ')).toHaveLength(2);
  });

  it('matches name and hosts of services', () => {
    const rows = [service('api', 'ok', { hosts: ['alpha'] }), service('web', 'ok')];
    expect(filterServiceRows(rows, 'alpha').map((s) => s.name)).toEqual(['api']);
  });
});

describe('links', () => {
  it('builds source hrefs with encoded names', () => {
    expect(sourceHref('host', 'a b/c')).toBe('/dashboard/metrics/hosts/a%20b%2Fc');
    expect(sourceHref('service', 'api')).toBe('/dashboard/metrics/services/api');
  });

  it('builds an Explore link filtered on the source, preferring the headline metric', () => {
    const href = buildExploreHref('host', 'vps-app', ['a.metric', 'system.cpu.utilization.total'], ['p1']);
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/dashboard/metrics/explore');
    const q = decodeExplorerQuery(url.searchParams.get('q'));
    expect(q?.projectIds).toEqual(['p1']);
    expect(q?.queries[0].metricName).toBe('system.cpu.utilization.total');
    expect(q?.queries[0].filters).toEqual([{ scope: 'resource', key: 'host.name', op: 'eq', values: ['vps-app'] }]);
  });

  it('falls back to the first metric and filters services on service.name', () => {
    const q = decodeExplorerQuery(new URL(buildExploreHref('service', 'api', ['z.metric'], null), 'http://x').searchParams.get('q'));
    expect(q?.queries[0].metricName).toBe('z.metric');
    expect(q?.queries[0].filters[0].key).toBe('service.name');
    expect(q?.projectIds).toBeNull();
  });

  it('builds Logs and Traces links', () => {
    const scope = { projectIds: ['p1'], range: { kind: 'preset' as const, preset: '6h' as const } };
    const logs = new URL(buildSourceLogsHref('host', 'vps app', scope), 'http://x');
    expect(logs.pathname).toBe('/dashboard/logs');
    expect(logs.searchParams.get('q')).toBe('host:"vps app"');
    expect(logs.searchParams.get('project')).toBe('p1');
    const traces = new URL(buildServiceTracesHref('api', scope), 'http://x');
    expect(traces.pathname).toBe('/dashboard/traces');
    expect(traces.searchParams.get('service')).toBe('api');
  });
});

import { aggregationForCatalogEntry, aggregationsByMetric } from './source-model';

describe('aggregationForCatalogEntry', () => {
  it('rate for monotonic sums, p95 for histograms, avg otherwise', () => {
    expect(aggregationForCatalogEntry({ type: 'sum', isMonotonic: true })).toBe('rate');
    expect(aggregationForCatalogEntry({ type: 'sum', isMonotonic: false })).toBe('avg');
    expect(aggregationForCatalogEntry({ type: 'sum', isMonotonic: null })).toBe('avg');
    expect(aggregationForCatalogEntry({ type: 'histogram', isMonotonic: null })).toBe('p95');
    expect(aggregationForCatalogEntry({ type: 'exp_histogram', isMonotonic: null })).toBe('p95');
    expect(aggregationForCatalogEntry({ type: 'gauge', isMonotonic: null })).toBe('avg');
    expect(aggregationForCatalogEntry(undefined)).toBe('avg');
  });

  it('maps a catalog listing by name', () => {
    const entry = (name: string, type: string, isMonotonic: boolean | null) =>
      ({ name, type, isMonotonic }) as Parameters<typeof aggregationsByMetric>[0][number];
    const map = aggregationsByMetric([entry('a', 'gauge', null), entry('a', 'histogram', null), entry('b', 'sum', true)]);
    expect(map.get('a')).toBe('p95');
    expect(map.get('b')).toBe('rate');
    expect(map.get('zzz')).toBeUndefined();
  });
});
