import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import SnoozeMenu from './SnoozeMenu.svelte';
import type { AlertRule } from '$lib/api/alerts';

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return { id: 'r1', enabled: true, snoozedUntil: null, ...over } as AlertRule;
}

async function open() {
  await fireEvent.click(screen.getByRole('button', { name: 'Snooze alert' }));
  await screen.findByRole('button', { name: 'Snooze for 1 hour' });
}

afterEach(() => cleanup());

describe('SnoozeMenu', () => {
  it('trigger has accessible name', () => {
    render(SnoozeMenu, { props: { rule: rule(), onSnooze: vi.fn(), onUnsnooze: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Snooze alert' })).toBeTruthy();
  });

  it('offers 1 h, 4 h, 24 h presets and emits an ISO time about now + preset', async () => {
    const onSnooze = vi.fn();
    render(SnoozeMenu, { props: { rule: rule(), onSnooze, onUnsnooze: vi.fn() } });
    await open();
    expect(screen.getByRole('button', { name: 'Snooze for 4 hours' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Snooze for 24 hours' })).toBeTruthy();

    const before = Date.now();
    await fireEvent.click(screen.getByRole('button', { name: 'Snooze for 4 hours' }));
    expect(onSnooze).toHaveBeenCalledTimes(1);
    const iso = onSnooze.mock.calls[0][0] as string;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const delta = new Date(iso).getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(4 * 3_600_000);
    expect(delta).toBeLessThan(4 * 3_600_000 + 5_000);
  });

  it('Unsnooze only visible when snoozed', async () => {
    const onUnsnooze = vi.fn();
    const { unmount } = render(SnoozeMenu, {
      props: { rule: rule(), onSnooze: vi.fn(), onUnsnooze },
    });
    await open();
    expect(screen.queryByRole('button', { name: 'Unsnooze' })).toBeNull();
    unmount();
    cleanup();

    const until = new Date(Date.now() + 3_600_000).toISOString();
    render(SnoozeMenu, {
      props: { rule: rule({ snoozedUntil: until }), onSnooze: vi.fn(), onUnsnooze },
    });
    await open();
    await fireEvent.click(screen.getByRole('button', { name: 'Unsnooze' }));
    expect(onUnsnooze).toHaveBeenCalledTimes(1);
  });

  it('a snooze that already expired does not offer Unsnooze', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    render(SnoozeMenu, {
      props: { rule: rule({ snoozedUntil: past }), onSnooze: vi.fn(), onUnsnooze: vi.fn() },
    });
    await open();
    expect(screen.queryByRole('button', { name: 'Unsnooze' })).toBeNull();
  });

  it('until-date requires a future time', async () => {
    const onSnooze = vi.fn();
    render(SnoozeMenu, { props: { rule: rule(), onSnooze, onUnsnooze: vi.fn() } });
    await open();
    await fireEvent.click(screen.getByRole('button', { name: 'Snooze until...' }));
    const input = await screen.findByLabelText('Snooze until');

    await fireEvent.input(input, { target: { value: '2020-01-01T10:00' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    expect(onSnooze).not.toHaveBeenCalled();
    expect(await screen.findByText('Choose a time in the future')).toBeTruthy();

    const future = new Date(Date.now() + 2 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
    await fireEvent.input(input, { target: { value: local } });
    await fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    await waitFor(() => expect(onSnooze).toHaveBeenCalledTimes(1));
    expect(new Date(onSnooze.mock.calls[0][0]).getTime()).toBeGreaterThan(Date.now());
  });
});
