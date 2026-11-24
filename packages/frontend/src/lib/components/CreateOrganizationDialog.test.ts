import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const completeItem = vi.fn();
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: (...a: unknown[]) => completeItem(...a) } }));

const getLimits = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/organizations', () => ({ organizationsAPI: { getLimits: (...a: unknown[]) => getLimits(...a) } }));

import CreateOrganizationDialog from './CreateOrganizationDialog.svelte';

const limits = (over: Record<string, unknown> = {}) => ({
  limits: {
    owned: 1,
    maxOwned: 3,
    createdThisMonth: 1,
    maxCreationsPerMonth: null,
    canCreate: true,
    blockedBy: null,
    ...over,
  },
});

function renderDialog(onSubmit: (d: { name: string; description?: string }) => Promise<void>) {
  return render(CreateOrganizationDialog, { props: { onSubmit, open: true } });
}

beforeEach(() => {
  completeItem.mockReset();
  getLimits.mockReset();
  getLimits.mockResolvedValue(limits({ maxOwned: null }));
});

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

  it('says nothing about limits when the instance has none', async () => {
    renderDialog(vi.fn());
    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    expect(screen.queryByTestId('org-limit-usage')).toBeNull();
    expect(screen.queryByTestId('org-limit-reached')).toBeNull();
  });

  it('shows how many organizations the user owns against the limit', async () => {
    getLimits.mockResolvedValue(limits());
    renderDialog(vi.fn());
    expect(await screen.findByTestId('org-limit-usage')).toHaveTextContent('You own 1 of 3 organizations.');
  });

  it('explains a reached limit and blocks the submit', async () => {
    getLimits.mockResolvedValue(limits({ owned: 3, canCreate: false, blockedBy: 'owned' }));
    renderDialog(vi.fn());
    expect(await screen.findByTestId('org-limit-reached')).toHaveTextContent(
      'You already own 3 organizations, the most your account can own (3).',
    );
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: 'Acme' } });
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeDisabled();
  });

  it('keeps the form usable when the limits cannot be loaded', async () => {
    getLimits.mockRejectedValue(new Error('offline'));
    renderDialog(vi.fn());
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: 'Acme' } });
    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
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
