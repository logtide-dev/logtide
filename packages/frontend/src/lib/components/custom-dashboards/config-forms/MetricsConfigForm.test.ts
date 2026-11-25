import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import type { MetricsPanelConfig } from '@logtide/shared';

const { getProjects, lookups } = vi.hoisted(() => ({
  getProjects: vi.fn(),
  lookups: {
    getCatalog: vi.fn(),
    getAttributes: vi.fn(),
    getAttributeValues: vi.fn(),
  },
}));

vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = getProjects;
  },
}));
vi.mock('$lib/api/metrics-v2', () => ({ metricsV2API: lookups }));
vi.mock('$lib/stores/auth', async () => {
  const { readable } = await import('svelte/store');
  return { authStore: readable({ token: 'tok' }) };
});
vi.mock('$lib/stores/organization', async () => {
  const { readable } = await import('svelte/store');
  return { organizationStore: readable({ currentOrganization: { id: 'org-1' } }) };
});

import MetricsConfigForm from './MetricsConfigForm.svelte';
import { getPanelDefinition } from '../panel-registry';
import { customDashboardsStore } from '$lib/stores/custom-dashboards';

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const base = getPanelDefinition('metrics').defaultConfig as MetricsPanelConfig;

beforeEach(() => {
  vi.clearAllMocks();
  getProjects.mockResolvedValue({ projects: [{ id: 'proj-1', name: 'Edge' }] });
  lookups.getCatalog.mockResolvedValue({ metrics: [] });
  lookups.getAttributes.mockResolvedValue([]);
  lookups.getAttributeValues.mockResolvedValue([]);
  customDashboardsStore.reset();
});

describe('MetricsConfigForm', () => {
  it('shows title and time range from the config', () => {
    render(MetricsConfigForm, { props: { config: { ...base, title: 'CPU by host' }, onChange: vi.fn() } });
    expect(screen.getByLabelText('Title')).toHaveValue('CPU by host');
    expect(screen.getByLabelText('Time range')).toHaveTextContent('24 hours');
  });

  it('emits the edited title and keeps the rest of the config (round trip)', async () => {
    const onChange = vi.fn();
    const config = { ...base, timeRange: '6h' as const };
    render(MetricsConfigForm, { props: { config, onChange } });
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Memory' } });
    expect(onChange).toHaveBeenCalledWith({ ...config, title: 'Memory' });
  });

  it('renders the query builder with the display toggle', () => {
    render(MetricsConfigForm, { props: { config: base, onChange: vi.fn() } });
    expect(screen.getByRole('combobox', { name: 'Metric A' })).toBeInTheDocument();
  });

  it('scopes the query to several projects and back to all (null)', async () => {
    getProjects.mockResolvedValue({
      projects: [
        { id: 'proj-1', name: 'Edge' },
        { id: 'proj-2', name: 'Core' },
      ],
    });
    const onChange = vi.fn();
    const { rerender } = render(MetricsConfigForm, { props: { config: base, onChange } });
    await waitFor(() => expect(getProjects).toHaveBeenCalled());
    const label = screen.getByText('Projects', { selector: 'label' });
    const trigger = document.getElementById(label.getAttribute('for') as string) as HTMLElement;
    expect(trigger).toHaveTextContent('All projects');
    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('checkbox', { name: 'Edge' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ projectIds: ['proj-1'] }) })
    );

    const one = { ...base, query: { ...base.query, projectIds: ['proj-1'] } };
    await rerender({ config: one, onChange });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Core' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ projectIds: ['proj-1', 'proj-2'] }) })
    );

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Edge' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ projectIds: null }) })
    );
  });
});
