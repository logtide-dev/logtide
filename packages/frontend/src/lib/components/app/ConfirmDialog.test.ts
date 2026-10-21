import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import ConfirmDialog from './ConfirmDialog.svelte';

const base = {
  open: true,
  title: 'Delete project',
  description: 'This cannot be undone.',
  confirmLabel: 'Delete project',
};

function confirmBtn() {
  return screen.getByRole('button', { name: /Delete project/ });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ConfirmDialog', () => {
  it('renders title, description and confirm label when open', () => {
    render(ConfirmDialog, { ...base, onConfirm: vi.fn() });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(confirmBtn()).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(ConfirmDialog, { ...base, open: false, onConfirm: vi.fn() });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('calls onConfirm once and closes', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(ConfirmDialog, { ...base, onConfirm });
    await fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores a second rapid click while the first is pending', async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(ConfirmDialog, { ...base, onConfirm });
    const btn = confirmBtn();
    await fireEvent.click(btn);
    await fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('stays open and re-enables the button when onConfirm rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onConfirm = vi.fn().mockRejectedValue(new Error('nope'));
    render(ConfirmDialog, { ...base, onConfirm });
    await fireEvent.click(confirmBtn());
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await waitFor(() => expect(confirmBtn()).not.toBeDisabled());
  });

  it('requires the exact text, trimming only the typed input', async () => {
    const onConfirm = vi.fn();
    render(ConfirmDialog, { ...base, requireText: 'acme', onConfirm });
    const input = screen.getByLabelText(/to confirm/);
    for (const bad of ['', 'ACME', 'acm']) {
      await fireEvent.input(input, { target: { value: bad } });
      expect(confirmBtn()).toBeDisabled();
    }
    await fireEvent.input(input, { target: { value: 'acme' } });
    expect(confirmBtn()).not.toBeDisabled();
    await fireEvent.input(input, { target: { value: '  acme ' } });
    expect(confirmBtn()).not.toBeDisabled();
  });

  it('clears the typed text when reopened', async () => {
    const { rerender } = render(ConfirmDialog, {
      ...base,
      requireText: 'acme',
      onConfirm: vi.fn(),
    });
    await fireEvent.input(screen.getByLabelText(/to confirm/), { target: { value: 'acme' } });
    expect(confirmBtn()).not.toBeDisabled();
    await rerender({ open: false });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await rerender({ open: true });
    const input = (await screen.findByLabelText(/to confirm/)) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(confirmBtn()).toBeDisabled();
  });

  it('uses the destructive variant by default and the default variant otherwise', () => {
    const a = render(ConfirmDialog, { ...base, onConfirm: vi.fn() });
    expect(confirmBtn().className).toContain('bg-destructive');
    a.unmount();
    render(ConfirmDialog, { ...base, destructive: false, onConfirm: vi.fn() });
    expect(confirmBtn().className).not.toContain('bg-destructive');
    expect(confirmBtn().className).toContain('bg-primary');
  });

  it('disables both buttons while busy', () => {
    render(ConfirmDialog, { ...base, busy: true, onConfirm: vi.fn() });
    expect(confirmBtn()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
