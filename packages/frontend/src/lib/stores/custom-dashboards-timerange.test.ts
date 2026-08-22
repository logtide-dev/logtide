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

import { customDashboardsStore, timeRangeOverride } from './custom-dashboards';

function panel(id: string): PanelInstance {
  return {
    id,
    layout: { x: 0, y: 0, w: 6, h: 3 },
    config: {
      type: 'time_series',
      title: id,
      source: 'logs',
      projectId: null,
      interval: '24h',
      levels: ['info'],
      service: null,
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
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  } as unknown as CustomDashboard;
}

beforeEach(async () => {
  customDashboardsStore.reset();
  vi.clearAllMocks();
  getDefault.mockResolvedValue(dashboard('dash-1', ['panel-a']));
  fetchPanelData.mockResolvedValue({ panels: {} });
  await customDashboardsStore.loadDefault('org-1');
  fetchPanelData.mockClear();
});

describe('custom dashboards store - time range override (#305)', () => {
  it('starts without an override', () => {
    expect(get(timeRangeOverride)).toBeNull();
  });

  it('setting the override refetches with it', async () => {
    await customDashboardsStore.setTimeRangeOverride('48h');

    expect(get(timeRangeOverride)).toBe('48h');
    expect(fetchPanelData).toHaveBeenCalledWith('dash-1', 'org-1', undefined, '48h');
  });

  it('clearing the override refetches without it', async () => {
    await customDashboardsStore.setTimeRangeOverride('48h');
    fetchPanelData.mockClear();

    await customDashboardsStore.setTimeRangeOverride(null);

    expect(get(timeRangeOverride)).toBeNull();
    expect(fetchPanelData).toHaveBeenCalledWith('dash-1', 'org-1', undefined, undefined);
  });

  it('manual panel refresh carries the active override', async () => {
    await customDashboardsStore.setTimeRangeOverride('3d');
    fetchPanelData.mockClear();
    fetchPanelData.mockResolvedValue({ panels: { 'panel-a': { data: { ok: 1 } } } });

    await customDashboardsStore.refreshPanel('panel-a');

    expect(fetchPanelData).toHaveBeenCalledWith('dash-1', 'org-1', ['panel-a'], '3d');
  });

  it('switching dashboards clears the override', async () => {
    await customDashboardsStore.setTimeRangeOverride('48h');
    getById.mockResolvedValue(dashboard('dash-2', ['panel-b']));

    await customDashboardsStore.switchTo('dash-2');

    expect(get(timeRangeOverride)).toBeNull();
  });
});
