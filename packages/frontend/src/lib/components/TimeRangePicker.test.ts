import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { render, fireEvent } from '@testing-library/svelte';
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
