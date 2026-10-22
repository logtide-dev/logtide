import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { createOrganization, createProject, updateState, getState, reset } = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  createProject: vi.fn(),
  updateState: vi.fn(),
  getState: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('$lib/api/organizations', () => ({
  OrganizationsAPI: class {
    createOrganization = createOrganization;
  },
}));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { createProject } }));
vi.mock('$lib/api/onboarding', () => ({
  OnboardingAPI: class {
    updateState = updateState;
    getState = getState;
    reset = reset;
  },
}));
vi.mock('$lib/stores/checklist', () => ({
  checklistStore: { completeItem: vi.fn().mockResolvedValue(undefined) },
}));

import WorkspaceStep from './WorkspaceStep.svelte';
import { onboardingStore } from '$lib/stores/onboarding';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { get } from 'svelte/store';

beforeEach(async () => {
  localStorage.clear();
  createOrganization.mockReset();
  createProject.mockReset();
  updateState.mockReset().mockResolvedValue({});
  getState.mockReset().mockResolvedValue({
    tutorialCompleted: false,
    tutorialSkipped: false,
    tutorialStep: 0,
    step: null,
    organizationId: null,
    projectId: null,
  });
  reset.mockReset().mockResolvedValue({});
  authStore.setAuth({ id: 'u1', email: 'jane@acme.io', name: 'Jane' }, 'tok');
  organizationStore.setOrganizations([]);
  await onboardingStore.reset();
  updateState.mockClear();
});

describe('WorkspaceStep', () => {
  it('creates org then project with one submit and moves to connect', async () => {
    createOrganization.mockResolvedValue({ organization: { id: 'o1', name: 'Acme' } });
    createProject.mockResolvedValue({ project: { id: 'p1', name: 'Production' } });
    render(WorkspaceStep);
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: 'Acme' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(get(onboardingStore).step).toBe('connect'));
    expect(createOrganization).toHaveBeenCalledWith({ name: 'Acme' });
    expect(createProject).toHaveBeenCalledWith({ organizationId: 'o1', name: 'Production' });
    expect(get(onboardingStore).projectId).toBe('p1');
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'o1', projectId: 'p1', step: 'connect' })
    );
  });

  it('resumes with a stored org and only creates the project', async () => {
    onboardingStore.hydrate({ step: 'workspace', organizationId: 'o9', projectId: null });
    createProject.mockResolvedValue({ project: { id: 'p2', name: 'Staging' } });
    render(WorkspaceStep);
    expect(screen.queryByLabelText('Organization name')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Staging' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(get(onboardingStore).step).toBe('connect'));
    expect(createOrganization).not.toHaveBeenCalled();
    expect(createProject).toHaveBeenCalledWith({ organizationId: 'o9', name: 'Staging' });
  });

  it('shows the API error and stays when project creation fails after org creation', async () => {
    createOrganization.mockResolvedValue({ organization: { id: 'o1', name: 'Acme' } });
    createProject.mockRejectedValue(new Error('Project limit reached for your plan'));
    render(WorkspaceStep);
    await fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: 'Acme' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(screen.getByText('Project limit reached for your plan')).toBeTruthy());
    expect(get(onboardingStore).step).not.toBe('connect');
    // The org id is already stored so a retry creates only the project.
    expect(get(onboardingStore).organizationId).toBe('o1');
    expect(updateState).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'o1' }));
  });
});
