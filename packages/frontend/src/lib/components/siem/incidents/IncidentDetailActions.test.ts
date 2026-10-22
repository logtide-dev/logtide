import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import IncidentDetailActions from './IncidentDetailActions.svelte';

function incident(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    title: 'Brute force on api',
    status: 'open',
    source: 'sigma',
    ...over,
  } as never;
}

function props(over: Record<string, unknown> = {}, inc: Record<string, unknown> = {}) {
  return {
    incident: incident(inc),
    busy: false,
    onAcknowledge: vi.fn(),
    onResolve: vi.fn(),
    onReopen: vi.fn(),
    onFalsePositive: vi.fn(),
    onPublish: vi.fn(),
    onExportPdf: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
}

describe('IncidentDetailActions', () => {
  it('open sigma incident shows Acknowledge and Mark false positive', () => {
    render(IncidentDetailActions, { props: props() });
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark false positive' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish to status page' })).toBeNull();
  });

  it('monitor incident shows Publish to status page and no false positive', () => {
    render(IncidentDetailActions, { props: props({}, { source: 'monitor' }) });
    expect(screen.getByRole('button', { name: 'Publish to status page' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark false positive' })).toBeNull();
  });

  it('acknowledged incident offers Resolve as the primary action', async () => {
    const p = props({}, { status: 'investigating' });
    render(IncidentDetailActions, { props: p });
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(p.onResolve).toHaveBeenCalledTimes(1);
  });

  it('resolved shows Reopen only', () => {
    render(IncidentDetailActions, { props: props({}, { status: 'resolved' }) });
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark false positive' })).toBeNull();
  });

  it('buttons are disabled while busy', () => {
    render(IncidentDetailActions, { props: props({ busy: true }) });
    expect((screen.getByRole('button', { name: 'Acknowledge' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Delete opens a ConfirmDialog and does not call onDelete until confirmed', async () => {
    const p = props();
    render(IncidentDetailActions, { props: p });
    await fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Delete incident/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole('menuitem', { name: /Delete incident/ }));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(p.onDelete).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(p.onDelete).toHaveBeenCalledTimes(1));
  });
});
