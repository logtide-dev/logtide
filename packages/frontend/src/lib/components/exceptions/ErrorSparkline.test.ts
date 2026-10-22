import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { levelTone } from '$lib/utils/severity';

const { setOption, dispose, init } = vi.hoisted(() => {
  const setOption = vi.fn();
  const dispose = vi.fn();
  const init = vi.fn(() => ({ setOption, dispose, resize: vi.fn() }));
  return { setOption, dispose, init };
});

vi.mock('echarts', () => ({ init }));

import ErrorSparkline from './ErrorSparkline.svelte';

beforeEach(() => {
  setOption.mockClear();
  dispose.mockClear();
  init.mockClear();
});

describe('ErrorSparkline', () => {
  it('inits echarts with the counts and the error tone colour', () => {
    render(ErrorSparkline, { counts: [0, 2, 5, 1], label: 'Events in the last 24 hours' });

    expect(init).toHaveBeenCalledTimes(1);
    expect((init.mock.calls[0] as unknown[])[2]).toEqual({ renderer: 'svg' });
    expect(setOption).toHaveBeenCalled();
    const option = setOption.mock.calls.at(-1)![0] as any;
    expect(option.series[0].data).toEqual([0, 2, 5, 1]);
    expect(option.series[0].lineStyle.color).toBe(levelTone('error').chart);
  });

  it('renders a flat baseline when all counts are zero', () => {
    render(ErrorSparkline, { counts: [0, 0, 0], label: 'x' });
    const option = setOption.mock.calls.at(-1)![0] as any;
    expect(option.series[0].data).toEqual([0, 0, 0]);
    expect(option.yAxis.min).toBe(0);
    expect(option.yAxis.max).toBe(1);
  });

  it('redraws when counts change', async () => {
    const { rerender } = render(ErrorSparkline, { counts: [1, 1], label: 'x' });
    await rerender({ counts: [4, 0, 9], label: 'x' });
    const option = setOption.mock.calls.at(-1)![0] as any;
    expect(option.series[0].data).toEqual([4, 0, 9]);
  });

  it('disposes on destroy', () => {
    const { unmount } = render(ErrorSparkline, { counts: [1], label: 'x' });
    expect(dispose).not.toHaveBeenCalled();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('exposes the label as aria-label', () => {
    render(ErrorSparkline, { counts: [1], label: 'Events in the last 24 hours' });
    expect(screen.getByLabelText('Events in the last 24 hours')).toBeInTheDocument();
  });
});
