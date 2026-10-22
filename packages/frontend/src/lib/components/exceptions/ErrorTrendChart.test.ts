import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { levelTone } from '$lib/utils/severity';
import { formatTimestamp } from '$lib/utils/datetime';

const { setOption, dispose, init } = vi.hoisted(() => {
  const setOption = vi.fn();
  const dispose = vi.fn();
  const init = vi.fn(() => ({ setOption, dispose, resize: vi.fn() }));
  return { setOption, dispose, init };
});

vi.mock('echarts', () => ({ init }));

import ErrorTrendChart from './ErrorTrendChart.svelte';

beforeEach(() => {
  setOption.mockClear();
  dispose.mockClear();
  init.mockClear();
});

const FROM = '2026-10-20T00:00:00.000Z';
const HOUR = 60 * 60 * 1000;

describe('ErrorTrendChart', () => {
  it('passes counts and bucket start labels to echarts', () => {
    render(ErrorTrendChart, { counts: [1, 0, 4], from: FROM, bucketMs: HOUR });
    const option = setOption.mock.calls.at(-1)![0] as any;
    expect(option.series[0].type).toBe('bar');
    expect(option.series[0].data).toEqual([1, 0, 4]);
    expect(option.series[0].itemStyle.color).toBe(levelTone('error').chart);
    const starts = [0, 1, 2].map((i) =>
      formatTimestamp(new Date(new Date(FROM).getTime() + i * HOUR), { precision: 'minute' })
    );
    expect(option.xAxis.data).toEqual(starts);
  });

  it('exposes an accessible label', () => {
    render(ErrorTrendChart, { counts: [1, 2], from: FROM, bucketMs: HOUR });
    expect(screen.getByRole('img', { name: 'Events over time' })).toBeInTheDocument();
  });

  it('disposes on destroy', () => {
    const { unmount } = render(ErrorTrendChart, { counts: [1], from: FROM, bucketMs: HOUR });
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
