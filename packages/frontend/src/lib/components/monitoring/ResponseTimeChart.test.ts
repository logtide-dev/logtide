import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('echarts', () => ({
  init: vi.fn(() => chart),
}));

import ResponseTimeChart from './ResponseTimeChart.svelte';

const POINTS = [
  { time: '2026-10-22T10:00:00Z', avgMs: 120, p95Ms: 300, failures: 0 },
  { time: '2026-10-22T10:05:00Z', avgMs: null, p95Ms: null, failures: 2 },
  { time: '2026-10-22T10:10:00Z', avgMs: 140, p95Ms: 320, failures: 0 },
];

beforeEach(() => {
  chart.setOption.mockReset();
  chart.dispose.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});

describe('ResponseTimeChart', () => {
  it('shows an EmptyState without points', () => {
    render(ResponseTimeChart, { props: { points: [], range: '24h', onRangeChange: vi.fn() } });
    expect(screen.getByText('No response times yet')).toBeInTheDocument();
    expect(chart.setOption).not.toHaveBeenCalled();
  });

  it('shows an EmptyState when every bucket is empty', () => {
    render(ResponseTimeChart, {
      props: {
        points: [{ time: '2026-10-22T10:00:00Z', avgMs: null, p95Ms: null, failures: 1 }],
        range: '24h',
        onRangeChange: vi.fn(),
      },
    });
    expect(screen.getByText('No response times yet')).toBeInTheDocument();
  });

  it('builds Average and p95 series and calls onRangeChange', async () => {
    const onRangeChange = vi.fn();
    render(ResponseTimeChart, { props: { points: POINTS, range: '24h', onRangeChange } });
    await waitFor(() => expect(chart.setOption).toHaveBeenCalled());
    const option = chart.setOption.mock.calls[chart.setOption.mock.calls.length - 1][0];
    expect(option.series.map((s: { name: string }) => s.name)).toEqual(['Average', 'p95']);
    expect(option.series[0].data).toEqual([120, null, 140]);
    expect(option.series[1].data).toEqual([300, null, 320]);

    await fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(onRangeChange).toHaveBeenCalledWith('7d');
    expect(screen.getByRole('button', { name: '24 hours' })).toHaveAttribute('aria-pressed', 'true');
  });
});
