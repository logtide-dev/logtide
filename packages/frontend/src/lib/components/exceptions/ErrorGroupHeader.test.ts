import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { ErrorGroup } from '@logtide/shared';
import ErrorGroupHeader from './ErrorGroupHeader.svelte';
import { buildCreateAlertHref } from './error-group-links';

const members = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com' },
];

function group(over: Partial<ErrorGroup> = {}): ErrorGroup {
  return {
    id: 'g1',
    organizationId: 'org1',
    projectId: 'p1',
    projectName: 'Checkout',
    fingerprint: 'abcdef0123456789',
    exceptionType: 'TypeError',
    exceptionMessage: 'x is undefined',
    language: 'nodejs',
    occurrenceCount: 1234,
    firstSeen: '2026-10-01T10:00:00.000Z',
    lastSeen: '2026-10-20T10:00:00.000Z',
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    affectedServices: ['api', 'unknown'],
    sampleLogId: null,
    assignedTo: null,
    regressedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...over,
  } as ErrorGroup;
}

function setup(g: ErrorGroup = group(), over: Record<string, unknown> = {}) {
  const handlers = { onResolve: vi.fn(), onReopen: vi.fn(), onIgnore: vi.fn(), onAssign: vi.fn() };
  render(ErrorGroupHeader, { group: g, members, ...handlers, ...over });
  return handlers;
}

async function openStatusMenu() {
  const trigger = screen.getByRole('button', { name: 'Change status' });
  await fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ErrorGroupHeader', () => {
  it('shows type, message, occurrences and the project', () => {
    setup();
    expect(screen.getByText('TypeError')).toBeInTheDocument();
    expect(screen.getByText('x is undefined')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
  });

  it('shows Regressed and the resolved by line for a resolved group', () => {
    setup(
      group({
        status: 'resolved',
        regressedAt: '2026-10-19T10:00:00.000Z',
        resolvedAt: '2026-10-18T10:00:00.000Z',
        resolvedByName: 'Ada Lovelace',
      })
    );
    expect(screen.getByText(/Resolved by Ada Lovelace/)).toBeInTheDocument();
    // Regressed badge is hidden once the group is resolved again
    expect(screen.queryByText('Regressed')).not.toBeInTheDocument();
  });

  it('shows Regressed for an open regressed group', () => {
    setup(group({ regressedAt: '2026-10-19T10:00:00.000Z' }));
    expect(screen.getByText('Regressed')).toBeInTheDocument();
  });

  it('shows the ignore description for ignored groups', () => {
    setup(group({ status: 'ignored', ignoreUntilCount: 50, ignoredEventCount: 12 }));
    expect(screen.getByText('Ignored until 50 more events (12 so far)')).toBeInTheDocument();
  });

  it('Ignore menu item opens the dialog and does not call onIgnore until confirmed', async () => {
    const h = setup();
    await openStatusMenu();
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(h.onIgnore).not.toHaveBeenCalled();
  });

  it('Resolve calls onResolve', async () => {
    const h = setup();
    await openStatusMenu();
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Resolve' }));
    expect(h.onResolve).toHaveBeenCalledTimes(1);
  });

  it('Reopen calls onReopen for a resolved group', async () => {
    const h = setup(group({ status: 'resolved' }));
    await openStatusMenu();
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Reopen' }));
    expect(h.onReopen).toHaveBeenCalledTimes(1);
  });

  it('create alert link equals buildCreateAlertHref', () => {
    const g = group();
    setup(g);
    expect(screen.getByRole('link', { name: 'Create alert' })).toHaveAttribute('href', buildCreateAlertHref(g));
  });

  it('assignee change calls onAssign', async () => {
    const h = setup();
    const trigger = screen.getByRole('button', { name: 'Assign error' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Grace Hopper/ }));
    expect(h.onAssign).toHaveBeenCalledWith('u2');
  });

  it('copy fingerprint button has an accessible name', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Copy fingerprint' })).toBeInTheDocument();
  });

  it('lists affected services except unknown', () => {
    setup();
    expect(screen.getByText('api')).toBeInTheDocument();
  });
});
