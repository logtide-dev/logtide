import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';

const { state, complete } = vi.hoisted(() => ({
  state: { current: null as unknown },
  complete: { current: null as unknown },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/checklist', async () => {
  const { writable, readable } = await import('svelte/store');
  const checklistState = writable({
    items: [
      { id: 'create-project', label: 'Create project', description: 'Organize', completed: true, link: '/dashboard/projects' },
      { id: 'create-alert', label: 'Create an alert', description: 'Get notified', completed: false, link: '/dashboard/alerts' },
    ],
    collapsed: false,
    dismissed: false,
    loading: false,
    initialized: true,
  });
  const isComplete = writable(false);
  state.current = checklistState;
  complete.current = isComplete;
  return {
    checklistStore: {
      subscribe: checklistState.subscribe,
      toggleCollapsed: vi.fn(),
      dismiss: vi.fn(),
    },
    checklistProgress: readable(50),
    isChecklistComplete: isComplete,
  };
});
vi.mock('$lib/stores/organization', () => ({ currentOrganization: writable(null) }));
vi.mock('$lib/stores/auth', () => ({ authStore: writable({ token: null }) }));
vi.mock('$lib/api/projects', () => ({ ProjectsAPI: class {} }));

import OnboardingChecklist from './OnboardingChecklist.svelte';

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    (complete.current as { set: (v: boolean) => void }).set(false);
  });

  it('every icon-only button has an accessible name', () => {
    render(OnboardingChecklist);
    expect(screen.getByRole('button', { name: 'Collapse checklist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss checklist' })).toBeTruthy();
    for (const b of screen.getAllByRole('button')) {
      expect((b.textContent ?? '').trim() !== '' || b.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('shows "Setup complete" without exclamation and a named dismiss button', () => {
    (complete.current as { set: (v: boolean) => void }).set(true);
    render(OnboardingChecklist);
    expect(screen.getByText('Setup complete')).toBeTruthy();
    expect(screen.queryByText(/!/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss checklist' })).toBeTruthy();
  });

  it('uses sentence case for the heading', () => {
    render(OnboardingChecklist);
    expect(screen.getByText('Getting started')).toBeTruthy();
  });

  it('uses no raw green utility colours', () => {
    const { container } = render(OnboardingChecklist);
    expect(container.innerHTML).not.toMatch(/(text|bg|border)-green-/);
  });
});
