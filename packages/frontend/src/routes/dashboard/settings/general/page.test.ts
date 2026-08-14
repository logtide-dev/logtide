import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { displayPreferences } from '$lib/stores/display-preferences';

const baseOrg = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role: 'owner' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('organization settings retention display', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
  });

  it('shows the organization retention value', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 365 });

    render(Page);

    expect(screen.getByText('365 days')).toBeInTheDocument();
  });

  // Regression for #288: a cached org object without retentionDays must not
  // silently render as a 90 day policy.
  it('does not fall back to 90 days when retentionDays is missing', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg } as never);

    const { container } = render(Page);

    expect(container.textContent).not.toMatch(/90 days/);
  });
});

describe('display preferences card (#297)', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 30 });
  });

  afterEach(() => {
    displayPreferences.set({ hour12: false, timeZone: null });
  });

  it('reflects the stored preferences in the selects', () => {
    displayPreferences.set({ hour12: true, timeZone: 'America/Los_Angeles' });

    render(Page);

    expect(screen.getByText('Display')).toBeInTheDocument();
    expect(screen.getByText('12-hour (AM/PM)')).toBeInTheDocument();
    expect(screen.getByText('America/Los_Angeles')).toBeInTheDocument();
  });

  it('shows the defaults when nothing is stored', () => {
    render(Page);

    expect(screen.getByText('24-hour')).toBeInTheDocument();
    expect(screen.getByText('Browser default')).toBeInTheDocument();
  });
});
