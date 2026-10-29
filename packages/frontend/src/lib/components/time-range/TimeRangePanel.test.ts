import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { TIME_RANGE_PRESETS } from '@logtide/shared';
import TimeRangePanel from './TimeRangePanel.svelte';

const preset6h = { kind: 'preset', preset: '6h' } as const;

function setup(props: Record<string, unknown> = {}) {
  const onSelect = vi.fn();
  const utils = render(TimeRangePanel, {
    props: { value: preset6h, presets: [...TIME_RANGE_PRESETS], zone: 'UTC', onSelect, ...props },
  });
  return { onSelect, ...utils };
}

describe('TimeRangePanel', () => {
  it('renders all given presets with labels', () => {
    const { getByText, container } = setup();
    // 10 presets plus the custom toggle
    expect(container.querySelectorAll('button').length).toBe(11);
    expect(getByText('Last 15 minutes')).toBeTruthy();
    expect(getByText('Last 30 days')).toBeTruthy();
  });

  it('marks the active preset', () => {
    const { container } = setup();
    const pressed = container.querySelectorAll('button[aria-pressed="true"]');
    expect(pressed.length).toBe(1);
    expect(pressed[0].textContent?.trim()).toBe('Last 6 hours');
  });

  it('restricted presets render only those', () => {
    const { queryByText, getByText } = setup({ presets: ['1h', '24h'] });
    expect(getByText('Last hour')).toBeTruthy();
    expect(getByText('Last 24 hours')).toBeTruthy();
    expect(queryByText('Last 15 minutes')).toBeNull();
  });

  it('click calls onSelect with a preset value', async () => {
    const { getByText, onSelect } = setup();
    await fireEvent.click(getByText('Last 7 days'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'preset', preset: '7d' });
  });

  it('custom toggle reveals the editor', async () => {
    const { getByText, queryByLabelText } = setup();
    expect(queryByLabelText('From')).toBeNull();
    await fireEvent.click(getByText('Custom range'));
    expect(queryByLabelText('From')).toBeTruthy();
  });

  it('value of kind custom opens it by default', () => {
    const { queryByLabelText } = setup({
      value: { kind: 'custom', from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T11:00:00.000Z' },
    });
    expect(queryByLabelText('From')).toBeTruthy();
  });
});
