import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  on: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('echarts', () => ({ init: vi.fn(() => chart) }));

import MetricChart from './MetricChart.svelte';
import type { MetricAggregateResult } from '$lib/api/metrics';

const base: MetricAggregateResult = {
  metricName: 'cpu',
  metricType: 'gauge',
  timeseries: [
    { bucket: '2026-01-01T00:00:00Z', value: 1 },
    { bucket: '2026-01-01T00:05:00Z', value: 2 },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('MetricChart', () => {
  it('shows capped-series notice when seriesTotal > seriesShown', () => {
    render(MetricChart, {
      result: { ...base, seriesTotal: 340, seriesShown: 20 },
      unit: null,
      loading: false,
      error: null,
    });
    expect(screen.getByText(/Showing 20 of 340 series/)).toBeInTheDocument();
    expect(chart.setOption).toHaveBeenCalled();
  });

  it('shows no notice when every series is shown', () => {
    render(MetricChart, {
      result: { ...base, seriesTotal: 3, seriesShown: 3 },
      unit: null,
      loading: false,
      error: null,
    });
    expect(screen.queryByText(/series, the ones/)).toBeNull();
  });

  it('shows an error state', () => {
    render(MetricChart, { result: null, unit: null, loading: false, error: 'bad request' });
    expect(screen.getByRole('alert')).toHaveTextContent('bad request');
  });

  it('shows the empty state without data', () => {
    render(MetricChart, { result: { ...base, timeseries: [] }, unit: null, loading: false, error: null });
    expect(screen.getByText('No data for this query')).toBeInTheDocument();
  });

  it('click on a bucket reports its start and the bucket size', () => {
    const onBucketClick = vi.fn();
    render(MetricChart, {
      result: { ...base, bucketSeconds: 300 },
      unit: null,
      loading: false,
      error: null,
      onBucketClick,
    });
    const handler = chart.on.mock.calls.find((c) => c[0] === 'click')![1];
    handler({ value: [Date.parse('2026-01-01T00:05:00Z'), 2] });
    expect(onBucketClick).toHaveBeenCalledWith(new Date('2026-01-01T00:05:00Z'), 300);
  });
});
