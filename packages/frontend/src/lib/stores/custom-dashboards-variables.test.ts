import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { CustomDashboard, DashboardVariable, PanelInstance } from '@logtide/shared';

const api = vi.hoisted(() => ({
  fetchPanelData: vi.fn(),
  getDefault: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
}));

vi.mock('$lib/api/custom-dashboards', () => ({ customDashboardsAPI: api }));

import {
  customDashboardsStore,
  variableValuesMap,
  dashboardVariables,
  resolveVariableValues,
} from './custom-dashboards';

const host: DashboardVariable = {
  name: 'host',
  label: 'Host',
  attr: { scope: 'resource', key: 'host.name' },
  metricName: null,
  default: 'web-1',
};

function panel(id: string): PanelInstance {
  return {
    id,
    layout: { x: 0, y: 0, w: 6, h: 3 },
    config: {
      type: 'metrics',
      title: id,
      source: 'metrics',
      timeRange: '24h',
      query: { projectIds: null, queries: [], formulas: [], interval: 'auto', compareTo: 'none', display: 'lines' },
    },
  } as PanelInstance;
}

function dashboard(id: string, variables: DashboardVariable[]): CustomDashboard {
  return {
    id,
    organizationId: 'org-1',
    projectId: null,
    name: id,
    description: null,
    isDefault: true,
    isPersonal: false,
    createdBy: 'user-1',
    schemaVersion: 2,
    panels: [panel(`${id}-p`)],
    variables,
    createdAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
  };
}

const WITH_VARS = dashboard('dash-v', [host]);
const PLAIN = dashboard('dash-plain', []);

beforeEach(() => {
  customDashboardsStore.reset();
  vi.clearAllMocks();
  api.list.mockResolvedValue([WITH_VARS, PLAIN]);
  api.getDefault.mockResolvedValue(WITH_VARS);
  api.fetchPanelData.mockResolvedValue({ panels: {} });
  api.update.mockResolvedValue(WITH_VARS);
});

describe('resolveVariableValues', () => {
  it('uses defaults and overlays requested values for known names only', () => {
    expect(resolveVariableValues([host], {})).toEqual({ host: 'web-1' });
    expect(resolveVariableValues([host], { host: null, other: 'x' })).toEqual({ host: null });
  });
});

describe('custom dashboards store - variables', () => {
  it('sends the defaults with the first batch fetch', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v' });
    expect(api.fetchPanelData).toHaveBeenCalledTimes(1);
    expect(api.fetchPanelData).toHaveBeenCalledWith('dash-v', 'org-1', undefined, undefined, { host: 'web-1' });
  });

  it('applies values from the URL before the first fetch', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v', variables: { host: 'web-2' } });
    expect(api.fetchPanelData).toHaveBeenCalledTimes(1);
    expect(api.fetchPanelData).toHaveBeenCalledWith('dash-v', 'org-1', undefined, undefined, { host: 'web-2' });
    expect(get(variableValuesMap)).toEqual({ host: 'web-2' });
  });

  it('sends null for All', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v', variables: { host: null } });
    expect(api.fetchPanelData).toHaveBeenCalledWith('dash-v', 'org-1', undefined, undefined, { host: null });
  });

  it('setVariable refetches with the new value', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v' });
    api.fetchPanelData.mockClear();
    await customDashboardsStore.setVariable('host', 'web-9');
    expect(api.fetchPanelData).toHaveBeenCalledTimes(1);
    expect(api.fetchPanelData).toHaveBeenCalledWith('dash-v', 'org-1', undefined, undefined, { host: 'web-9' });
  });

  it('refreshPanel carries the variables', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v' });
    api.fetchPanelData.mockClear();
    api.fetchPanelData.mockResolvedValue({ panels: { 'dash-v-p': { data: null } } });
    await customDashboardsStore.refreshPanel('dash-v-p');
    expect(api.fetchPanelData).toHaveBeenCalledWith('dash-v', 'org-1', ['dash-v-p'], undefined, { host: 'web-1' });
  });

  it('sends no variables for a dashboard without any', async () => {
    api.getDefault.mockResolvedValue(PLAIN);
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-plain' });
    expect(api.fetchPanelData).toHaveBeenCalledWith('dash-plain', 'org-1', undefined, undefined);
  });

  it('resets the selection when switching dashboard', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v', variables: { host: 'web-2' } });
    await customDashboardsStore.switchTo('dash-plain');
    expect(get(variableValuesMap)).toEqual({});
    await customDashboardsStore.switchTo('dash-v');
    expect(get(variableValuesMap)).toEqual({ host: 'web-1' });
  });

  it('saveEdit sends the edited variables with the panels', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v' });
    customDashboardsStore.enterEditMode();
    expect(get(dashboardVariables)).toEqual([host]);
    const svc: DashboardVariable = { ...host, name: 'svc', label: 'Service', default: null };
    customDashboardsStore.setPendingVariables([host, svc]);
    expect(get(dashboardVariables)).toEqual([host, svc]);
    await customDashboardsStore.saveEdit();
    expect(api.update).toHaveBeenCalledWith('dash-v', 'org-1', {
      panels: WITH_VARS.panels,
      variables: [host, svc],
    });
  });

  it('cancelEdit drops the pending variables', async () => {
    await customDashboardsStore.initialize('org-1', { dashboardId: 'dash-v' });
    customDashboardsStore.enterEditMode();
    customDashboardsStore.setPendingVariables([]);
    customDashboardsStore.cancelEdit();
    expect(get(dashboardVariables)).toEqual([host]);
  });
});
