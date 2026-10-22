import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const setOption = vi.fn();
const dispatchAction = vi.fn();
const handlers: Record<string, (p: unknown) => void> = {};

vi.mock('echarts', () => ({
  init: () => ({
    setOption,
    dispatchAction,
    resize: vi.fn(),
    dispose: vi.fn(),
    on: (name: string, fn: (p: unknown) => void) => {
      handlers[name] = fn;
    },
    off: vi.fn(),
  }),
}));

import LatencyHistogram from './LatencyHistogram.svelte';

const bounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000];
const counts: number[] = [...bounds.map((_, i) => (i === 7 ? 40 : i === 8 ? 10 : 1)), 0];
const data = { bounds, counts };
const noSelection = { minMs: null, maxMs: null };

function lastOption(): any {
  return setOption.mock.calls[setOption.mock.calls.length - 1][0];
}

describe('LatencyHistogram', () => {
  beforeEach(() => {
    setOption.mockClear();
    dispatchAction.mockClear();
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  it('passes one bar series with counts to echarts', () => {
    render(LatencyHistogram, { data, loading: false, selection: noSelection, onBrush: () => {} });
    const opt = lastOption();
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0].type).toBe('bar');
    const values = opt.series[0].data.map((d: any) => (typeof d === 'number' ? d : d.value));
    expect(values).toEqual(counts);
    expect(opt.xAxis.data).toHaveLength(counts.length);
  });

  it('highlights buckets inside the selection', () => {
    render(LatencyHistogram, {
      data,
      loading: false,
      selection: { minMs: 100, maxMs: 500 },
      onBrush: () => {},
    });
    const items = lastOption().series[0].data;
    expect(items[7].itemStyle.opacity).toBe(1);
    expect(items[8].itemStyle.opacity).toBe(1);
    expect(items[3].itemStyle.opacity).toBeLessThan(1);
  });

  it('shows the empty state when every count is 0', () => {
    render(LatencyHistogram, {
      data: { bounds, counts: counts.map(() => 0) },
      loading: false,
      selection: noSelection,
      onBrush: () => {},
    });
    expect(screen.getByText('No requests in this range')).toBeInTheDocument();
  });

  it('Clear selection calls onBrush(null)', async () => {
    const onBrush = vi.fn();
    render(LatencyHistogram, {
      data,
      loading: false,
      selection: { minMs: 100, maxMs: 500 },
      onBrush,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onBrush).toHaveBeenCalledWith(null);
  });

  it('hides Clear selection without a selection', () => {
    render(LatencyHistogram, { data, loading: false, selection: noSelection, onBrush: () => {} });
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
  });

  it('a brush event calls onBrush with the mapped range', () => {
    const onBrush = vi.fn();
    render(LatencyHistogram, { data, loading: false, selection: noSelection, onBrush });
    handlers.brushSelected({ batch: [{ areas: [{ coordRange: [8, 7] }] }] });
    expect(onBrush).toHaveBeenCalledWith({ minMs: 100, maxMs: 500 });
  });
});
