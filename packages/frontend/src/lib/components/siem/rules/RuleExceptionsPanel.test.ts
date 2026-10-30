import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { SigmaException } from '@logtide/shared';

const listExceptions = vi.hoisted(() => vi.fn());
const deleteException = vi.hoisted(() => vi.fn());
const createException = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/sigma', () => ({
  sigmaAPI: { listExceptions, deleteException, createException },
}));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import RuleExceptionsPanel from './RuleExceptionsPanel.svelte';

function exception(over: Partial<SigmaException> = {}): SigmaException {
  return {
    id: 'ex-1',
    ruleId: 'rule-1',
    conditions: [{ field: 'service', operator: 'equals', values: ['billing'] }],
    reason: 'Known batch job',
    expiresAt: null,
    hitCount: 1500,
    lastHitAt: null,
    createdBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

const props = { organizationId: 'org-1', ruleId: 'rule-1', ruleTitle: 'Suspicious login' };

beforeEach(() => {
  listExceptions.mockReset();
  deleteException.mockReset();
  createException.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('RuleExceptionsPanel', () => {
  it('renders conditions as chips and an Expired badge for past expiry', async () => {
    listExceptions.mockResolvedValue({
      exceptions: [
        exception(),
        exception({
          id: 'ex-2',
          hitCount: 7,
          conditions: [{ field: 'level', operator: 'in', values: ['debug', 'info'] }],
          expiresAt: '2020-01-01T00:00:00.000Z',
        }),
      ],
    });
    render(RuleExceptionsPanel, props);
    expect(await screen.findByText('service equals billing')).toBeInTheDocument();
    expect(screen.getByText('level in debug, info')).toBeInTheDocument();
    expect(screen.getAllByText('Expired')).toHaveLength(1);
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('shows an empty message with no exceptions', async () => {
    listExceptions.mockResolvedValue({ exceptions: [] });
    render(RuleExceptionsPanel, props);
    expect(await screen.findByText('No exceptions')).toBeInTheDocument();
  });

  it('delete asks for confirmation before calling deleteException', async () => {
    listExceptions.mockResolvedValue({ exceptions: [exception()] });
    deleteException.mockResolvedValue({ success: true });
    render(RuleExceptionsPanel, props);
    await fireEvent.click(await screen.findByRole('button', { name: 'Delete exception' }));
    expect(deleteException).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete exception',
    ) as HTMLButtonElement;
    await fireEvent.click(confirm);
    await waitFor(() => expect(deleteException).toHaveBeenCalledWith('rule-1', 'ex-1', 'org-1'));
  });
});
