import { describe, it, expect } from 'vitest';
import { parseLogQuery } from '@logtide/shared';
import type { PanelConfig } from '@logtide/shared';
import { panelDrilldown } from './drilldown';

function parse(href: string): { path: string; params: URLSearchParams } {
  const url = new URL(href, 'http://localhost');
  return { path: url.pathname, params: url.searchParams };
}

const timeSeries = {
  type: 'time_series',
  title: 'Log volume',
  source: 'logs',
  projectId: 'p-1',
  interval: '6h',
  levels: ['warn', 'error'],
  service: 'api gateway',
} as PanelConfig;

const traceLatency = {
  type: 'trace_latency',
  title: 'Latency',
  source: 'traces',
  projectId: 'p-1',
  serviceName: 'checkout',
  timeRange: '24h',
  showPercentiles: ['p50'],
} as PanelConfig;

describe('panelDrilldown', () => {
  it('time_series with levels and service builds q and range', () => {
    const link = panelDrilldown(timeSeries)!;
    expect(link.label).toBe('Open in Logs');
    const { path, params } = parse(link.href);
    expect(path).toBe('/dashboard/logs');
    expect(params.get('project')).toBe('p-1');
    expect(params.get('range')).toBe('6h');
    expect(params.get('q')).toBe('level:(warn OR error) service:"api gateway"');
  });

  it('a single level uses the plain form', () => {
    const link = panelDrilldown({ ...timeSeries, levels: ['error'], service: null } as PanelConfig)!;
    expect(parse(link.href).params.get('q')).toBe('level:error');
  });

  it('all five levels omit the level clause', () => {
    const link = panelDrilldown({
      ...timeSeries,
      levels: ['debug', 'info', 'warn', 'error', 'critical'],
      service: null,
    } as PanelConfig)!;
    expect(parse(link.href).params.has('q')).toBe(false);
  });

  it('override replaces the window', () => {
    const link = panelDrilldown(timeSeries, '7d')!;
    expect(parse(link.href).params.get('range')).toBe('7d');
  });

  it('live_log_stream ignores the override', () => {
    const link = panelDrilldown(
      {
        type: 'live_log_stream',
        title: 'Live',
        source: 'logs',
        projectId: null,
        service: null,
        levels: ['error', 'critical'],
        maxRows: 25,
      } as PanelConfig,
      '7d'
    )!;
    const { params } = parse(link.href);
    expect(params.get('range')).toBe('1h');
    expect(params.get('q')).toBe('level:(error OR critical)');
  });

  it('live log_table ignores the override but a snapshot one honours it', () => {
    const table = {
      type: 'log_table',
      title: 'Rows',
      source: 'logs',
      projectId: 'p-1',
      mode: 'live',
      timeRange: '1h',
      levels: [],
      service: null,
      maxRows: 25,
      columns: [],
      builtinColumns: ['time'],
      wrapCells: false,
    } as PanelConfig;
    expect(parse(panelDrilldown(table, '30d')!.href).params.get('range')).toBe('1h');
    expect(
      parse(panelDrilldown({ ...table, mode: 'snapshot' } as PanelConfig, '30d')!.href).params.get(
        'range'
      )
    ).toBe('30d');
  });

  it('trace_latency links to traces with service and range', () => {
    const link = panelDrilldown(traceLatency)!;
    expect(link.label).toBe('Open in Traces');
    const { path, params } = parse(link.href);
    expect(path).toBe('/dashboard/traces');
    expect(params.get('service')).toBe('checkout');
    expect(params.get('range')).toBe('24h');
    expect(params.get('project')).toBe('p-1');
  });

  it('trace panels without a service omit it', () => {
    const link = panelDrilldown({ ...traceLatency, serviceName: null } as PanelConfig)!;
    expect(parse(link.href).params.has('service')).toBe(false);
  });

  it('null projectId links to all projects explicitly', () => {
    const link = panelDrilldown({ ...timeSeries, projectId: null } as PanelConfig)!;
    expect(parse(link.href).params.get('project')).toBe('all');
  });

  it('geo_map adds the host clause', () => {
    const link = panelDrilldown({
      type: 'geo_map',
      title: 'Map',
      source: 'logs',
      projectId: null,
      interval: '24h',
      mode: 'country',
      limit: 50,
      fieldPrefix: 'geo',
      levels: [],
      service: null,
      hostname: 'web-1',
    } as PanelConfig)!;
    expect(parse(link.href).params.get('q')).toBe('host:"web-1"');
  });

  it('error_rate stat and error_message top-n add the error level clause', () => {
    const stat = panelDrilldown({
      type: 'single_stat',
      title: 'Error rate',
      source: 'logs',
      metric: 'error_rate',
      projectId: null,
      compareWithPrevious: true,
    } as PanelConfig)!;
    const sp = parse(stat.href).params;
    expect(sp.get('q')).toBe('level:(error OR critical)');
    expect(sp.get('range')).toBe('24h');

    const topN = panelDrilldown({
      type: 'top_n_table',
      title: 'Top errors',
      source: 'logs',
      dimension: 'error_message',
      limit: 10,
      projectId: null,
      interval: '7d',
    } as PanelConfig)!;
    expect(parse(topN.href).params.get('q')).toBe('level:(error OR critical)');
  });

  it('a metadata top-n adds no dimension clause', () => {
    const link = panelDrilldown({
      type: 'top_n_table',
      title: 'By metric',
      source: 'logs',
      dimension: 'metadata',
      metadataField: 'performance.metric',
      limit: 10,
      projectId: null,
      interval: '7d',
    } as PanelConfig)!;
    expect(parse(link.href).params.has('q')).toBe(false);
  });

  it('escapes quotes in service names', () => {
    const link = panelDrilldown({ ...timeSeries, levels: [], service: 'a"b' } as PanelConfig)!;
    expect(parse(link.href).params.get('q')).toBe('service:"a\\"b"');
  });

  it('activity_overview and system_status return null', () => {
    expect(
      panelDrilldown({
        type: 'activity_overview',
        title: 'Activity',
        source: 'activity',
        projectId: null,
        timeRange: '7d',
        series: ['detections'],
      } as unknown as PanelConfig)
    ).toBeNull();
    expect(
      panelDrilldown({
        type: 'system_status',
        title: 'Status',
        source: 'monitors',
        projectId: null,
      } as unknown as PanelConfig)
    ).toBeNull();
  });

  it('every produced q parses with parseLogQuery', () => {
    const configs: PanelConfig[] = [
      timeSeries,
      { ...timeSeries, levels: ['error'], service: 'a"b\\c' } as PanelConfig,
      {
        type: 'geo_map',
        title: 'Map',
        source: 'logs',
        projectId: null,
        interval: '24h',
        mode: 'country',
        limit: 50,
        fieldPrefix: 'geo',
        levels: ['critical', 'error'],
        service: 'svc',
        hostname: 'web 1',
      } as PanelConfig,
      {
        type: 'top_n_table',
        title: 'Top',
        source: 'logs',
        dimension: 'metadata',
        metadataField: 'x',
        limit: 5,
        projectId: null,
        interval: '24h',
        levels: ['warn', 'error', 'critical'],
        service: 'svc',
      } as PanelConfig,
      {
        type: 'single_stat',
        title: 'Rate',
        source: 'logs',
        metric: 'error_rate',
        projectId: null,
        compareWithPrevious: false,
      } as PanelConfig,
      {
        type: 'log_table',
        title: 'Rows',
        source: 'logs',
        projectId: null,
        mode: 'snapshot',
        timeRange: '1h',
        levels: ['debug'],
        service: 'svc',
        maxRows: 25,
        columns: [],
        builtinColumns: ['time'],
        wrapCells: false,
      } as PanelConfig,
      {
        type: 'live_log_stream',
        title: 'Live',
        source: 'logs',
        projectId: null,
        service: 'svc',
        levels: ['info', 'warn'],
        maxRows: 25,
      } as PanelConfig,
    ];
    for (const config of configs) {
      const link = panelDrilldown(config)!;
      const q = parse(link.href).params.get('q');
      if (q !== null) {
        const result = parseLogQuery(q);
        expect(result.ok, `${config.type}: ${q}`).toBe(true);
      }
    }
  });
});
