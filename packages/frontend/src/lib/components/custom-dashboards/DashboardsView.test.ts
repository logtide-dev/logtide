import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const { api } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    getDefault: vi.fn(),
    getById: vi.fn(),
    listTemplates: vi.fn(),
    fetchPanelData: vi.fn(),
  },
}));

vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({ id: 'org-1', name: 'Org', slug: 'org', role: 'owner' });
  return { currentOrganization: store };
});
vi.mock('$lib/api/custom-dashboards', () => ({ customDashboardsAPI: api }));

import DashboardsView from './DashboardsView.svelte';

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const home = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: 'org-1',
  projectId: null,
  userId: null,
  name: 'Home',
  description: null,
  isDefault: true,
  isPersonal: false,
  schemaVersion: 1,
  panels: [],
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([home]);
  api.getDefault.mockReset().mockResolvedValue(home);
  api.getById.mockReset().mockResolvedValue(home);
  api.listTemplates.mockReset().mockResolvedValue([]);
  api.fetchPanelData.mockReset().mockResolvedValue({ panels: {} });
});

describe('DashboardsView create=1', () => {
  it('opens the create dialog and cleans the param from the URL', async () => {
    const navigate = vi.fn();
    render(DashboardsView, {
      props: { url: new URL('http://localhost/dashboard?create=1'), navigate },
    });
    expect(await screen.findByText('New dashboard')).toBeInTheDocument();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const last = navigate.mock.calls.at(-1)![0] as URL;
    expect(last.searchParams.has('create')).toBe(false);
  });

  it('does not open the dialog without the param', async () => {
    const navigate = vi.fn();
    render(DashboardsView, { props: { url: new URL('http://localhost/dashboard'), navigate } });
    await waitFor(() => expect(api.getDefault).toHaveBeenCalled());
    expect(screen.queryByText('New dashboard')).toBeNull();
  });

  it('ignores other values of create', async () => {
    const navigate = vi.fn();
    render(DashboardsView, {
      props: { url: new URL('http://localhost/dashboard?create=0'), navigate },
    });
    await waitFor(() => expect(api.getDefault).toHaveBeenCalled());
    expect(screen.queryByText('New dashboard')).toBeNull();
  });
});
