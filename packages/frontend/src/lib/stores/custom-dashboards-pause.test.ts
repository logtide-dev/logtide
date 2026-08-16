import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { CustomDashboard, PanelInstance } from '@logtide/shared';

const { fetchPanelData, getDefault, getById } = vi.hoisted(() => ({
  fetchPanelData: vi.fn(),
  getDefault: vi.fn(),
  getById: vi.fn(),
}));

vi.mock('$lib/api/custom-dashboards', () => ({
  customDashboardsAPI: {
    fetchPanelData,
    getDefault,
    getById,
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setAsDefault: vi.fn(),
    exportYaml: vi.fn(),
    importYaml: vi.fn(),
  },
}));

import { customDashboardsStore, pausedPanelIds, panelDataMap } from './custom-dashboards';

function panel(id: string): PanelInstance {
  return {
    id,
    layout: { x: 0, y: 0, w: 3, h: 2 },
    config: {
      type: 'single_stat',
      title: id,
      source: 'logs',
      metric: 'total_logs',
      projectId: null,
      compareWithPrevious: false,
    },
  } as PanelInstance;
}

function dashboard(id: string, panelIds: string[]): CustomDashboard {
  return {
    id,
    organizationId: 'org-1',
    projectId: null,
    name: id,
    description: null,
    isDefault: true,
    isPersonal: false,
    createdBy: 'user-1',
    panels: panelIds.map(panel),
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  } as unknown as CustomDashboard;
}

const active = dashboard('dash-1', ['panel-a', 'panel-b']);

beforeEach(async () => {
  customDashboardsStore.reset();
  vi.clearAllMocks();
  getDefault.mockResolvedValue(active);
  fetchPanelData.mockResolvedValue({ panels: {} });
  await customDashboardsStore.loadDefault('org-1');
  fetchPanelData.mockClear();
});

describe('custom dashboards store - panel pause', () => {
  it('starts with no paused panels', () => {
    expect(get(pausedPanelIds).size).toBe(0);
  });

  it('excludes paused panels from the batch fetch', async () => {
    customDashboardsStore.togglePanelPause('panel-a');
    fetchPanelData.mockResolvedValue({ panels: { 'panel-b': { data: { ok: 1 } } } });

    await customDashboardsStore.fetchAllPanelData();

    expect(fetchPanelData).toHaveBeenCalledWith('dash-1', 'org-1', ['panel-b']);
  });

  it('skips the network call entirely when every panel is paused', async () => {
    customDashboardsStore.togglePanelPause('panel-a');
    customDashboardsStore.togglePanelPause('panel-b');

    await customDashboardsStore.fetchAllPanelData();

    expect(fetchPanelData).not.toHaveBeenCalled();
  });

  it('toggling twice resumes the panel and fetches everything again', async () => {
    customDashboardsStore.togglePanelPause('panel-a');
    customDashboardsStore.togglePanelPause('panel-a');
    expect(get(pausedPanelIds).size).toBe(0);

    await customDashboardsStore.fetchAllPanelData();

    expect(fetchPanelData).toHaveBeenCalledWith('dash-1', 'org-1', undefined);
  });

  it('does not clobber a paused panel data entry on batch refresh', async () => {
    fetchPanelData.mockResolvedValue({
      panels: { 'panel-a': { data: { v: 'first' } }, 'panel-b': { data: { v: 'first' } } },
    });
    await customDashboardsStore.fetchAllPanelData();

    customDashboardsStore.togglePanelPause('panel-a');
    fetchPanelData.mockResolvedValue({ panels: { 'panel-b': { data: { v: 'second' } } } });
    await customDashboardsStore.fetchAllPanelData();

    const entries = get(panelDataMap);
    expect(entries['panel-a'].data).toEqual({ v: 'first' });
    expect(entries['panel-a'].loading).toBe(false);
    expect(entries['panel-b'].data).toEqual({ v: 'second' });
  });

  it('leaves paused panels untouched when the batch fetch fails', async () => {
    fetchPanelData.mockResolvedValue({
      panels: { 'panel-a': { data: { v: 'first' } }, 'panel-b': { data: { v: 'first' } } },
    });
    await customDashboardsStore.fetchAllPanelData();

    customDashboardsStore.togglePanelPause('panel-a');
    fetchPanelData.mockRejectedValue(new Error('boom'));
    await customDashboardsStore.fetchAllPanelData();

    const entries = get(panelDataMap);
    expect(entries['panel-a'].error).toBeNull();
    expect(entries['panel-a'].data).toEqual({ v: 'first' });
    expect(entries['panel-b'].error).toBe('boom');
  });

  it('still refreshes a paused panel on explicit request', async () => {
    customDashboardsStore.togglePanelPause('panel-a');
    fetchPanelData.mockResolvedValue({ panels: { 'panel-a': { data: { v: 'manual' } } } });

    await customDashboardsStore.refreshPanel('panel-a');

    expect(fetchPanelData).toHaveBeenCalledWith('dash-1', 'org-1', ['panel-a']);
    expect(get(panelDataMap)['panel-a'].data).toEqual({ v: 'manual' });
  });

  it('clears paused panels when the active dashboard changes', async () => {
    customDashboardsStore.togglePanelPause('panel-a');
    getById.mockResolvedValue(dashboard('dash-2', ['panel-c']));

    await customDashboardsStore.switchTo('dash-2');

    expect(get(pausedPanelIds).size).toBe(0);
  });

  it('clears paused panels when the store is reset', () => {
    customDashboardsStore.togglePanelPause('panel-a');
    customDashboardsStore.reset();
    expect(get(pausedPanelIds).size).toBe(0);
  });
});
