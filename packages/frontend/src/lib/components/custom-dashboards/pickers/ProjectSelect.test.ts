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

import ProjectSelect from './ProjectSelect.svelte';

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

async function openSelect() {
  const trigger = screen.getByRole('button');
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
}

async function chooseOption(option: HTMLElement) {
  await fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
}

describe('ProjectSelect', () => {
  it('shows All projects when value is null', () => {
    render(ProjectSelect, { props: { value: null, onChange: vi.fn() } });
    expect(screen.getByRole('button')).toHaveTextContent('All projects');
  });

  it('shows the project name once the list has loaded', async () => {
    render(ProjectSelect, { props: { value: 'proj-1', onChange: vi.fn() } });
    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveTextContent('Edge')
    );
  });

  it('selecting a project calls onChange with its id', async () => {
    const onChange = vi.fn();
    render(ProjectSelect, { props: { value: null, onChange } });
    await waitFor(() => expect(getProjects).toHaveBeenCalled());
    await openSelect();
    const option = await screen.findByRole('option', { name: 'Core' });
    await chooseOption(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('proj-2'));
  });

  it('selecting All projects calls onChange with null', async () => {
    const onChange = vi.fn();
    render(ProjectSelect, { props: { value: 'proj-1', onChange } });
    await waitFor(() => expect(getProjects).toHaveBeenCalled());
    await openSelect();
    await chooseOption(await screen.findByRole('option', { name: 'All projects' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it('still renders when the projects request fails', async () => {
    getProjects.mockRejectedValue(new Error('down'));
    render(ProjectSelect, { props: { value: 'proj-9', onChange: vi.fn() } });
    await waitFor(() => expect(getProjects).toHaveBeenCalled());
    expect(screen.getByRole('button')).toHaveTextContent('Selected project');
  });
});
