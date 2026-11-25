import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { MetricQueryResponse, MetricsPanelConfig, MetricSeries } from '@logtide/shared';

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  on: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('echarts', () => ({ init: vi.fn(() => chart) }));

import MetricsPanel from './MetricsPanel.svelte';
import { metricNamesOf, isCompactSize, chartHeightFor } from './metrics-panel';

function series(name: string, last: number): MetricSeries {
  return {
    id: `A|${name}`,
    queryId: 'A',
    labels: { 'resource.host.name': name },
    name,
    unit: '%',
    comparison: false,
    points: [
      { t: '2026-01-01T00:00:00Z', v: 1 },
      { t: '2026-01-01T00:05:00Z', v: last },
    ],
    stats: { min: 1, avg: 5, max: 9, last },
  };
}

const response: MetricQueryResponse = {
  series: [series('alpha', 10), series('beta', 90)],
  interval: '5m',
  queries: [{ id: 'A', seriesTotal: 2, seriesShown: 2, metricType: 'gauge', unit: '%' }],
  warnings: [],
};

function config(display: MetricsPanelConfig['query']['display']): MetricsPanelConfig {
  return {
    type: 'metrics',
    title: 'CPU',
    source: 'metrics',
    timeRange: '24h',
    query: {
      projectIds: null,
      queries: [
        { id: 'A', metricName: 'system.cpu.utilization.total', aggregation: 'avg', filters: [], groupBy: [] },
      ],
      formulas: [],
      interval: 'auto',
      compareTo: 'none',
      display,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no ResizeObserver; bind:clientWidth and the chart need one.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('MetricsPanel', () => {
  it('draws a chart in lines mode', () => {
    render(MetricsPanel, { config: config('lines'), data: response, loading: false, error: null });
    expect(chart.setOption).toHaveBeenCalled();
    expect(chart.setOption.mock.calls[0][0].series).toHaveLength(2);
  });

  it('renders one card per series in split mode', () => {
    render(MetricsPanel, { config: config('split'), data: response, loading: false, error: null });
    expect(screen.getAllByTestId('split-card')).toHaveLength(2);
  });

  it('uses the display stored in the config', () => {
    render(MetricsPanel, { config: config('bars'), data: response, loading: false, error: null });
    expect(chart.setOption.mock.calls[0][0].series[0].type).toBe('bar');
  });

  it('shows the empty state for an empty response', () => {
    render(MetricsPanel, {
      config: config('lines'),
      data: { ...response, series: [] },
      loading: false,
      error: null,
    });
    expect(screen.getByText('No data for this query')).toBeInTheDocument();
  });

  it('shows the error', () => {
    render(MetricsPanel, { config: config('lines'), data: null, loading: false, error: 'boom' });
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('is not compact until it is measured', () => {
    const { container } = render(MetricsPanel, { config: config('lines'), data: response, loading: false, error: null });
    expect(container.querySelector('[data-compact]')?.getAttribute('data-compact')).toBe('false');
  });
});

describe('metrics panel helpers', () => {
  it('maps query ids to metric names', () => {
    expect(metricNamesOf(config('lines'))).toEqual({ A: 'system.cpu.utilization.total' });
  });

  it('flags small panels as compact', () => {
    expect(isCompactSize(0, 0)).toBe(false);
    expect(isCompactSize(600, 150)).toBe(true);
    expect(isCompactSize(200, 400)).toBe(true);
    expect(isCompactSize(600, 400)).toBe(false);
  });

  it('fits the chart to the panel height', () => {
    expect(chartHeightFor(0)).toBe(320);
    expect(chartHeightFor(1000)).toBe(320);
    expect(chartHeightFor(200)).toBe(176);
    expect(chartHeightFor(50)).toBe(80);
  });
});
