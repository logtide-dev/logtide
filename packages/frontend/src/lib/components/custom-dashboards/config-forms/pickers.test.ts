import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { loadPickerOptions, loadMetadataKeys, loadMetricLabelKeys, getProjects } = vi.hoisted(() => ({
  loadPickerOptions: vi.fn(),
  loadMetadataKeys: vi.fn(),
  loadMetricLabelKeys: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('../pickers/picker-options', () => ({
  loadPickerOptions,
  loadMetadataKeys,
  loadMetricLabelKeys,
  clearPickerCache: vi.fn(),
}));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = getProjects;
  },
}));
vi.mock('$lib/stores/auth', async () => {
  const { readable } = await import('svelte/store');
  return { authStore: readable({ token: 'tok' }) };
});
vi.mock('$lib/stores/organization', async () => {
  const { readable } = await import('svelte/store');
  return { organizationStore: readable({ currentOrganization: { id: 'org-1' } }) };
});

import { getPanelDefinition } from '../panel-registry';
import type { MetricChartConfig, TopNTableConfig } from '@logtide/shared';

// jsdom lacks these; bits-ui Select calls them when opening an option list.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

function metricConfig(overrides: Partial<MetricChartConfig> = {}): MetricChartConfig {
  return {
    ...(getPanelDefinition('metric_chart').defaultConfig as MetricChartConfig),
    projectId: 'proj-1',
    metricName: '',
    ...overrides,
  };
}

function renderForm(
  type: Parameters<typeof getPanelDefinition>[0],
  config: object,
  onChange = vi.fn()
) {
  render(getPanelDefinition(type).configForm as never, { props: { config, onChange } } as never);
  return onChange;
}

async function changeProject(name: string) {
  await waitFor(() => expect(getProjects).toHaveBeenCalled());
  const label = screen.getByText('Project', { selector: 'label' });
  const trigger = document.getElementById(label.getAttribute('for') as string) as HTMLElement;
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name });
  await fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
}

beforeEach(() => {
  loadPickerOptions.mockReset();
  loadMetadataKeys.mockReset();
  loadMetricLabelKeys.mockReset();
  getProjects.mockReset();
  getProjects.mockResolvedValue({
    projects: [
      { id: 'proj-1', name: 'Edge' },
      { id: 'proj-2', name: 'Core' },
    ],
  });
  loadPickerOptions.mockResolvedValue([]);
  loadMetadataKeys.mockResolvedValue([]);
  loadMetricLabelKeys.mockResolvedValue([]);
});

