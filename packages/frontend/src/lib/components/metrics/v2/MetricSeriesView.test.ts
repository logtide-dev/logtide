import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import type { MetricQueryResponse, MetricSeries } from '@logtide/shared';

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  on: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('echarts', () => ({ init: vi.fn(() => chart) }));

import MetricSeriesView from './MetricSeriesView.svelte';

function mk(id: string, name: string, last: number | null, opts: Partial<MetricSeries> = {}): MetricSeries {
  return {
    id,
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
    ...opts,
  };
}

function resp(series: MetricSeries[], extra: Partial<MetricQueryResponse> = {}): MetricQueryResponse {
  return {
    series,
    interval: '5m',
    queries: [{ id: 'A', seriesTotal: series.length, seriesShown: series.length, metricType: 'gauge', unit: '%' }],
    warnings: [],
    ...extra,
  };
}

const three = [mk('A|a', 'alpha', 10), mk('A|b', 'beta', 90), mk('A|c', 'gamma', 40)];

beforeEach(() => vi.clearAllMocks());

describe('MetricSeriesView states', () => {
  it('shows loading without a response', () => {
    render(MetricSeriesView, { response: null, loading: true });
    expect(screen.getByText('Loading metrics')).toBeInTheDocument();
  });

  it('shows an error', () => {
    render(MetricSeriesView, { response: null, error: 'boom' });
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('shows the empty state', () => {
    render(MetricSeriesView, { response: resp([]) });
    expect(screen.getByText('No data for this query')).toBeInTheDocument();
  });

  it('shows warnings, per query errors and the capped notice', () => {
    render(MetricSeriesView, {
      response: resp(three, {
        warnings: ['Too many series, aggregated in one step'],
        queries: [
          { id: 'A', seriesTotal: 340, seriesShown: 10, metricType: 'gauge', unit: '%' },
          { id: 'B', seriesTotal: 0, seriesShown: 0, metricType: null, unit: null, error: 'Unknown metric' },
        ],
      }),
    });
    expect(screen.getByText('Too many series, aggregated in one step')).toBeInTheDocument();
    expect(screen.getByText(/Query B: Unknown metric/)).toBeInTheDocument();
    expect(screen.getByText(/Query A: showing 10 of 340 series/)).toBeInTheDocument();
  });

  it('shows Updating while refreshing existing data', () => {
    render(MetricSeriesView, { response: resp(three), loading: true });
    expect(screen.getByText('Updating')).toBeInTheDocument();
  });
});

describe('MetricSeriesView lines', () => {
  it('draws one chart with a legend table of min/avg/max/last', () => {
    render(MetricSeriesView, { response: resp(three), display: 'lines' });
    expect(chart.setOption).toHaveBeenCalled();
    const option = chart.setOption.mock.calls[0][0];
    expect(option.series).toHaveLength(3);
    const legend = screen.getByRole('table', { name: 'Series legend' });
    expect(within(legend).getAllByRole('row')).toHaveLength(4);
    expect(within(legend).getByText('90%')).toBeInTheDocument();
  });

  it('draws comparison series dashed', () => {
    const cmp = mk('A|a|cmp', 'alpha', 8, { comparison: true });
    render(MetricSeriesView, { response: resp([three[0], cmp]), display: 'lines' });
    const option = chart.setOption.mock.calls[0][0];
    const dashed = option.series.find((s: any) => s.id === 'A|a|cmp');
    expect(dashed.lineStyle.type).toBe('dashed');
    expect(option.series.find((s: any) => s.id === 'A|a').lineStyle.type).toBe('solid');
    expect(screen.getByText('alpha (previous)')).toBeInTheDocument();
  });

  it('uses bar series in bars mode', () => {
    render(MetricSeriesView, { response: resp(three), display: 'bars' });
    expect(chart.setOption.mock.calls[0][0].series[0].type).toBe('bar');
  });

  it('emits onSeriesClick from the legend', async () => {
    const onSeriesClick = vi.fn();
    render(MetricSeriesView, { response: resp(three), display: 'area', onSeriesClick });
    await fireEvent.click(screen.getByRole('button', { name: 'beta' }));
    expect(onSeriesClick).toHaveBeenCalledWith(three[1]);
  });

  it('emits onSeriesClick when the chart is clicked', () => {
    const onSeriesClick = vi.fn();
    render(MetricSeriesView, { response: resp(three), display: 'lines', onSeriesClick });
    const handler = chart.on.mock.calls.find((c) => c[0] === 'click')![1];
    handler({ seriesId: 'A|c' });
    expect(onSeriesClick).toHaveBeenCalledWith(three[2]);
  });
});

describe('MetricSeriesView split', () => {
  it('renders one card per series sorted by last value desc with current values', () => {
    render(MetricSeriesView, { response: resp(three), display: 'split' });
    const cards = screen.getAllByTestId('split-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('beta');
    expect(cards[0]).toHaveTextContent('90%');
    expect(cards[1]).toHaveTextContent('gamma');
    expect(cards[2]).toHaveTextContent('alpha');
  });

  it('applies a shared y range and lets the toggle remove it', async () => {
    render(MetricSeriesView, { response: resp(three), display: 'split' });
    expect(chart.setOption.mock.calls[0][0].yAxis[0]).toMatchObject({ min: 1, max: 90 });
    chart.setOption.mockClear();
    await fireEvent.click(screen.getByLabelText('Shared y axis'));
    const last = chart.setOption.mock.calls.at(-1)![0];
    expect(last.yAxis[0].min).toBeUndefined();
  });

  it('puts series without a value last', () => {
    render(MetricSeriesView, { response: resp([mk('A|n', 'nodata', null), mk('A|a', 'alpha', 5)]), display: 'split' });
    const cards = screen.getAllByTestId('split-card');
    expect(cards[0]).toHaveTextContent('alpha');
    expect(cards[1]).toHaveTextContent('nodata');
  });
});

describe('MetricSeriesView stat', () => {
  it('shows the last value per series', () => {
    render(MetricSeriesView, { response: resp(three), display: 'stat' });
    const cards = screen.getAllByTestId('stat-card');
    expect(cards).toHaveLength(3);
    expect(cards[1]).toHaveTextContent('90%');
    expect(screen.getAllByRole('img', { name: /trend/ })).toHaveLength(3);
  });

  it('can hide the spark', () => {
    render(MetricSeriesView, { response: resp(three), display: 'stat', showSpark: false });
    expect(screen.queryAllByRole('img', { name: /trend/ })).toHaveLength(0);
  });

  it('formats units per series', () => {
    const bytes = mk('A|x', 'x', 2048, { unit: 'By' });
    render(MetricSeriesView, { response: resp([bytes]), display: 'stat' });
    expect(screen.getByTestId('stat-card')).toHaveTextContent('2 KB');
  });
});

describe('MetricSeriesView table', () => {
  it('renders rows with a meter for percent units, colored by thresholds', () => {
    render(MetricSeriesView, { response: resp(three), display: 'table', thresholds: { warning: 50, critical: 80 } });
    const table = screen.getByRole('table', { name: 'Series table' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    const meters = within(table).getAllByRole('meter');
    expect(meters).toHaveLength(3);
    const beta = screen.getByRole('meter', { name: 'beta last value' });
    expect(beta.firstElementChild).toHaveClass('bg-destructive');
    expect(screen.getByRole('meter', { name: 'alpha last value' }).firstElementChild).toHaveClass('bg-success');
  });

  it('has no meter for non percent units', () => {
    render(MetricSeriesView, { response: resp([mk('A|x', 'x', 5, { unit: 'By' })]), display: 'table' });
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('scales 0-1 utilization ratios using the metric name', () => {
    const ratio = mk('A|x', 'x', 0.5, { unit: '1' });
    render(MetricSeriesView, {
      response: resp([ratio]),
      display: 'table',
      metricNames: { A: 'system.memory.utilization' },
    });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '50');
  });
});
