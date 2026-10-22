import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const completeItem = vi.fn();
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: (...a: unknown[]) => completeItem(...a) } }));

import CreateProjectDialog from './CreateProjectDialog.svelte';

function renderDialog(onSubmit: (d: { name: string; description?: string }) => Promise<void>) {
  return render(CreateProjectDialog, { props: { onSubmit, open: true } });
}

beforeEach(() => completeItem.mockReset());

describe('CreateProjectDialog', () => {
  it('uses sentence case copy', () => {
    renderDialog(vi.fn());
    expect(screen.getByRole('heading', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText('Create a project to organize your logs, traces and metrics.')).toBeInTheDocument();
  });

  it('disables submit while the trimmed name is empty', async () => {
    renderDialog(vi.fn());
    const submit = screen.getByRole('button', { name: 'Create project' });
    expect(submit).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Project name'), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Project name'), { target: { value: 'API' } });
    expect(submit).not.toBeDisabled();
  });

  it('submits the trimmed values, completes the checklist item once and closes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderDialog(onSubmit);
    await fireEvent.input(screen.getByLabelText('Project name'), { target: { value: '  API  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'API', description: undefined }));
    expect(completeItem).toHaveBeenCalledTimes(1);
    expect(completeItem).toHaveBeenCalledWith('create-project');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Create project' })).toBeNull());
  });

  it('shows the error from a rejected onSubmit and does not complete the checklist item', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Name already taken'));
    renderDialog(onSubmit);
    await fireEvent.input(screen.getByLabelText('Project name'), { target: { value: 'API' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Name already taken')).toBeInTheDocument();
    expect(completeItem).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Create project' })).toBeInTheDocument();
  });

  it('shows Creating... only while submitting', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderDialog(onSubmit);
    expect(screen.queryByText('Creating...')).toBeNull();
    await fireEvent.input(screen.getByLabelText('Project name'), { target: { value: 'API' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Creating...')).toBeInTheDocument();
    resolve();
    await waitFor(() => expect(screen.queryByText('Creating...')).toBeNull());
  });
});