describe('panel form pickers', () => {
  it('metric chart metric name suggests names for the selected project', async () => {
    loadPickerOptions.mockImplementation(async (p: { kind: string }) =>
      p.kind === 'metric-names' ? ['cpu_usage', 'memory_used'] : []
    );
    renderForm('metric_chart', metricConfig());

    await waitFor(() =>
      expect(loadPickerOptions).toHaveBeenCalledWith({
        organizationId: 'org-1',
        kind: 'metric-names',
        projectId: 'proj-1',
      })
    );
    const input = screen.getByPlaceholderText('e.g. http.server.request.duration');
    await fireEvent.focus(input);
    expect(await screen.findByText('cpu_usage')).toBeInTheDocument();
    expect(screen.getByText('memory_used')).toBeInTheDocument();
  });

  it('typing a metric not in the list still emits onChange', async () => {
    loadPickerOptions.mockResolvedValue(['cpu_usage']);
    const onChange = renderForm('metric_chart', metricConfig());
    const input = screen.getByPlaceholderText('e.g. http.server.request.duration');
    await fireEvent.input(input, { target: { value: 'my.own.metric' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'my.own.metric' }));
  });

  it('form stays usable when options resolve empty', async () => {
    const onChange = renderForm('metric_chart', metricConfig());
    await waitFor(() => expect(loadPickerOptions).toHaveBeenCalled());
    const svc = screen.getByPlaceholderText('Leave empty for all services');
    await fireEvent.input(svc, { target: { value: 'checkout' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'checkout' }));
  });

  it.each(['trace_latency', 'trace_volume'] as const)(
    '%s form requests services with source traces',
    async (type) => {
      renderForm(type, { ...getPanelDefinition(type).defaultConfig, projectId: 'proj-1' });
      await waitFor(() =>
        expect(loadPickerOptions).toHaveBeenCalledWith({
          organizationId: 'org-1',
          kind: 'services',
          source: 'traces',
          projectId: 'proj-1',
        })
      );
    }
  );

  it('time series form requests log services', async () => {
    renderForm('time_series', { ...getPanelDefinition('time_series').defaultConfig, projectId: null });
    await waitFor(() =>
      expect(loadPickerOptions).toHaveBeenCalledWith({
        organizationId: 'org-1',
        kind: 'services',
        source: 'logs',
        projectId: null,
      })
    );
  });

  it('group by accepts at most 2 keys', async () => {
    const onChange = renderForm('metric_chart', metricConfig({ groupBy: ['host'] }));
    const input = screen.getByPlaceholderText('e.g. host');
    await fireEvent.input(input, { target: { value: 'region' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add group by label' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ groupBy: ['host', 'region'] }));
  });

  it('group by hides the input once two keys are set', () => {
    renderForm('metric_chart', metricConfig({ groupBy: ['host', 'region'] }));
    expect(screen.queryByPlaceholderText('e.g. host')).not.toBeInTheDocument();
  });

  it('group by rejects invalid keys', async () => {
    const onChange = renderForm('metric_chart', metricConfig());
    const input = screen.getByPlaceholderText('e.g. host');
    await fireEvent.input(input, { target: { value: 'bad key; drop' } });
    expect(screen.getByRole('button', { name: 'Add group by label' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ groupBy: expect.anything() }));
  });

  it('group by omitted from config when cleared', async () => {
    const onChange = renderForm('metric_chart', metricConfig({ groupBy: ['host'] }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove group by host' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('groupBy');
  });

  it('group by suggests label keys only with a project and a metric', async () => {
    loadMetricLabelKeys.mockResolvedValue(['host', 'region']);
    renderForm('metric_chart', metricConfig({ metricName: 'cpu_usage' }));
    await waitFor(() => expect(loadMetricLabelKeys).toHaveBeenCalledWith('proj-1', 'cpu_usage'));
    await fireEvent.focus(screen.getByPlaceholderText('e.g. host'));
    expect(await screen.findByText('region')).toBeInTheDocument();
  });

  it('group by does not request label keys without a metric name', async () => {
    renderForm('metric_chart', metricConfig({ metricName: '' }));
    await waitFor(() => expect(loadPickerOptions).toHaveBeenCalled());
    expect(loadMetricLabelKeys).not.toHaveBeenCalled();
  });

  it('top_n metadata field suggests keys from loadMetadataKeys', async () => {
    loadMetadataKeys.mockResolvedValue(['geo_place', 'http_host']);
    const cfg = {
      ...(getPanelDefinition('top_n_table').defaultConfig as TopNTableConfig),
      dimension: 'metadata' as const,
      metadataField: '',
      projectId: 'proj-1',
    };
    renderForm('top_n_table', cfg);
    await waitFor(() =>
      expect(loadMetadataKeys).toHaveBeenCalledWith({ organizationId: 'org-1', projectId: 'proj-1' })
    );
    await fireEvent.focus(screen.getByPlaceholderText('geo_place'));
    expect(await screen.findByText('http_host')).toBeInTheDocument();
  });

  it('keeps the service when the new project still offers it', async () => {
    loadPickerOptions.mockResolvedValue(['checkout', 'api']);
    const cfg = { ...getPanelDefinition('time_series').defaultConfig, projectId: null, service: 'checkout' };
    const onChange = renderForm('time_series', cfg);
    await waitFor(() => expect(loadPickerOptions).toHaveBeenCalled());
    await changeProject('Core');
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-2' }))
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ service: null }));
  });

  it('resets the service when the new project does not offer it', async () => {
    loadPickerOptions.mockResolvedValue(['api']);
    const cfg = { ...getPanelDefinition('time_series').defaultConfig, projectId: null, service: 'checkout' };
    const onChange = renderForm('time_series', cfg);
    await waitFor(() => expect(loadPickerOptions).toHaveBeenCalled());
    await changeProject('Core');
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-2', service: null })
      )
    );
  });
});
