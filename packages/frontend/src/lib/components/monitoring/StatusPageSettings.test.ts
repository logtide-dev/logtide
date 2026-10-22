import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  getStatusPageConfig: vi.fn(),
  updateStatusPageConfig: vi.fn(),
  updateStatusPageComponents: vi.fn(),
  listStatusSubscribers: vi.fn(),
  removeStatusSubscriber: vi.fn(),
}));

vi.mock('$lib/api/status-page', () => api);
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    updateProject = vi.fn();
  },
}));
vi.mock('$lib/utils/auth', () => ({ getAuthToken: () => 'token' }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import StatusPageSettings from './StatusPageSettings.svelte';
import { organizationStore } from '$lib/stores/organization';
import type { Monitor } from '$lib/api/monitoring';
import type { Project } from '@logtide/shared';

function monitor(id: string, name: string, order: number, extra: Partial<Monitor> = {}): Monitor {
  return {
    id,
    name,
    displayName: null,
    groupName: null,
    displayOrder: order,
    createdAt: `2026-10-0${order + 1}T00:00:00Z`,
    ...extra,
  } as unknown as Monitor;
}

const MONITORS = [monitor('m1', 'API', 0), monitor('m2', 'Web', 1), monitor('m3', 'Worker', 2)];

function project(extra: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    organizationId: 'org-1',
    name: 'Shop',
    slug: 'shop',
    statusPageVisibility: 'public',
    ...extra,
  } as Project;
}

const CONFIG = {
  title: null,
  description: null,
  logoUrl: null,
  accentColor: null,
  showMonitorTypes: false,
};

function renderSettings(props: { project?: Project; monitors?: Monitor[] } = {}) {
  return render(StatusPageSettings, {
    props: {
      orgId: 'org-1',
      orgSlug: 'acme',
      project: props.project ?? project(),
      monitors: props.monitors ?? MONITORS,
      onProjectChanged: vi.fn(),
    },
  });
}

function setRole(role: 'owner' | 'admin' | 'member') {
  organizationStore.clear();
  organizationStore.setCurrentOrganization({
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    role,
  } as never);
}

beforeEach(() => {
  setRole('owner');
  api.getStatusPageConfig.mockReset().mockResolvedValue({ config: CONFIG, subscriptionsAvailable: true });
  api.updateStatusPageConfig.mockReset().mockResolvedValue({ config: CONFIG });
  api.updateStatusPageComponents.mockReset().mockResolvedValue({ ok: true });
  api.listStatusSubscribers.mockReset().mockResolvedValue({
    subscribers: [{ id: 's1', email: 'a@example.com', confirmedAt: '2026-10-20T10:00:00Z', createdAt: '2026-10-20T09:00:00Z' }],
    total: 1,
  });
  api.removeStatusSubscriber.mockReset().mockResolvedValue(null);
});

async function ready() {
  await screen.findByLabelText('Title');
  await waitFor(() => expect(screen.getByLabelText('Title')).not.toBeDisabled());
}

describe('StatusPageSettings', () => {
  it('members get a read-only page: notice, disabled inputs and save, no subscribers card', async () => {
    setRole('member');
    renderSettings();
    await screen.findByLabelText('Title');
    expect(screen.getByTestId('read-only-notice')).toHaveTextContent('the status page settings');
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Accent colour')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.queryByText('Subscribers')).not.toBeInTheDocument();
    expect(api.listStatusSubscribers).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Visibility')).toBeDisabled();
  });

  it('admins and owners get no read-only notice', async () => {
    setRole('admin');
    renderSettings();
    await ready();
    expect(screen.queryByTestId('read-only-notice')).not.toBeInTheDocument();
  });

  it('branding rejects an http logo URL and a malformed accent inline and disables save', async () => {
    renderSettings();
    await ready();
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Acme status' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();

    await fireEvent.input(screen.getByLabelText('Logo URL'), { target: { value: 'http://example.com/a.png' } });
    expect(screen.getByText('Use an https:// image URL without credentials')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await fireEvent.input(screen.getByLabelText('Logo URL'), { target: { value: 'https://example.com/a.png' } });
    await fireEvent.input(screen.getByLabelText('Accent colour'), { target: { value: '#12345' } });
    expect(screen.getByText('Use a colour like #2563eb')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('branding shows a contrast warning when the accent is close to white', async () => {
    renderSettings();
    await ready();
    await fireEvent.input(screen.getByLabelText('Accent colour'), { target: { value: '#f5f5f5' } });
    expect(screen.getByText(/very light and may be hard to see/)).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('Accent colour'), { target: { value: '#1d4ed8' } });
    expect(screen.queryByText(/very light and may be hard to see/)).not.toBeInTheDocument();
  });

  it('components section lists monitors in public order and move up or down renumbers order 0..n-1 in the PUT payload', async () => {
    const shuffled = [MONITORS[2], MONITORS[0], MONITORS[1]];
    renderSettings({ monitors: shuffled });
    await ready();
    const names = screen.getAllByTestId('component-row').map((r) => within(r).getByLabelText(/^Public name for/).getAttribute('aria-label'));
    expect(names).toEqual(['Public name for API', 'Public name for Web', 'Public name for Worker']);

    await fireEvent.click(screen.getByRole('button', { name: 'Move Worker up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Move API down' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateStatusPageComponents).toHaveBeenCalledTimes(1));
    const [org, proj, components] = api.updateStatusPageComponents.mock.calls[0];
    expect([org, proj]).toEqual(['org-1', 'proj-1']);
    expect(components.map((c: { monitorId: string; order: number }) => [c.monitorId, c.order])).toEqual([
      ['m3', 0],
      ['m1', 1],
      ['m2', 2],
    ]);
  });

  it('blank display name sends null', async () => {
    renderSettings();
    await ready();
    await fireEvent.input(screen.getByLabelText('Public name for API'), { target: { value: 'Public API' } });
    await fireEvent.input(screen.getByLabelText('Group for Web'), { target: { value: 'Core' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateStatusPageComponents).toHaveBeenCalled());
    const components = api.updateStatusPageComponents.mock.calls[0][2];
    expect(components[0]).toMatchObject({ monitorId: 'm1', displayName: 'Public API', groupName: null });
    expect(components[1]).toMatchObject({ monitorId: 'm2', displayName: null, groupName: 'Core' });
  });

  it('subscribers section is hidden when subscriptionsAvailable is false', async () => {
    api.getStatusPageConfig.mockResolvedValue({ config: CONFIG, subscriptionsAvailable: false });
    renderSettings();
    await ready();
    expect(screen.queryByText(/Email subscribers/)).not.toBeInTheDocument();
    expect(api.listStatusSubscribers).not.toHaveBeenCalled();
  });

  it('subscribers removal asks for confirmation', async () => {
    renderSettings();
    await ready();
    await fireEvent.click(await screen.findByRole('button', { name: 'Remove a@example.com' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.removeStatusSubscriber).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove subscriber' }));
    await waitFor(() => expect(api.removeStatusSubscriber).toHaveBeenCalledWith('s1', 'org-1'));
  });

  it('Save changes is disabled until something changed and sends config and components together', async () => {
    renderSettings();
    await ready();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Acme status' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateStatusPageConfig).toHaveBeenCalledTimes(1));
    expect(api.updateStatusPageConfig.mock.calls[0][2]).toMatchObject({ title: 'Acme status', logoUrl: null });
    expect(api.updateStatusPageComponents).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  });

  it('view page link is shown only when visibility is not disabled and a slug exists', async () => {
    const { unmount } = renderSettings();
    await ready();
    expect(screen.getByRole('link', { name: /View page/ })).toHaveAttribute('href', '/status/acme/shop');
    unmount();

    renderSettings({ project: project({ statusPageVisibility: 'disabled' }) });
    await ready();
    expect(screen.queryByRole('link', { name: /View page/ })).not.toBeInTheDocument();
  });
});
