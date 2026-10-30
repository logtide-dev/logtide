import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const m = vi.hoisted(() => ({
  getHealth: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('$lib/api/project-health', () => ({
  projectHealthAPI: { getProjectHealth: m.getHealth, updateSettings: m.update },
}));
vi.mock('$lib/api/notification-channels', () => ({ notificationChannelsAPI: { list: m.list } }));
vi.mock('$lib/api/notification-routing', () => ({ notificationRoutingAPI: { preview: m.preview } }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: m.toastSuccess, error: m.toastError, info: vi.fn(), warning: vi.fn() },
}));

import ProjectNotificationSettings from './ProjectNotificationSettings.svelte';

const channels = [
  { id: 'c1', name: 'Ops Slack', type: 'slack', enabled: true },
  { id: 'c2', name: 'Team mail', type: 'email', enabled: true },
];

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getHealth.mockResolvedValue({ settings: { silentMinutes: 60, healthChannelIds: [] } });
  m.list.mockResolvedValue(channels);
  m.preview.mockResolvedValue({ destinations: [{ id: 'c9', name: 'Org default', type: 'email' }], fallback: null });
  m.update.mockResolvedValue({ silentMinutes: 90, healthChannelIds: ['c1'] });
});

const mount = (canManage = true) =>
  render(ProjectNotificationSettings, { projectId: 'p1', organizationId: 'o1', canManage });

describe('ProjectNotificationSettings', () => {
  it('shows the organization default preview when nothing is selected', async () => {
    mount();
    expect(await screen.findByTestId('org-defaults')).toHaveTextContent('Using organization defaults: Org default (email)');
    expect(m.preview).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'project_health', projectId: 'p1' }));
  });

  it('hides the default preview once a channel is chosen', async () => {
    mount();
    await screen.findByTestId('org-defaults');
    await fireEvent.click(await screen.findByRole('checkbox', { name: /Ops Slack/ }));
    await waitFor(() => expect(screen.queryByTestId('org-defaults')).toBeNull());
  });

  it('saves the selected ids and the threshold', async () => {
    mount();
    await fireEvent.click(await screen.findByRole('checkbox', { name: /Ops Slack/ }));
    await fireEvent.input(screen.getByLabelText('Silent threshold (minutes)'), { target: { value: '90' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.update).toHaveBeenCalledWith('p1', { healthChannelIds: ['c1'], silentMinutes: 90 }));
    expect(m.toastSuccess).toHaveBeenCalled();
  });

  it('rejects 5 minutes on the client', async () => {
    mount();
    const input = await screen.findByLabelText('Silent threshold (minutes)');
    await fireEvent.input(input, { target: { value: '5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('between 10 and 1,440');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await fireEvent.click(save);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('disables the controls for members', async () => {
    mount(false);
    expect(await screen.findByTestId('notifications-readonly-hint')).toHaveTextContent('Only owners and admins can change this');
    expect(await screen.findByRole('checkbox', { name: /Ops Slack/ })).toBeDisabled();
    expect(screen.getByLabelText('Silent threshold (minutes)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
