import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const completeItem = vi.fn();
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: (...a: unknown[]) => completeItem(...a) } }));

import CreateOrganizationDialog from './CreateOrganizationDialog.svelte';

function renderDialog(onSubmit: (d: { name: string; description?: string }) => Promise<void>) {
  return render(CreateOrganizationDialog, { props: { onSubmit, open: true } });
}

beforeEach(() => completeItem.mockReset());

describe('CreateOrganizationDialog', () => {
  it('uses sentence case copy', () => {
    renderDialog(vi.fn());
    expect(screen.getByRole('heading', { name: 'Create organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('disables submit while the trimmed name is empty', async () => {
    renderDialog(vi.fn());
    const submit = screen.getByRole('button', { name: 'Create organization' });
    expect(submit).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: '  ' } });
    expect(submit).toBeDisabled();
  });

  it('submits, completes the checklist item once and closes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderDialog(onSubmit);
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: ' Acme ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Acme', description: undefined }));
    expect(completeItem).toHaveBeenCalledTimes(1);
    expect(completeItem).toHaveBeenCalledWith('create-organization');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Create organization' })).toBeNull());
  });

  it('shows the error from a rejected onSubmit', async () => {
    renderDialog(vi.fn().mockRejectedValue(new Error('Slug in use')));
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: 'Acme' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('Slug in use')).toBeInTheDocument();
    expect(completeItem).not.toHaveBeenCalled();
  });

  it('shows Creating... only while submitting', async () => {
    let resolve!: () => void;
    renderDialog(vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r))));
    expect(screen.queryByText('Creating...')).toBeNull();
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: 'Acme' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('Creating...')).toBeInTheDocument();
    resolve();
    await waitFor(() => expect(screen.queryByText('Creating...')).toBeNull());
  });
});
