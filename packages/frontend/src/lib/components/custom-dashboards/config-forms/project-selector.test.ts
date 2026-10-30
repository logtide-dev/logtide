import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { getProjects } = vi.hoisted(() => ({ getProjects: vi.fn() }));

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
vi.mock('../pickers/picker-options', () => ({
  loadPickerOptions: vi.fn().mockResolvedValue([]),
  loadMetadataKeys: vi.fn().mockResolvedValue([]),
  loadMetricLabelKeys: vi.fn().mockResolvedValue([]),
  clearPickerCache: vi.fn(),
}));

import { getAllPanelDefinitions } from '../panel-registry';

// jsdom lacks these; bits-ui Select calls them when opening an option list.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

beforeEach(() => {
  getProjects.mockReset();
  getProjects.mockResolvedValue({
    projects: [
      { id: 'proj-1', name: 'Edge' },
      { id: 'proj-2', name: 'Core' },
    ],
  });
});

describe.each(getAllPanelDefinitions().map((d) => [d.type, d] as const))('%s form', (_type, def) => {
  // live log tables require a project, everything else starts org-wide
  const config = { ...def.defaultConfig, projectId: null };

  it('renders a Project control', () => {
    render(def.configForm, { props: { config, onChange: vi.fn() } });
    const label = screen.getByText('Project', { selector: 'label' });
    expect(label).toBeInTheDocument();
    const forId = label.getAttribute('for');
    expect(forId).toBeTruthy();
    const trigger = document.getElementById(forId as string);
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveTextContent('All projects');
  });

  it('emits projectId on selection', async () => {
    const onChange = vi.fn();
    render(def.configForm, { props: { config, onChange } });
    await waitFor(() => expect(getProjects).toHaveBeenCalled());

    const label = screen.getByText('Project', { selector: 'label' });
    const trigger = document.getElementById(label.getAttribute('for') as string) as HTMLElement;
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = await screen.findByRole('option', { name: 'Core' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-2' }))
    );
  });
});
