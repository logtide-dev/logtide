import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { SigmaException } from '@logtide/shared';

const createException = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/sigma', () => ({ sigmaAPI: { createException } }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import AddExceptionDialog from './AddExceptionDialog.svelte';

const base = { open: true, organizationId: 'org-1', ruleId: 'rule-1', ruleTitle: 'Suspicious login' };

function created(): SigmaException {
  return {
    id: 'ex-1',
    ruleId: 'rule-1',
    conditions: [],
    reason: null,
    expiresAt: null,
    hitCount: 0,
    lastHitAt: null,
    createdBy: null,
    createdAt: '2026-10-22T00:00:00.000Z',
  };
}

beforeEach(() => {
  createException.mockReset();
});
afterEach(() => {
  cleanup();
});

describe('AddExceptionDialog', () => {
  it('prefill populates condition rows', () => {
    render(AddExceptionDialog, {
      ...base,
      prefill: {
        conditions: [
          { field: 'service', operator: 'equals', values: ['billing'] },
          { field: 'user', operator: 'contains', values: ['bot'] },
        ],
        reason: 'Marked as false positive',
      },
    });
    expect((screen.getByLabelText('Field 1') as HTMLInputElement).value).toBe('service');
    expect((screen.getByLabelText('Value 1') as HTMLInputElement).value).toBe('billing');
    expect((screen.getByLabelText('Field 2') as HTMLInputElement).value).toBe('user');
    expect((screen.getByLabelText('Operator 2') as HTMLSelectElement).value).toBe('contains');
    expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe(
      'Marked as false positive',
    );
  });

  it('submit disabled with no value', async () => {
    render(AddExceptionDialog, base);
    const submit = screen.getByRole('button', { name: 'Add exception' });
    expect(submit).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Field 1'), { target: { value: 'service' } });
    expect(submit).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Value 1'), { target: { value: 'billing' } });
    expect(submit).toBeEnabled();
  });

  it('in operator splits comma separated values', async () => {
    createException.mockResolvedValue({ exception: created() });
    render(AddExceptionDialog, base);
    await fireEvent.input(screen.getByLabelText('Field 1'), { target: { value: 'level' } });
    await fireEvent.change(screen.getByLabelText('Operator 1'), { target: { value: 'in' } });
    await fireEvent.input(screen.getByLabelText('Value 1'), { target: { value: 'debug, info ,, warn' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add exception' }));
    await waitFor(() => expect(createException).toHaveBeenCalled());
    expect(createException).toHaveBeenCalledWith('rule-1', 'org-1', {
      conditions: [{ field: 'level', operator: 'in', values: ['debug', 'info', 'warn'] }],
    });
  });

  it('shows API capability error message', async () => {
    createException.mockRejectedValue(new Error('Limit reached: 10 exceptions per rule'));
    render(AddExceptionDialog, base);
    await fireEvent.input(screen.getByLabelText('Field 1'), { target: { value: 'service' } });
    await fireEvent.input(screen.getByLabelText('Value 1'), { target: { value: 'billing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add exception' }));
    await waitFor(() => expect(screen.getByText('Limit reached: 10 exceptions per rule')).toBeInTheDocument());
  });

  it('calls onCreated with the created exception', async () => {
    const exception = created();
    createException.mockResolvedValue({ exception });
    const onCreated = vi.fn();
    render(AddExceptionDialog, { ...base, onCreated });
    await fireEvent.input(screen.getByLabelText('Field 1'), { target: { value: 'service' } });
    await fireEvent.input(screen.getByLabelText('Value 1'), { target: { value: 'billing' } });
    await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'Batch job' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add exception' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(exception));
    expect(createException).toHaveBeenCalledWith('rule-1', 'org-1', {
      conditions: [{ field: 'service', operator: 'equals', values: ['billing'] }],
      reason: 'Batch job',
    });
  });

  it('rejects a field name with spaces', async () => {
    render(AddExceptionDialog, base);
    await fireEvent.input(screen.getByLabelText('Field 1'), { target: { value: 'bad field' } });
    await fireEvent.input(screen.getByLabelText('Value 1'), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: 'Add exception' })).toBeDisabled();
  });
});
