import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  listMaintenances: vi.fn(),
  createMaintenance: vi.fn(),
  deleteMaintenance: vi.fn(),
}));

vi.mock('$lib/api/status-page', () => api);
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { page } from '$app/state';
import MaintenancePanel from './MaintenancePanel.svelte';
import type { Monitor } from '$lib/api/monitoring';

const MONITORS = [
  {
    id: 'm1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    name: 'API',
    displayName: null,
  } as unknown as Monitor,
];

const ITEM = {
  id: 'mt1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  title: 'Database upgrade',
  description: 'Planned work',
  status: 'scheduled',
  scheduledStart: '2026-10-25T01:00:00Z',
  scheduledEnd: '2026-10-25T03:00:00Z',
  autoUpdateStatus: true,
  monitorIds: ['m1'],
};

beforeEach(() => {
  (page as { url: URL }).url = new URL('http://localhost/dashboard/uptime?tab=maintenance');
  api.listMaintenances.mockReset().mockResolvedValue({ maintenances: [ITEM] });
  api.createMaintenance.mockReset().mockResolvedValue({ maintenance: ITEM });
  api.deleteMaintenance.mockReset().mockResolvedValue(null);
});

function renderPanel() {
  return render(MaintenancePanel, { props: { orgId: 'org-1', projectId: 'proj-1', monitors: MONITORS } });
}

describe('MaintenancePanel', () => {
  it('copy uses "Schedule maintenance" and lists the window with chips', async () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Schedule maintenance' })).toBeInTheDocument();
    await screen.findByText('Database upgrade');
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByTestId('affected-chip').textContent?.trim()).toBe('API');
  });

  it('maintenance blocks an end before the start with an inline error', async () => {
    renderPanel();
    await screen.findByText('Database upgrade');
    await fireEvent.click(screen.getByRole('button', { name: 'Schedule maintenance' }));
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('Title'), { target: { value: 'Window' } });
    await fireEvent.input(within(dialog).getByLabelText('Start'), { target: { value: '2026-10-25T10:00' } });
    await fireEvent.input(within(dialog).getByLabelText('End'), { target: { value: '2026-10-25T09:00' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule maintenance' }));
    expect(await within(dialog).findByText('The end must be after the start')).toBeInTheDocument();
    expect(api.createMaintenance).not.toHaveBeenCalled();
  });

  it('creates a window with monitorIds', async () => {
    renderPanel();
    await screen.findByText('Database upgrade');
    await fireEvent.click(screen.getByRole('button', { name: 'Schedule maintenance' }));
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('Title'), { target: { value: 'Window' } });
    await fireEvent.input(within(dialog).getByLabelText('Start'), { target: { value: '2026-10-25T10:00' } });
    await fireEvent.input(within(dialog).getByLabelText('End'), { target: { value: '2026-10-25T11:00' } });
    await fireEvent.click(within(dialog).getByLabelText('API'));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule maintenance' }));
    await waitFor(() => expect(api.createMaintenance).toHaveBeenCalledTimes(1));
    const body = api.createMaintenance.mock.calls[0][0];
    expect(body.monitorIds).toEqual(['m1']);
    expect(body.autoUpdateStatus).toBe(true);
    expect(new Date(body.scheduledEnd).getTime()).toBeGreaterThan(new Date(body.scheduledStart).getTime());
  });

  it('deleting a maintenance asks for confirmation first', async () => {
    renderPanel();
    await screen.findByText('Database upgrade');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Database upgrade' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.deleteMaintenance).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete maintenance' }));
    await waitFor(() => expect(api.deleteMaintenance).toHaveBeenCalledWith('mt1', 'org-1'));
  });

  it('shows an empty state without maintenance', async () => {
    api.listMaintenances.mockResolvedValue({ maintenances: [] });
    renderPanel();
    expect(await screen.findByText('No maintenance scheduled')).toBeInTheDocument();
  });
});
