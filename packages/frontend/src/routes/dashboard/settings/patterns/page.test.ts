import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  listPatterns: vi.fn(),
  updatePattern: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/patterns', () => ({
  patternsAPI: {
    listPatterns: h.listPatterns,
    createPattern: vi.fn(),
    updatePattern: h.updatePattern,
    deletePattern: vi.fn(),
    testPattern: vi.fn(),
  },
}));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';

const org = (role: 'owner' | 'admin' | 'member') => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('identifier extraction page', () => {
  beforeEach(() => {
    localStorage.clear();
    h.listPatterns.mockReset();
    h.updatePattern.mockReset();
    h.updatePattern.mockResolvedValue({});
    h.listPatterns.mockResolvedValue({
      custom: [
        {
          id: 'p1',
          name: 'customer_id',
          displayName: 'Customer ID',
          pattern: 'CUS-[A-Z0-9]{8}',
          fieldNames: ['customer_id'],
          priority: 50,
          enabled: true,
        },
      ],
      defaults: [],
    });
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
    organizationStore.setCurrentOrganization(org('owner') as never);
  });

  it('shows Identifier extraction header and no Identifier Patterns text', async () => {
    const { container } = render(Page);
    await screen.findByText('Customer ID');
    expect(screen.getByRole('heading', { level: 1, name: 'Identifier extraction' })).toBeInTheDocument();
    expect(screen.getByText('Applies to: Organization')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Identifier Patterns/);
  });

  it('owner can add, edit and delete', async () => {
    render(Page);
    await screen.findByText('Customer ID');
    expect(screen.getByRole('button', { name: /Add pattern/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Customer ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Customer ID' })).toBeInTheDocument();
  });

  it('member sees notice and no write controls', async () => {
    organizationStore.setCurrentOrganization(org('member') as never);
    render(Page);
    await screen.findByText('Customer ID');
    expect(screen.getByTestId('read-only-notice').textContent).toContain('identifier extraction patterns');
    expect(screen.queryByRole('button', { name: /Add pattern/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Customer ID' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Customer ID' })).toBeNull();
    // testing a regex stays available
    expect(screen.getByRole('button', { name: /Test pattern/ })).toBeInTheDocument();
  });

  it('sends the current organization with every call and follows an organization switch', async () => {
    render(Page);
    await screen.findByText('Customer ID');
    expect(h.listPatterns).toHaveBeenLastCalledWith('org-1');

    // toggling a pattern updates it in the organization on screen
    await fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.updatePattern).toHaveBeenCalledTimes(1));
    expect(h.updatePattern.mock.calls[0][0]).toBe('org-1');
    expect(h.updatePattern.mock.calls[0][1]).toBe('p1');

    organizationStore.setCurrentOrganization({ ...org('owner'), id: 'org-2' } as never);
    await waitFor(() => expect(h.listPatterns).toHaveBeenLastCalledWith('org-2'));
  });
});
