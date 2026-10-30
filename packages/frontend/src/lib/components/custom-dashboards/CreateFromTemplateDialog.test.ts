import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = vi.fn().mockResolvedValue({ projects: [] });
  },
}));

import CreateFromTemplateDialog from './CreateFromTemplateDialog.svelte';
import type { DashboardTemplateSummary } from '$lib/api/custom-dashboards';

const templates: DashboardTemplateSummary[] = [
  {
    id: 'service-health',
    name: 'Service health',
    description: 'Volume, errors and latency.',
    panelCount: 9,
    panelTypes: ['single_stat', 'time_series'],
  },
  {
    id: 'errors-overview',
    name: 'Errors overview',
    description: 'Errors at a glance.',
    panelCount: 5,
    panelTypes: ['single_stat'],
  },
];

function mount(overrides: Record<string, unknown> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  const onOpen = vi.fn();
  render(CreateFromTemplateDialog, {
    props: {
      open: true,
      templates,
      loading: false,
      onCreate,
      onOpen,
      onOpenChange,
      ...overrides,
    },
  });
  return { onCreate, onOpenChange, onOpen };
}

describe('CreateFromTemplateDialog', () => {
  it('lists templates with name, description and panel count', async () => {
    mount();
    expect(await screen.findByText('Service health')).toBeInTheDocument();
    expect(screen.getByText('Volume, errors and latency.')).toBeInTheDocument();
    expect(screen.getByText(/9\s+panels/)).toBeInTheDocument();
    expect(screen.getByText('Errors overview')).toBeInTheDocument();
  });

  it('asks the owner to load the templates when it opens', async () => {
    const { onOpen } = mount();
    await screen.findByText('Service health');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('submits templateId and projectId, name left out when empty', async () => {
    const { onCreate, onOpenChange } = mount();
    await fireEvent.click(await screen.findByRole('radio', { name: /Errors overview/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        templateId: 'errors-overview',
        name: undefined,
        projectId: null,
      })
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps Create disabled until a template is chosen', async () => {
    mount();
    await screen.findByText('Service health');
    expect(screen.getByRole('button', { name: 'Create dashboard' })).toBeDisabled();
  });

  it('shows the loading state', async () => {
    mount({ templates: [], loading: true });
    expect(await screen.findByTestId('templates-loading')).toBeInTheDocument();
  });

  it('shows the failure state', async () => {
    mount({ templates: [], error: 'Failed to load templates' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load templates');
  });
});
