import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { DashboardVariable, PanelInstance } from '@logtide/shared';
import DashboardVariablesBar from './DashboardVariablesBar.svelte';
import { chooseSelectOption, openSelect } from '$lib/test-utils/select-field';

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const host: DashboardVariable = {
  name: 'host',
  label: 'Host',
  attr: { scope: 'resource', key: 'host.name' },
  metricName: null,
  default: null,
};

function setup(values: Record<string, string | null> = {}, variables = [host], projectId: string | null = null) {
  const api = { getAttributeValues: vi.fn().mockResolvedValue(['web-1', 'web-2']) };
  const onChange = vi.fn();
  render(DashboardVariablesBar, { variables, values, organizationId: 'org-1', projectId, onChange, api });
  return { api, onChange };
}

beforeEach(() => vi.clearAllMocks());

describe('DashboardVariablesBar', () => {
  it('renders nothing without variables', () => {
    setup({}, []);
    expect(screen.queryByTestId('dashboard-variables')).not.toBeInTheDocument();
  });

  it('loads options for the variable attribute with org and project scope', async () => {
    const { api } = setup({}, [{ ...host, metricName: 'system.cpu.utilization.total' }], 'proj-1');
    await waitFor(() =>
      expect(api.getAttributeValues).toHaveBeenCalledWith({
        organizationId: 'org-1',
        projectIds: ['proj-1'],
        scope: 'resource',
        key: 'host.name',
        metricName: 'system.cpu.utilization.total',
      })
    );
  });

  function metricsPanel(id: string, projectIds: string[] | null): PanelInstance {
    return {
      id,
      config: { type: 'metrics', title: id, source: 'metrics', query: { projectIds, queries: [] } },
    } as unknown as PanelInstance;
  }

  it('looks values up across the union of the metrics panels projects', async () => {
    const api = { getAttributeValues: vi.fn().mockResolvedValue([]) };
    render(DashboardVariablesBar, {
      variables: [host],
      values: {},
      organizationId: 'org-1',
      projectId: 'dash-proj',
      panels: [metricsPanel('a', ['p2', 'p1']), metricsPanel('b', ['p1', 'p3'])],
      onChange: vi.fn(),
      api,
    });
    await waitFor(() =>
      expect(api.getAttributeValues).toHaveBeenCalledWith(expect.objectContaining({ projectIds: ['p1', 'p2', 'p3'] }))
    );
  });

  it('looks across all projects when any metrics panel is unscoped', async () => {
    const api = { getAttributeValues: vi.fn().mockResolvedValue([]) };
    render(DashboardVariablesBar, {
      variables: [host],
      values: {},
      organizationId: 'org-1',
      projectId: 'dash-proj',
      panels: [metricsPanel('a', ['p1']), metricsPanel('b', null)],
      onChange: vi.fn(),
      api,
    });
    await waitFor(() =>
      expect(api.getAttributeValues).toHaveBeenCalledWith(expect.objectContaining({ projectIds: null }))
    );
  });

  it('offers All plus the values', async () => {
    const { api } = setup();
    await waitFor(() => expect(api.getAttributeValues).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    const names = await openSelect(screen.getByRole('combobox', { name: 'Host' }));
    expect(names).toEqual(['All', 'web-1', 'web-2']);
  });

  it('shows the current value and emits a change', async () => {
    const { api, onChange } = setup({ host: 'web-1' });
    await waitFor(() => expect(api.getAttributeValues).toHaveBeenCalled());
    const trigger = screen.getByRole('combobox', { name: 'Host' });
    expect(trigger).toHaveTextContent('web-1');
    await chooseSelectOption(trigger, 'web-2');
    expect(onChange).toHaveBeenCalledWith('host', 'web-2');
  });

  it('emits null when All is picked', async () => {
    const { api, onChange } = setup({ host: 'web-1' });
    await waitFor(() => expect(api.getAttributeValues).toHaveBeenCalled());
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Host' }), 'All');
    expect(onChange).toHaveBeenCalledWith('host', null);
  });

  it('keeps a URL value that is not in the options', async () => {
    const { api } = setup({ host: 'gone-9' });
    await waitFor(() => expect(api.getAttributeValues).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Host' })).toHaveTextContent('gone-9');
  });
});
