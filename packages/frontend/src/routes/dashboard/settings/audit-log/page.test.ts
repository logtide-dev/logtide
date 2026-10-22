import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getAuditLog: vi.fn(),
  getAuditLogActions: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/audit-log', () => ({
  getAuditLog: h.getAuditLog,
  getAuditLogActions: h.getAuditLogActions,
  exportAuditLogCsv: vi.fn(),
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

const entry = {
  id: 'e1',
  time: '2026-10-01T10:00:00.000Z',
  organization_id: 'org-1',
  user_id: 'user-1',
  user_email: 'owner@example.com',
  actor_type: 'user',
  actor_id: null,
  outcome: 'success',
  action: 'org.ownership_transferred',
  category: 'user_management',
  resource_type: 'organization',
  resource_id: 'org-1',
  ip_address: null,
  user_agent: null,
  metadata: null,
};

describe('audit log page', () => {
  beforeEach(() => {
    localStorage.clear();
    h.getAuditLog.mockReset();
    h.getAuditLogActions.mockReset();
    h.getAuditLog.mockResolvedValue({ entries: [entry], total: 1 });
    h.getAuditLogActions.mockResolvedValue(['org.ownership_transferred']);
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
  });

  it('member sees the error state and the API is not called', async () => {
    organizationStore.setCurrentOrganization(org('member') as never);
    render(Page);
    expect(
      await screen.findByText('Only organization owners and admins can view the audit log')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    await Promise.resolve();
    expect(h.getAuditLog).not.toHaveBeenCalled();
    expect(h.getAuditLogActions).not.toHaveBeenCalled();
  });

  it('admin loads entries', async () => {
    organizationStore.setCurrentOrganization(org('admin') as never);
    render(Page);
    await waitFor(() => expect(h.getAuditLog).toHaveBeenCalledTimes(1));
    expect(h.getAuditLog.mock.calls[0][0].organizationId).toBe('org-1');
    expect(screen.getByText('Applies to: Organization')).toBeInTheDocument();
  });

  it('ownership_transferred has a readable label', async () => {
    organizationStore.setCurrentOrganization(org('owner') as never);
    render(Page);
    await screen.findByText('1 event');
    // appears in the table and the action filter
    expect(screen.getAllByText('Ownership transferred').length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByText('owner@example.com'));
    expect(
      await screen.findByText('owner@example.com transferred ownership of the organization')
    ).toBeInTheDocument();
  });

  it('loads all events first, then filters by the range picked in the controlled picker', async () => {
    organizationStore.setCurrentOrganization(org('owner') as never);
    render(Page);
    await waitFor(() => expect(h.getAuditLog).toHaveBeenCalledTimes(1));
    expect(h.getAuditLog.mock.calls[0][0].from).toBeUndefined();
    expect(h.getAuditLog.mock.calls[0][0].to).toBeUndefined();

    await fireEvent.click(screen.getByRole('button', { name: /Last 24 hours/ }));
    await fireEvent.click(await screen.findByText('Last 7 days'));

    await waitFor(() => expect(h.getAuditLog).toHaveBeenCalledTimes(2));
    const { from, to } = h.getAuditLog.mock.calls[1][0];
    expect(Math.abs(Date.parse(to) - Date.parse(from) - 7 * 24 * 3600 * 1000)).toBeLessThan(1000);
    expect(screen.getByRole('button', { name: /Last 7 days/ })).toBeInTheDocument();
  });
});
