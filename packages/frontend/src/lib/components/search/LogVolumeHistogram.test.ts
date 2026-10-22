import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const BASE = Date.UTC(2026, 9, 21, 10, 0, 0);
  const zr: Record<string, (e: { offsetX: number; offsetY: number }) => void> = {};
  const chart = {
    setOption: vi.fn(),
    on: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    getZr: () => ({
      on: (event: string, fn: (e: { offsetX: number; offsetY: number }) => void) => {
        zr[event] = fn;
      },
      off: vi.fn(),
    }),
    // Real ECharts: an axis finder converts one pixel value to one data value.
    convertFromPixel: vi.fn((_finder: unknown, x: number) => BASE + x * 1000),
    containPixel: vi.fn(() => true),
  };
  return { BASE, zr, chart, init: vi.fn(() => chart) };
});

vi.mock('echarts', () => ({ init: h.init }));

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import LogVolumeHistogram from './LogVolumeHistogram.svelte';
import type { LogHistogramBucket } from '$lib/api/logs';
import { themeStore } from '$lib/stores/theme';
import { displayPreferences } from '$lib/stores/display-preferences';

const iso = (ms: number) => new Date(ms).toISOString();

function buckets(n = 10): LogHistogramBucket[] {
  return Array.from({ length: n }, (_, i) => ({
    time: iso(h.BASE + i * 60_000),
    total: 3,
    byLevel: { info: 2, error: 1 },
  }));
}

function setup(p: Record<string, unknown> = {}) {
  const onRangeSelect = vi.fn();
  const onRetry = vi.fn();
  const utils = render(LogVolumeHistogram, {
    props: {
      buckets: buckets(),
      bucketSeconds: 60,
      total: 30,
      loading: false,
      error: null,
      onRangeSelect,
      onRetry,
      ...p,
    },
  });
  return { ...utils, onRangeSelect, onRetry };
}

function pointer(event: 'mousedown' | 'mousemove' | 'mouseup', offsetX: number) {
  h.zr[event]?.({ offsetX, offsetY: 20 });
}

beforeEach(() => {
  for (const k of Object.keys(h.zr)) delete h.zr[k];
  h.chart.setOption.mockClear();
  h.chart.dispose.mockClear();
  h.chart.containPixel.mockReturnValue(true);
  h.init.mockClear();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
});

describe('LogVolumeHistogram', () => {
  it('draws the stacked chart', () => {
    setup();
    expect(h.init).toHaveBeenCalledTimes(1);
    const option = h.chart.setOption.mock.calls.at(-1)?.[0] as { series: { name: string }[] };
    expect(option.series.map((s) => s.name)).toEqual(['Debug', 'Info', 'Warn', 'Error', 'Critical']);
  });

  it('shows the total count', async () => {
    const { rerender } = setup({ total: 12345 });
    expect(screen.getByText('12,345 logs')).toBeTruthy();
    await rerender({ total: 1 });
    expect(screen.getByText('1 log')).toBeTruthy();
    await rerender({ total: null });
    expect(screen.queryByText(/\blogs?\b/)).toBeNull();
  });

  it('click selects a bucket', () => {
    const { onRangeSelect } = setup();
    pointer('mousedown', 30);
    pointer('mouseup', 31);
    expect(onRangeSelect).toHaveBeenCalledTimes(1);
    const [from, to] = onRangeSelect.mock.calls[0] as [Date, Date];
    expect(from.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-21T10:01:00.000Z');
  });

  it('selects absolute instants whatever the display zone', () => {
    displayPreferences.set({ hour12: false, timeZone: 'America/New_York' });
    const { onRangeSelect } = setup();
    pointer('mousedown', 30);
    pointer('mouseup', 30);
    const [from, to] = onRangeSelect.mock.calls[0] as [Date, Date];
    expect(from.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-21T10:01:00.000Z');
  });

  it('labels the axis in the display zone', () => {
    displayPreferences.set({ hour12: false, timeZone: 'Asia/Tokyo' });
    setup();
    const option = h.chart.setOption.mock.calls.at(-1)?.[0] as {
      xAxis: { axisLabel: { formatter: (v: number) => string } };
    };
    expect(option.xAxis.axisLabel.formatter(h.BASE)).toBe('19:00');
  });

  it('drag selects a window', async () => {
    const { onRangeSelect, container } = setup();
    pointer('mousedown', 30);
    pointer('mousemove', 120);
    await tick();
    expect(container.querySelector('[data-testid="histogram-selection"]')).not.toBeNull();
    pointer('mouseup', 200);
    await tick();
    const [from, to] = onRangeSelect.mock.calls[0] as [Date, Date];
    expect(from.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-21T10:04:00.000Z');
    expect(container.querySelector('[data-testid="histogram-selection"]')).toBeNull();
  });

  it('ignores a press outside the plot area', () => {
    const { onRangeSelect } = setup();
    h.chart.containPixel.mockReturnValue(false);
    pointer('mousedown', 2);
    pointer('mouseup', 2);
    expect(onRangeSelect).not.toHaveBeenCalled();
  });

  it('ignores pointer selection when disabled', () => {
    const { onRangeSelect } = setup({ disabled: true });
    pointer('mousedown', 30);
    pointer('mouseup', 31);
    pointer('mousedown', 30);
    pointer('mousemove', 200);
    pointer('mouseup', 200);
    expect(onRangeSelect).not.toHaveBeenCalled();
  });

  it('ignores pointer selection without buckets', () => {
    const { onRangeSelect } = setup({ buckets: [] });
    pointer('mousedown', 30);
    pointer('mouseup', 31);
    expect(onRangeSelect).not.toHaveBeenCalled();
  });

  it('shows an error with Retry', async () => {
    const { onRetry } = setup({ error: 'boom' });
    expect(screen.getByText('Could not load the histogram')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a skeleton while the first load runs', () => {
    setup({ buckets: [], total: null, loading: true });
    expect(screen.getByTestId('histogram-loading')).toBeTruthy();
  });

  it('redraws on new data, theme and display preference changes', async () => {
    const { rerender } = setup();
    const before = h.chart.setOption.mock.calls.length;
    await rerender({ buckets: buckets(5) });
    await tick();
    const afterData = h.chart.setOption.mock.calls.length;
    expect(afterData).toBeGreaterThan(before);
    const last = h.chart.setOption.mock.calls.at(-1)?.[0] as { series: { data: unknown[] }[] };
    expect(last.series[0].data).toHaveLength(5);
    themeStore.toggle();
    await tick();
    const afterTheme = h.chart.setOption.mock.calls.length;
    expect(afterTheme).toBeGreaterThan(afterData);
    displayPreferences.set({ hour12: true, timeZone: 'UTC' });
    await tick();
    expect(h.chart.setOption.mock.calls.length).toBeGreaterThan(afterTheme);
  });

  it('disposes the chart on destroy', () => {
    const { unmount } = setup();
    unmount();
    expect(h.chart.dispose).toHaveBeenCalledTimes(1);
  });
});
