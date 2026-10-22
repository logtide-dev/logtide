import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const { setOption } = vi.hoisted(() => ({ setOption: vi.fn() }));

vi.mock('echarts', () => ({
  init: () => ({ setOption, resize: vi.fn(), dispose: vi.fn() }),
}));

import MetricChartPanel from './MetricChartPanel.svelte';
import { shapeMetricSeries } from './metric-series';
import type { MetricChartConfig } from '@logtide/shared';

const config: MetricChartConfig = {
  type: 'metric_chart',
  title: 'CPU',
  source: 'metrics',
  projectId: null,
  metricName: 'cpu_usage',
  aggregation: 'avg',
  interval: '5m',
  timeRange: '1h',
  serviceName: null,
};

function data(series: Array<{ time: string; value: number; labels?: Record<string, string> }>) {
  return { metricName: 'cpu_usage', metricType: 'gauge', aggregation: 'avg', interval: '5m', series };
}

function lastOption() {
  const calls = setOption.mock.calls;
  return calls[calls.length - 1][0] as {
    series: Array<{ name: string; data: Array<number | null> }>;
    xAxis: { data: string[] };
  };
}

beforeEach(() => {
  setOption.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});

describe('MetricChartPanel', () => {
  it('renders one series per label combination', () => {
    render(MetricChartPanel, {
      props: {
        config: { ...config, groupBy: ['host', 'region'] },
        loading: false,
        error: null,
        data: data([
          { time: '2026-01-01T00:00:00Z', value: 1, labels: { host: 'a', region: 'eu' } },
          { time: '2026-01-01T00:05:00Z', value: 2, labels: { host: 'a', region: 'eu' } },
          { time: '2026-01-01T00:00:00Z', value: 5, labels: { host: 'b', region: 'us' } },
        ]),
      },
    });
    const opt = lastOption();
    expect(opt.series.map((s) => s.name)).toEqual(['host=a, region=eu', 'host=b, region=us']);
    expect(opt.series[0].data).toEqual([1, 2]);
    expect(opt.series[1].data).toEqual([5, null]);
    expect(opt.xAxis.data).toHaveLength(2);
  });

  it('renders a single series without labels', () => {
    render(MetricChartPanel, {
      props: {
        config,
        loading: false,
        error: null,
        data: data([
          { time: '2026-01-01T00:00:00Z', value: 1 },
          { time: '2026-01-01T00:05:00Z', value: 2 },
        ]),
      },
    });
    const opt = lastOption();
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0].name).toBe('avg(cpu_usage)');
    expect(opt.series[0].data).toEqual([1, 2]);
  });
});

describe('shapeMetricSeries', () => {
  it('orders label keys so the legend is stable', () => {
    const shaped = shapeMetricSeries(
      [{ time: '2026-01-01T00:00:00Z', value: 1, labels: { region: 'eu', host: 'a' } }],
      'x'
    );
    expect(shaped.series[0].name).toBe('host=a, region=eu');
    expect(shaped.grouped).toBe(true);
  });

  it('handles no points', () => {
    expect(shapeMetricSeries([], 'x')).toEqual({
      times: [],
      series: [{ name: 'x', data: [] }],
      grouped: false,
    });
  });
});
