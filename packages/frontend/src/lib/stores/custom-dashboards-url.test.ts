import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { CustomDashboard, PanelInstance } from '@logtide/shared';

const api = vi.hoisted(() => ({
  fetchPanelData: vi.fn(),
  getDefault: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  setAsDefault: vi.fn(),
  exportYaml: vi.fn(),
  importYaml: vi.fn(),
  duplicate: vi.fn(),
  createFromTemplate: vi.fn(),
}));

vi.mock('$lib/api/custom-dashboards', () => ({ customDashboardsAPI: api }));

import {
  customDashboardsStore,
  activeDashboard,
  dashboardList,
  dashboardError,
  timeRangeOverride,
} from './custom-dashboards';

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

function dashboard(id: string, isDefault = false): CustomDashboard {
  return {
    id,
    organizationId: 'org-1',
    projectId: null,
    name: id,
    description: null,
    isDefault,
    isPersonal: false,
    createdBy: 'user-1',
    panels: [panel(`${id}-p`)],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  } as unknown as CustomDashboard;
}

const DEFAULT = dashboard('dash-default', true);
const OTHER = dashboard('dash-other');

beforeEach(() => {
  customDashboardsStore.reset();
  vi.clearAllMocks();
  api.list.mockResolvedValue([DEFAULT, OTHER]);
  api.getDefault.mockResolvedValue(DEFAULT);
  api.getById.mockRejectedValue(new Error('Dashboard not found'));
  api.fetchPanelData.mockResolvedValue({ panels: {} });
});

