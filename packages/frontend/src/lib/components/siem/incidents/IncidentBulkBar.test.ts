import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import IncidentBulkBar from './IncidentBulkBar.svelte';

const members = [
  { id: 'm1', user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } },
] as never;

function props(over: Record<string, unknown> = {}) {
  return {
    count: 3,
    members,
    busy: false,
    onAcknowledge: vi.fn(),
    onResolve: vi.fn(),
    onAssign: vi.fn(),
    onClear: vi.fn(),
    ...over,
  };
}

describe('IncidentBulkBar', () => {
  it('is hidden at count 0', () => {
    render(IncidentBulkBar, { props: props({ count: 0 }) });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('shows "3 selected"', () => {
    render(IncidentBulkBar, { props: props() });
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('acknowledge, resolve and clear call their handlers', async () => {
    const p = props();
    render(IncidentBulkBar, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(p.onAcknowledge).toHaveBeenCalledTimes(1);
    expect(p.onResolve).toHaveBeenCalledTimes(1);
    expect(p.onClear).toHaveBeenCalledTimes(1);
  });

  it('assign emits chosen user id', async () => {
    const p = props();
    render(IncidentBulkBar, { props: p });
    await fireEvent.keyDown(screen.getByRole('button', { name: /Assign/ }), { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
    await fireEvent.click(screen.getByRole('menuitem', { name: /Ada Lovelace/ }));
    expect(p.onAssign).toHaveBeenCalledWith('u1');
  });

  it('buttons are disabled while busy', () => {
    render(IncidentBulkBar, { props: props({ busy: true }) });
    for (const name of ['Acknowledge', 'Resolve', 'Clear selection']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole('button', { name: /Assign/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
