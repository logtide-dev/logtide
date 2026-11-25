import { describe, it, expect } from 'vitest';
import type { MetricExplorerQuery, MetricSeries } from '@logtide/shared';
import {
  catalogPrefixOf,
  defaultAggregationFor,
  defaultPanelTitle,
  drillDownQuery,
  panelTimeRangeFor,
  scopeProjectIds,
  withGroupBy,
} from './metrics-explore';
import { defaultExplorerQuery } from './metrics-explorer-url';

const q = (): MetricExplorerQuery => ({
  ...defaultExplorerQuery(),
  queries: [{ id: 'A', metricName: 'm', aggregation: 'avg', filters: [], groupBy: [] }],
});

const series = (labels: Record<string, string>, queryId = 'A'): MetricSeries => ({
  id: 'x',
  queryId,
  labels,
  name: 'x',
  unit: null,
  comparison: false,
  points: [],
  stats: { min: null, avg: null, max: null, last: null },
});

describe('metrics-explore utils', () => {
  it('maps scope projects, empty meaning all', () => {
    expect(scopeProjectIds([])).toBeNull();
    expect(scopeProjectIds(['a'])).toEqual(['a']);
  });

  it('picks the closest panel preset', () => {
    expect(panelTimeRangeFor({ kind: 'preset', preset: '1h' })).toBe('1h');
    expect(panelTimeRangeFor({ kind: 'preset', preset: '7d' })).toBe('7d');
    const from = new Date('2026-01-01T00:00:00Z').getTime();
    const custom = (ms: number) => ({ kind: 'custom' as const, from: new Date(from).toISOString(), to: new Date(from + ms).toISOString() });
    expect(panelTimeRangeFor(custom(5 * 3600_000))).toBe('6h');
    expect(panelTimeRangeFor(custom(100 * 86400_000))).toBe('30d');
    expect(panelTimeRangeFor(custom(60_000))).toBe('15m');
  });

  it('titles a panel from the first visible query', () => {
    const query = q();
    expect(defaultPanelTitle(query)).toBe('m');
    query.queries[0].label = 'CPU';
    expect(defaultPanelTitle(query)).toBe('CPU');
    expect(defaultPanelTitle(defaultExplorerQuery())).toBe('Metrics');
  });

  it('drills down with eq filters, replacing same attribute filters, ignoring __other__', () => {
    const query = q();
    query.queries[0].filters = [{ scope: 'resource', key: 'host.name', op: 'neq', values: ['a'] }];
    const next = drillDownQuery(query, series({ 'resource.host.name': 'vps', mode: 'user' }));
    expect(next.queries[0].filters).toEqual([
      { scope: 'resource', key: 'host.name', op: 'eq', values: ['vps'] },
      { scope: 'metric', key: 'mode', op: 'eq', values: ['user'] },
    ]);
    expect(query.queries[0].filters).toHaveLength(1);
    expect(drillDownQuery(query, series({ __other__: 'true' }))).toBe(query);
  });

  it('adds a group by and follows the default display', () => {
    const next = withGroupBy(q(), { scope: 'resource', key: 'host.name' });
    expect(next.queries[0].groupBy).toEqual([{ scope: 'resource', key: 'host.name' }]);
    expect(next.display).toBe('split');
    const attr = withGroupBy(q(), { scope: 'metric', key: 'state' });
    expect(attr.display).toBe('lines');
    const area = { ...q(), display: 'area' as const };
    expect(withGroupBy(area, { scope: 'resource', key: 'host.name' }).display).toBe('area');
  });

  it('chooses the default aggregation per metric type', () => {
    expect(defaultAggregationFor({ type: 'sum', isMonotonic: true })).toBe('rate');
    expect(defaultAggregationFor({ type: 'sum', isMonotonic: false })).toBe('avg');
    expect(defaultAggregationFor({ type: 'gauge', isMonotonic: null })).toBe('avg');
    expect(defaultAggregationFor({ type: 'histogram', isMonotonic: null })).toBe('p95');
  });

  it('derives catalog prefixes', () => {
    expect(catalogPrefixOf('system.cpu.time')).toBe('system');
    expect(catalogPrefixOf('orders_total')).toBe('other');
  });
});
