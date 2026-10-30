import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const store = vi.hoisted(() => ({
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('$lib/stores/monitoring', () => ({ monitoringStore: store }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import MonitorList from './MonitorList.svelte';
import type { Monitor } from '$lib/api/monitoring';

function monitor(over: Partial<Monitor> & { id: string; name: string }): Monitor {
  return {
    organizationId: 'org-1',
    projectId: 'proj-1',
    type: 'http',
    target: 'https://example.com',
    intervalSeconds: 60,
    timeoutSeconds: 10,
    gracePeriodSeconds: null,
    failureThreshold: 2,
    autoResolve: true,
    enabled: true,
    httpConfig: null,
    severity: 'high',
    displayName: null,
    groupName: null,
    displayOrder: 0,
    checkConfig: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    status: {
      monitorId: over.id,
      status: 'up',
      consecutiveFailures: 0,
      consecutiveSuccesses: 3,
      lastCheckedAt: '2026-10-22T10:00:00Z',
      lastStatusChangeAt: null,
      responseTimeMs: 120,
      lastErrorCode: null,
      incidentId: null,
      detail: null,
      updatedAt: '2026-10-22T10:00:00Z',
    },
    ...over,
  };
}

const MONITORS = [
  monitor({ id: 'a', name: 'API health' }),
  monitor({
    id: 'b',
    name: 'Billing',
    target: 'https://billing.example.com',
    status: {
      monitorId: 'b',
      status: 'down',
      consecutiveFailures: 3,
      consecutiveSuccesses: 0,
      lastCheckedAt: '2026-10-22T10:00:00Z',
      lastStatusChangeAt: null,
      responseTimeMs: null,
      lastErrorCode: 'timeout',
      incidentId: 'inc-1',
      detail: null,
      updatedAt: '2026-10-22T10:00:00Z',
    },
  }),
  monitor({ id: 'c', name: 'Cron job', type: 'heartbeat', target: null, enabled: false }),
];

function renderList(over: Record<string, unknown> = {}) {
  const props = {
    monitors: MONITORS,
    loading: false,
    orgId: 'org-1',
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onChanged: vi.fn(),
    onCreate: vi.fn(),
    ...over,
  };
  return { ...render(MonitorList, { props }), props };
}

beforeEach(() => {
  store.update.mockReset().mockResolvedValue({});
  store.delete.mockReset().mockResolvedValue(undefined);
});

describe('MonitorList', () => {
  it('shows the no-data EmptyState with a "Create monitor" action when there are no monitors', async () => {
    const { props } = renderList({ monitors: [] });
    expect(screen.getByText('No monitors yet')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it('summary cards count total, up, down and paused', () => {
    renderList();
    expect(screen.getByTestId('summary-all').textContent?.trim()).toBe('3');
    expect(screen.getByTestId('summary-up').textContent?.trim()).toBe('1');
    expect(screen.getByTestId('summary-down').textContent?.trim()).toBe('1');
    expect(screen.getByTestId('summary-paused').textContent?.trim()).toBe('1');
  });

  it('status filter and search narrow the rows', async () => {
    renderList();
    expect(screen.getByText('API health')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /^Down/ }));
    expect(screen.queryByText('API health')).toBeNull();
    expect(screen.getByText('Billing')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /^Total/ }));
    await fireEvent.input(screen.getByLabelText('Search monitors'), { target: { value: 'cron' } });
    expect(screen.queryByText('Billing')).toBeNull();
    expect(screen.getByText('Cron job')).toBeInTheDocument();
  });

  it('shows the no-results state when filters match nothing', async () => {
    renderList();
    await fireEvent.input(screen.getByLabelText('Search monitors'), { target: { value: 'zzz' } });
    expect(screen.getByText('No monitors match these filters')).toBeInTheDocument();
  });

  it('paused monitors show the Paused tone and a Resume action', async () => {
    const { props } = renderList();
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Resume Cron job' }));
    await waitFor(() => expect(store.update).toHaveBeenCalledWith('c', 'org-1', { enabled: true }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it('Delete opens a ConfirmDialog and calls the API only after confirmation', async () => {
    const { props } = renderList();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Billing' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(store.delete).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete monitor' }));
    await waitFor(() => expect(store.delete).toHaveBeenCalledWith('b', 'org-1'));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it('row links to /dashboard/uptime/<id> and shows "Open incident" when status.incidentId is set', () => {
    renderList();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/dashboard/uptime/b');
    const incident = screen.getByRole('link', { name: 'Open incident' });
    expect(incident).toHaveAttribute('href', '/dashboard/incidents/inc-1');
    expect(screen.getAllByRole('link', { name: 'Open incident' })).toHaveLength(1);
  });

  it('uses displayName when set with the real name as secondary text', () => {
    renderList({ monitors: [monitor({ id: 'd', name: 'internal-api-01', displayName: 'Public API' })] });
    expect(screen.getByRole('link', { name: 'Public API' })).toBeInTheDocument();
    expect(screen.getByText('internal-api-01')).toBeInTheDocument();
  });

  it('icon buttons carry aria-labels', () => {
    renderList();
    for (const verb of ['Pause API health', 'Edit API health', 'Duplicate API health', 'Delete API health']) {
      expect(screen.getByRole('button', { name: verb })).toBeInTheDocument();
    }
  });
});
