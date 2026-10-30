import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import LiveTailControls from './LiveTailControls.svelte';
import { stateTone } from '$lib/utils/severity';
import type { LiveTailState } from './live-tail';

type Props = {
  live: boolean;
  state: LiveTailState;
  pausedBy: 'manual' | 'scroll' | null;
  limit: number;
  disabled: boolean;
};

function setup(over: Partial<Props> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onRetry: vi.fn(),
    onLimitChange: vi.fn(),
  };
  const utils = render(LiveTailControls, {
    props: { live: false, state: 'disconnected', pausedBy: null, limit: 100, ...over, ...handlers },
  });
  return { ...utils, ...handlers };
}

describe('LiveTailControls', () => {
  it('toggles live tail from the switch', async () => {
    const utils = setup();
    const toggle = utils.getByRole('switch', { name: 'Live tail' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await fireEvent.click(toggle);
    expect(utils.onToggle).toHaveBeenCalledWith(true);
  });

  it('turns live tail off from the switch', async () => {
    const utils = setup({ live: true, state: 'live' });
    const toggle = utils.getByRole('switch', { name: 'Live tail' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await fireEvent.click(toggle);
    expect(utils.onToggle).toHaveBeenCalledWith(false);
  });

  it('shows no state, pause or size controls while off', () => {
    const utils = setup();
    expect(utils.queryByRole('status')).toBeNull();
    expect(utils.queryByRole('button', { name: /live tail/i })).toBeNull();
    expect(utils.queryByRole('combobox', { name: 'Rows kept in live tail' })).toBeNull();
  });

  it.each([
    ['connecting', 'Connecting', 'pending'],
    ['live', 'Live', 'ok'],
    ['reconnecting', 'Reconnecting', 'acknowledged'],
    ['disconnected', 'Disconnected', 'failed'],
  ] as const)('labels the %s state', (state, label, tone) => {
    const utils = setup({ live: true, state });
    const status = utils.getByRole('status');
    expect(status).toHaveTextContent(label);
    for (const cls of stateTone(tone).badge.split(' ')) expect(status.className).toContain(cls);
  });

  it('pulses the dot only while live', () => {
    const live = setup({ live: true, state: 'live' });
    expect(live.getByRole('status').querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
    live.unmount();
    const connecting = setup({ live: true, state: 'connecting' });
    expect(connecting.getByRole('status').querySelector('.motion-safe\\:animate-pulse')).toBeNull();
  });

  it('swaps Pause and Resume with pausedBy', async () => {
    const utils = setup({ live: true, state: 'live' });
    await fireEvent.click(utils.getByRole('button', { name: 'Pause live tail' }));
    expect(utils.onPause).toHaveBeenCalledTimes(1);
    expect(utils.queryByRole('button', { name: 'Resume live tail' })).toBeNull();
    await utils.rerender({ pausedBy: 'scroll' });
    expect(utils.queryByRole('button', { name: 'Pause live tail' })).toBeNull();
    await fireEvent.click(utils.getByRole('button', { name: 'Resume live tail' }));
    expect(utils.onResume).toHaveBeenCalledTimes(1);
  });

  it('says why the tail is paused', async () => {
    const utils = setup({ live: true, state: 'live', pausedBy: 'scroll' });
    expect(utils.getByText('Paused while scrolled')).toBeInTheDocument();
    await utils.rerender({ pausedBy: 'manual' });
    expect(utils.getByText('Paused')).toBeInTheDocument();
  });

  it('offers Reconnect only when disconnected', async () => {
    const utils = setup({ live: true, state: 'reconnecting' });
    expect(utils.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    await utils.rerender({ state: 'disconnected' });
    await fireEvent.click(utils.getByRole('button', { name: 'Reconnect' }));
    expect(utils.onRetry).toHaveBeenCalledTimes(1);
  });

  it('changes the buffer size', async () => {
    const utils = setup({ live: true, state: 'live' });
    const select = utils.getByRole('combobox', { name: 'Rows kept in live tail' }) as HTMLSelectElement;
    expect(select.value).toBe('100');
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['50', '100', '200', '500', '1,000']);
    await fireEvent.change(select, { target: { value: '500' } });
    expect(utils.onLimitChange).toHaveBeenCalledWith(500);
  });

  it('disables the switch', async () => {
    const utils = setup({ disabled: true });
    const toggle = utils.getByRole('switch', { name: 'Live tail' });
    expect(toggle).toBeDisabled();
    await fireEvent.click(toggle);
    expect(utils.onToggle).not.toHaveBeenCalled();
  });
});
