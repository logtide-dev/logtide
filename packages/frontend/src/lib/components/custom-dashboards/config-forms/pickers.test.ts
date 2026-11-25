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
import type { TopNTableConfig } from '@logtide/shared';

// jsdom lacks these; bits-ui Select calls them when opening an option list.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

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