describe('custom dashboards store - url state', () => {
  it('initialize with unknown id falls back to default and reports fellBack', async () => {
    const res = await customDashboardsStore.initialize('org-1', { dashboardId: 'gone' });
    expect(res.fellBack).toBe(true);
    expect(get(activeDashboard)?.id).toBe('dash-default');
    expect(get(dashboardError)).toBeNull();
  });

  it('initialize with id from the list does not fetch by id', async () => {
    const res = await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-other' });
    expect(res.fellBack).toBe(false);
    expect(get(activeDashboard)?.id).toBe('dash-other');
    expect(api.getById).not.toHaveBeenCalled();
    expect(api.getDefault).not.toHaveBeenCalled();
  });

  it('initialize without an id loads the default and does not fall back', async () => {
    const res = await customDashboardsStore.initialize('org-1');
    expect(res.fellBack).toBe(false);
    expect(get(activeDashboard)?.id).toBe('dash-default');
  });

  it('initialize applies range before the first fetch (one fetchPanelData call with timeRange)', async () => {
    await customDashboardsStore.initialize('org-1', { range: '6h' });
    expect(api.fetchPanelData).toHaveBeenCalledTimes(1);
    expect(api.fetchPanelData).toHaveBeenCalledWith('dash-default', 'org-1', undefined, '6h');
    expect(get(timeRangeOverride)).toBe('6h');
  });

  it('initialize swallows a 403 from getById', async () => {
    api.getById.mockRejectedValue(new Error('Forbidden'));
    const res = await customDashboardsStore.initialize('org-1', {
      dashboardId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.fellBack).toBe(true);
    expect(get(activeDashboard)?.id).toBe('dash-default');
    expect(get(dashboardError)).toBeNull();
  });

  it('initialize uses getById for a dashboard that is not in the list', async () => {
    const extra = dashboard('dash-extra');
    api.getById.mockResolvedValue(extra);
    const res = await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-extra' });
    expect(res.fellBack).toBe(false);
    expect(get(activeDashboard)?.id).toBe('dash-extra');
    expect(get(dashboardList).map((d) => d.id)).toContain('dash-extra');
  });

  it('a stale initialize does not overwrite a newer one', async () => {
    let releaseFirst: (v: CustomDashboard[]) => void = () => {};
    api.list
      .mockImplementationOnce(() => new Promise<CustomDashboard[]>((r) => (releaseFirst = r)))
      .mockResolvedValueOnce([DEFAULT, OTHER]);
    const first = customDashboardsStore.initialize('org-1');
    const second = customDashboardsStore.initialize('org-1', { dashboardId: 'dash-other' });
    await second;
    releaseFirst([DEFAULT, OTHER]);
    await first;
    expect(get(activeDashboard)?.id).toBe('dash-other');
  });

  it('renameDashboard returns false on API error', async () => {
    api.update.mockRejectedValue(new Error('boom'));
    await customDashboardsStore.initialize('org-1');
    const ok = await customDashboardsStore.renameDashboard('dash-other', 'org-1', 'New');
    expect(ok).toBe(false);
    expect(get(dashboardList).find((d) => d.id === 'dash-other')?.name).toBe('dash-other');
  });

  it('renameDashboard returns true and updates the list on success', async () => {
    api.update.mockResolvedValue({ ...OTHER, name: 'New' });
    await customDashboardsStore.initialize('org-1');
    const ok = await customDashboardsStore.renameDashboard('dash-other', 'org-1', 'New');
    expect(ok).toBe(true);
    expect(get(dashboardList).find((d) => d.id === 'dash-other')?.name).toBe('New');
  });

  it('deleteDashboard returns false on API error and keeps the dashboard in the list', async () => {
    api.delete.mockRejectedValue(new Error('boom'));
    await customDashboardsStore.initialize('org-1');
    const ok = await customDashboardsStore.deleteDashboard('dash-other', 'org-1');
    expect(ok).toBe(false);
    expect(get(dashboardList).map((d) => d.id)).toContain('dash-other');
  });

  it('deleteDashboard returns true and removes the dashboard on success', async () => {
    api.delete.mockResolvedValue(undefined);
    await customDashboardsStore.initialize('org-1');
    const ok = await customDashboardsStore.deleteDashboard('dash-other', 'org-1');
    expect(ok).toBe(true);
    expect(get(dashboardList).map((d) => d.id)).not.toContain('dash-other');
  });

  it('duplicateDashboard adds the copy to the list', async () => {
    const copy = dashboard('dash-copy');
    api.duplicate.mockResolvedValue(copy);
    await customDashboardsStore.initialize('org-1');
    const res = await customDashboardsStore.duplicateDashboard('dash-other', 'org-1', 'Copy');
    expect(res?.id).toBe('dash-copy');
    expect(api.duplicate).toHaveBeenCalledWith('dash-other', 'org-1', 'Copy');
    expect(get(dashboardList).map((d) => d.id)).toContain('dash-copy');
  });

  it('duplicateDashboard returns null on error', async () => {
    api.duplicate.mockRejectedValue(new Error('limit'));
    const res = await customDashboardsStore.duplicateDashboard('dash-other', 'org-1');
    expect(res).toBeNull();
  });

  it('createFromTemplate adds the dashboard to the list', async () => {
    const created = dashboard('dash-tpl');
    api.createFromTemplate.mockResolvedValue(created);
    await customDashboardsStore.initialize('org-1');
    const res = await customDashboardsStore.createFromTemplate({
      organizationId: 'org-1',
      templateId: 'service-health',
      projectId: null,
    });
    expect(res?.id).toBe('dash-tpl');
    expect(get(dashboardList).map((d) => d.id)).toContain('dash-tpl');
  });

  it('createFromTemplate returns null on error', async () => {
    api.createFromTemplate.mockRejectedValue(new Error('nope'));
    const res = await customDashboardsStore.createFromTemplate({
      organizationId: 'org-1',
      templateId: 'service-health',
    });
    expect(res).toBeNull();
  });

  it('rapid switchTo calls keep the last requested dashboard active', async () => {
    await customDashboardsStore.initialize('org-1');
    // Not in the list, so the first switch goes through a slow getById.
    const slow = dashboard('dash-slow');
    let releaseSlow: (d: CustomDashboard) => void = () => {};
    api.getById.mockImplementationOnce(() => new Promise<CustomDashboard>((r) => (releaseSlow = r)));
    const first = customDashboardsStore.switchTo('dash-slow');
    const second = customDashboardsStore.switchTo('dash-other');
    await second;
    releaseSlow(slow);
    await first;
    expect(get(activeDashboard)?.id).toBe('dash-other');
  });
});
