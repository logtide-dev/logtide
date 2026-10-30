import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUERY,
  formatMetricValue,
  inferMetricUnit,
  parseMetricsUrl,
  toMetricPanelConfig,
  writeMetricsUrl,
  type MetricQueryState,
} from './metrics-query';

function roundTrip(state: MetricQueryState): MetricQueryState {
  const written = writeMetricsUrl(new URLSearchParams(), state);
  // go through a real string, as the browser does
  return parseMetricsUrl(new URLSearchParams(written.toString()));
}

describe('metrics url codec', () => {
  it('round trips a state with values containing = , & | spaces and unicode', () => {
    const state: MetricQueryState = {
      ...DEFAULT_QUERY,
      tab: 'explorer',
      metric: 'http.server.duration',
      aggregation: 'p95',
      where: {
        'http.url': ['a=b&c=d', 'x,y|z', 'caffè nero'],
        'k=ey': ['v'],
      },
      groupBy: ['service.name', 'a,b'],
      interval: '5m',
      service: 'api & co',
    };
    // a key containing "=" cannot survive (split at the first "="), the rest must
    delete state.where['k=ey'];
    expect(roundTrip(state)).toEqual(state);
  });

  it('repeats w for multiple values of one key', () => {
    const state: MetricQueryState = { ...DEFAULT_QUERY, where: { env: ['prod', 'stage'] } };
    const out = writeMetricsUrl(new URLSearchParams(), state);
    expect(out.getAll('w')).toEqual(['env=prod', 'env=stage']);
  });

  it('ignores malformed w without =', () => {
    const parsed = parseMetricsUrl(new URLSearchParams('w=nokey&w==novalue&w=ok=1&w=empty='));
    expect(parsed.where).toEqual({ ok: ['1'], empty: [''] });
  });

  it('invalid agg falls back to avg', () => {
    expect(parseMetricsUrl(new URLSearchParams('agg=median')).aggregation).toBe('avg');
    expect(parseMetricsUrl(new URLSearchParams('agg=rate')).aggregation).toBe('rate');
  });

  it('groupBy truncated to 2', () => {
    expect(parseMetricsUrl(new URLSearchParams('by=a,b,c')).groupBy).toEqual(['a', 'b']);
  });

  it('interval auto is default and is omitted from the URL', () => {
    const out = writeMetricsUrl(new URLSearchParams(), { ...DEFAULT_QUERY, tab: 'explorer' });
    expect(out.has('interval')).toBe(false);
    expect(parseMetricsUrl(out).interval).toBe('auto');
    expect(parseMetricsUrl(new URLSearchParams('interval=7m')).interval).toBe('auto');
  });

  it('keeps unrelated params such as scope and drops stale explorer ones', () => {
    const base = new URLSearchParams('project=p1&range=24h&metric=old&w=a=1');
    const out = writeMetricsUrl(base, { ...DEFAULT_QUERY, metric: 'new' });
    expect(out.get('project')).toBe('p1');
    expect(out.get('range')).toBe('24h');
    expect(out.get('metric')).toBe('new');
    expect(out.has('w')).toBe(false);
  });

  it('invalid tab falls back to overview', () => {
    expect(parseMetricsUrl(new URLSearchParams('tab=nope')).tab).toBe('overview');
  });
});

describe('metric units', () => {
  it('infers units from names', () => {
    expect(inferMetricUnit('http.server.duration_ms', 'avg')).toBe('milliseconds');
    expect(inferMetricUnit('process.memory.bytes', 'avg')).toBe('bytes');
    expect(inferMetricUnit('cpu.utilization', 'avg')).toBe('percent');
    expect(inferMetricUnit('http.request.duration', 'p95')).toBe('seconds');
    expect(inferMetricUnit('requests_total', 'rate')).toBe('per_second');
    expect(inferMetricUnit('net.io.bytes', 'rate')).toBe('bytes_per_second');
    expect(inferMetricUnit('anything', 'count')).toBe('count');
    expect(inferMetricUnit('mystery', 'avg')).toBeNull();
  });

  it('formats values', () => {
    expect(formatMetricValue(1536, 'bytes')).toBe('1.5 KiB');
    expect(formatMetricValue(1200, 'milliseconds')).toBe('1.2 s');
    expect(formatMetricValue(0.25, 'seconds')).toBe('250 ms');
    expect(formatMetricValue(42.123, 'percent')).toBe('42.1%');
    expect(formatMetricValue(1234567, 'count')).toBe('1,234,567');
    expect(formatMetricValue(2048, 'bytes_per_second')).toBe('2 KiB/s');
    expect(formatMetricValue(3.456, 'per_second')).toBe('3.46/s');
  });
});

describe('toMetricPanelConfig', () => {
  const base: MetricQueryState = { ...DEFAULT_QUERY, metric: 'cpu.usage', service: 'api' };

  it('drops rate and reports it', () => {
    const { config, dropped } = toMetricPanelConfig({ ...base, aggregation: 'rate' }, 'p1', '1h');
    expect(config.aggregation).toBe('avg');
    expect(dropped).toContain('rate');
    expect(config.projectId).toBe('p1');
    expect(config.serviceName).toBe('api');
    expect(config.metricName).toBe('cpu.usage');
    expect(config.interval).toBe('1m');
  });

  it('reports filters and group by as dropped', () => {
    const { dropped } = toMetricPanelConfig(
      { ...base, where: { env: ['prod'] }, groupBy: ['host'] },
      'p1',
      '24h'
    );
    expect(dropped).toEqual(['filters', 'group by']);
  });

  it('custom 5h range maps to 6h preset', () => {
    const to = new Date('2026-01-01T10:00:00Z');
    const from = new Date(to.getTime() - 5 * 3600_000);
    const { config } = toMetricPanelConfig(base, 'p1', { from, to });
    expect(config.timeRange).toBe('6h');
    expect(config.interval).toBe('5m');
  });

  it('1w interval becomes 1d', () => {
    expect(toMetricPanelConfig({ ...base, interval: '1w' }, 'p1', '7d').config.interval).toBe('1d');
  });

  it('explicit interval is kept and null range defaults to 24h', () => {
    const { config } = toMetricPanelConfig({ ...base, interval: '1h' }, 'p1', null);
    expect(config.interval).toBe('1h');
    expect(config.timeRange).toBe('24h');
  });
});
