import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import IgnoreDialog from './IgnoreDialog.svelte';

function renderDialog(onConfirm = vi.fn()) {
  render(IgnoreDialog, { open: true, onConfirm });
  return onConfirm;
}

const confirmBtn = () => screen.getByRole('button', { name: 'Ignore' });

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function localInput(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe('IgnoreDialog', () => {
  it('forever confirms with an empty options object', async () => {
    const onConfirm = renderDialog();
    expect(confirmBtn()).toBeEnabled();
    await fireEvent.click(confirmBtn());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it('confirm disabled for a past date', async () => {
    renderDialog();
    await fireEvent.click(screen.getByLabelText('Until a date'));
    expect(confirmBtn()).toBeDisabled();

    const input = screen.getByLabelText('Ignore until') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: localInput(Date.now() - 3600 * 1000) } });
    expect(confirmBtn()).toBeDisabled();
    expect(screen.getByText('Pick a date in the future.')).toBeInTheDocument();

    await fireEvent.input(input, { target: { value: localInput(Date.now() + 3 * 3600 * 1000) } });
    expect(confirmBtn()).toBeEnabled();
  });

  it('preset 24 hours yields an ISO date about 24 hours ahead', async () => {
    const onConfirm = renderDialog();
    await fireEvent.click(screen.getByLabelText('Until a date'));
    await fireEvent.click(screen.getByRole('button', { name: '24 hours' }));
    expect(confirmBtn()).toBeEnabled();
    await fireEvent.click(confirmBtn());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const arg = onConfirm.mock.calls[0][0] as { ignoredUntil: string; ignoreUntilCount?: number };
    expect(arg.ignoreUntilCount).toBeUndefined();
    expect(arg.ignoredUntil).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const diff = new Date(arg.ignoredUntil).getTime() - Date.now();
    expect(Math.abs(diff - 24 * 3600 * 1000)).toBeLessThan(60 * 1000);
  });

  it('confirm disabled for count 0 and for 1000001', async () => {
    renderDialog();
    await fireEvent.click(screen.getByLabelText('Until N more events'));
    const input = screen.getByLabelText('Number of events') as HTMLInputElement;
    expect(confirmBtn()).toBeDisabled();

    await fireEvent.input(input, { target: { value: '0' } });
    expect(confirmBtn()).toBeDisabled();
    await fireEvent.input(input, { target: { value: '1000001' } });
    expect(confirmBtn()).toBeDisabled();
    await fireEvent.input(input, { target: { value: '-3' } });
    expect(confirmBtn()).toBeDisabled();
    await fireEvent.input(input, { target: { value: '1000000' } });
    expect(confirmBtn()).toBeEnabled();
  });

  it('count option yields ignoreUntilCount as a number', async () => {
    const onConfirm = renderDialog();
    await fireEvent.click(screen.getByLabelText('Until N more events'));
    await fireEvent.input(screen.getByLabelText('Number of events'), { target: { value: '50' } });
    await fireEvent.click(confirmBtn());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({ ignoreUntilCount: 50 });
  });

  it('does not render when closed', () => {
    render(IgnoreDialog, { open: false, onConfirm: vi.fn() });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
