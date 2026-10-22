import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import RenameDashboardDialog from './RenameDashboardDialog.svelte';

function mount(overrides: Record<string, unknown> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(RenameDashboardDialog, {
    props: {
      open: true,
      name: 'Home',
      description: 'Main board',
      onSave,
      onOpenChange,
      ...overrides,
    },
  });
  return { onSave, onOpenChange };
}

describe('RenameDashboardDialog', () => {
  it('starts from the current name and description', async () => {
    mount();
    expect(await screen.findByLabelText('Name')).toHaveValue('Home');
    expect(screen.getByLabelText('Description (optional)')).toHaveValue('Main board');
  });

  it('disables Save for an empty name', async () => {
    mount();
    const input = await screen.findByLabelText('Name');
    await fireEvent.input(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves trimmed values and closes', async () => {
    const { onSave, onOpenChange } = mount();
    const input = await screen.findByLabelText('Name');
    await fireEvent.input(input, { target: { value: '  Ops  ' } });
    await fireEvent.input(screen.getByLabelText('Description (optional)'), {
      target: { value: '   ' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: 'Ops', description: null }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('stays open when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('nope'));
    const { onOpenChange } = mount({ onSave });
    await screen.findByLabelText('Name');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
