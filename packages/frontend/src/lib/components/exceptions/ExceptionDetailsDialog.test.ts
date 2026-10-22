import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { getExceptionByLogId, goto } = vi.hoisted(() => ({
  getExceptionByLogId: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$lib/api/exceptions', () => ({ getExceptionByLogId }));
vi.mock('$app/navigation', () => ({ goto }));

import ExceptionDetailsDialog from './ExceptionDetailsDialog.svelte';

function exceptionWith(errorGroupId: string | null) {
  return {
    exception: {
      id: 'ex1',
      organizationId: 'org1',
      projectId: 'p1',
      logId: 'log1',
      exceptionType: 'TypeError',
      exceptionMessage: 'x is undefined',
      language: 'nodejs',
      fingerprint: 'fp',
      rawStackTrace: 'TypeError: x is undefined',
      frameCount: 0,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
    frames: [],
    errorGroupId,
  };
}

async function setup(errorGroupId: string | null) {
  getExceptionByLogId.mockResolvedValue(exceptionWith(errorGroupId));
  const onClose = vi.fn();
  render(ExceptionDetailsDialog, { open: true, logId: 'log1', organizationId: 'org1', onClose });
  const button = await screen.findByRole('button', { name: 'View error group' });
  return { onClose, button };
}

beforeEach(() => {
  getExceptionByLogId.mockReset();
  goto.mockReset();
});

describe('ExceptionDetailsDialog', () => {
  it('View error group navigates to the group detail when errorGroupId is present', async () => {
    const { button } = await setup('group-1');
    await fireEvent.click(button);
    expect(goto).toHaveBeenCalledTimes(1);
    const target = goto.mock.calls[0][0] as string;
    expect(target.startsWith('/dashboard/errors/group-1')).toBe(true);
    expect(new URL(target, 'http://x').searchParams.get('organizationId')).toBe('org1');
  });

  it('falls back to the search list when errorGroupId is null', async () => {
    const { button } = await setup(null);
    await fireEvent.click(button);
    const target = goto.mock.calls[0][0] as string;
    const url = new URL(target, 'http://x');
    expect(url.pathname).toBe('/dashboard/errors');
    expect(url.searchParams.get('search')).toBe('TypeError');
  });

  it('closes the dialog after navigating', async () => {
    const { button, onClose } = await setup('group-1');
    await fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
