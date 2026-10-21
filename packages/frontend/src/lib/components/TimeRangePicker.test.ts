import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import TimeRangePicker from './TimeRangePicker.svelte';
import { displayPreferences } from '$lib/stores/display-preferences';

beforeEach(() => {
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
});

describe('TimeRangePicker controlled mode', () => {
  it('shows the preset label on the trigger', () => {
    const { getByText } = render(TimeRangePicker, {
      props: { value: { kind: 'preset', preset: '6h' }, onValueChange: vi.fn() },
    });
    expect(getByText('Last 6 hours')).toBeTruthy();
  });

  it('shows the real custom range on the trigger', () => {
    const { getByText } = render(TimeRangePicker, {
      props: {
        value: { kind: 'custom', from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T11:00:00.000Z' },
        onValueChange: vi.fn(),
      },
    });
    expect(getByText('Oct 21, 10:00 to 11:00')).toBeTruthy();
  });

  it('opening lists every preset and picking one calls onValueChange', async () => {
    const onValueChange = vi.fn();
    const { getByRole, findByText } = render(TimeRangePicker, {
      props: { value: { kind: 'preset', preset: '6h' }, onValueChange },
    });
    await fireEvent.click(getByRole('button', { name: /Last 6 hours/ }));
    expect(await findByText('Last 15 minutes')).toBeTruthy();
    await fireEvent.click(await findByText('Last 30 days'));
    expect(onValueChange).toHaveBeenCalledWith({ kind: 'preset', preset: '30d' });
  });

  it('presets prop restricts the list', async () => {
    const { getByRole, findByText, queryByText } = render(TimeRangePicker, {
      props: {
        value: { kind: 'preset', preset: '1h' },
        onValueChange: vi.fn(),
        presets: ['1h', '24h'],
      },
    });
    await fireEvent.click(getByRole('button', { name: /Last hour/ }));
    expect(await findByText('Last 24 hours')).toBeTruthy();
    expect(queryByText('Last 30 days')).toBeNull();
  });
});

describe('TimeRangePicker legacy mode', () => {
  it('renders legacy presets only', () => {
    const { getByRole, queryByRole } = render(TimeRangePicker, {});
    expect(getByRole('button', { name: 'Last hour' })).toBeTruthy();
    expect(getByRole('button', { name: 'Last 24 hours' })).toBeTruthy();
    expect(getByRole('button', { name: 'Last 7 days' })).toBeTruthy();
    expect(getByRole('button', { name: 'Custom range' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Last 15 minutes' })).toBeNull();
  });

  it('getType and onchange follow clicks', async () => {
    const onchange = vi.fn();
    const { getByRole, component } = render(TimeRangePicker, { props: { onchange } });
    await fireEvent.click(getByRole('button', { name: 'Last hour' }));
    expect(component.getType()).toBe('last_hour');
    expect(onchange).toHaveBeenCalledTimes(1);
    const { from, to } = onchange.mock.calls[0][0];
    expect(Math.abs(to.getTime() - from.getTime() - 3600000)).toBeLessThan(1000);
  });

  it('setTimeRange custom then getCustomValues returns datetime-local strings', async () => {
    const { component } = render(TimeRangePicker, {});
    component.setTimeRange('custom', '2026-10-21T10:00:00.000Z', '2026-10-21T11:00:00.000Z');
    await tick();
    const values = component.getCustomValues();
    expect(values.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(values.to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(component.getType()).toBe('custom');
  });

  it('initialType custom shows the From input', () => {
    const { getByLabelText } = render(TimeRangePicker, {
      props: {
        initialType: 'custom',
        initialCustomFrom: '2026-10-21T10:00',
        initialCustomTo: '2026-10-21T11:00',
      },
    });
    expect((getByLabelText('From') as HTMLInputElement).value).toBe('2026-10-21T10:00');
  });
});
