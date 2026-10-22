import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BulkActionBar from './BulkActionBar.svelte';

const members = [{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }];

function setup(over: Record<string, unknown> = {}) {
  const handlers = {
    onResolve: vi.fn(),
    onReopen: vi.fn(),
    onIgnore: vi.fn(),
    onAssign: vi.fn(),
    onClear: vi.fn(),
  };
  render(BulkActionBar, { count: 3, members, ...handlers, ...over });
  return handlers;
}

describe('BulkActionBar', () => {
  it('renders the selected count with en-US formatting for 1234', () => {
    setup({ count: 1234 });
    expect(screen.getByText('1,234 selected')).toBeInTheDocument();
  });

  it('Resolve calls onResolve and Reopen calls onReopen', async () => {
    const h = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(h.onResolve).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(h.onReopen).toHaveBeenCalledTimes(1);
  });

  it('Ignore opens the dialog and confirm calls onIgnore with options', async () => {
    const h = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await fireEvent.click(screen.getByLabelText('Until N more events'));
    await fireEvent.input(screen.getByLabelText('Number of events'), { target: { value: '10' } });
    const dialog = screen.getByRole('dialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Ignore')!;
    await fireEvent.click(confirm);

    await waitFor(() => expect(h.onIgnore).toHaveBeenCalledTimes(1));
    expect(h.onIgnore).toHaveBeenCalledWith({ ignoreUntilCount: 10 });
  });

  it('Assign passes null for Unassigned', async () => {
    const h = setup();
    const trigger = screen.getByRole('button', { name: 'Assign selected errors' });
    expect(trigger).toHaveTextContent('Assign');
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Unassigned/ }));
    expect(h.onAssign).toHaveBeenCalledWith(null);
  });

  it('Assign passes the member id', async () => {
    const h = setup();
    const trigger = screen.getByRole('button', { name: 'Assign selected errors' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Ada Lovelace/ }));
    expect(h.onAssign).toHaveBeenCalledWith('u1');
  });

  it('Clear selection calls onClear', async () => {
    const h = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(h.onClear).toHaveBeenCalledTimes(1);
  });

  it('disables the actions while busy', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
  });
});
