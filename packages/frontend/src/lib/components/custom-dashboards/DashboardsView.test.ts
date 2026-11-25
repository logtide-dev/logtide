import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { chooseSelectOption } from '$lib/test-utils/select-field';

const { api } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    getDefault: vi.fn(),
    getById: vi.fn(),
    listTemplates: vi.fn(),
    fetchPanelData: vi.fn(),
  },
}));

vi.mock('$lib/api/metrics-v2', () => ({
  metricsV2API: {
    getAttributeValues: vi.fn().mockResolvedValue(['web-1', 'web-2']),
    getAttributes: vi.fn().mockResolvedValue([]),
    getCatalog: vi.fn().mockResolvedValue({ metrics: [] }),
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

describe('DashboardsView variables', () => {
  const customized = {
    ...home,
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Host web-1',
    isDefault: false,
    schemaVersion: 2,
    panels: [
      {
        id: 'p1',
        layout: { x: 0, y: 0, w: 6, h: 4 },
        config: {
          type: 'metrics',
          title: 'CPU',
          source: 'metrics',
          timeRange: '24h',
          query: { projectIds: null, queries: [], formulas: [], interval: 'auto', compareTo: 'none', display: 'lines' },
        },
      },
    ],
    variables: [
      { name: 'host', label: 'Host', attr: { scope: 'resource', key: 'host.name' }, metricName: null, default: 'web-1' },
    ],
  };

  beforeEach(() => {
    api.list.mockResolvedValue([home, customized]);
  });

  it('opens a dashboard by id, shows the bar and fetches with the variable values from the URL', async () => {
    const navigate = vi.fn();
    render(DashboardsView, {
      props: { url: new URL(`http://localhost/dashboard?id=${customized.id}&var-host=web-2`), navigate },
    });
    expect(await screen.findByRole('combobox', { name: 'Host' })).toHaveTextContent('web-2');
    await waitFor(() => expect(api.fetchPanelData).toHaveBeenCalled());
    expect(api.fetchPanelData).toHaveBeenCalledWith(customized.id, 'org-1', undefined, undefined, { host: 'web-2' });
  });

  it('changing a value refetches and writes it to the URL', async () => {
    const navigate = vi.fn();
    render(DashboardsView, {
      props: { url: new URL(`http://localhost/dashboard?id=${customized.id}`), navigate },
    });
    const select = await screen.findByRole('combobox', { name: 'Host' });
    await waitFor(() => expect(api.fetchPanelData).toHaveBeenCalledTimes(1));
    await chooseSelectOption(select, 'web-2');
    await waitFor(() => expect(api.fetchPanelData).toHaveBeenCalledTimes(2));
    expect(api.fetchPanelData).toHaveBeenLastCalledWith(customized.id, 'org-1', undefined, undefined, { host: 'web-2' });
    await waitFor(() => {
      const last = navigate.mock.calls.at(-1)?.[0] as URL | undefined;
      expect(last?.searchParams.get('var-host')).toBe('web-2');
    });
  });

  it('shows no bar for a dashboard without variables', async () => {
    render(DashboardsView, { props: { url: new URL('http://localhost/dashboard'), navigate: vi.fn() } });
    await waitFor(() => expect(api.getDefault).toHaveBeenCalled());
    expect(screen.queryByTestId('dashboard-variables')).toBeNull();
  });
});
