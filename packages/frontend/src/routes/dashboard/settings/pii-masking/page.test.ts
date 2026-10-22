import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  testMasking: vi.fn(),
  getProjects: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/pii-masking', () => ({
  piiMaskingAPI: {
    listRules: h.listRules,
    createRule: h.createRule,
    updateRule: h.updateRule,
    deleteRule: h.deleteRule,
    testMasking: h.testMasking,
  },
}));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/stores/toast', () => ({ toastStore: h.toast }));

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

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  organizationId: 'org-1',
  projectId: null,
  name: 'custom_id',
  displayName: 'Custom ID',
  description: null,
  patternType: 'custom',
  regexPattern: '\\d+',
  fieldNames: [],
  action: 'redact',
  enabled: true,
  priority: 50,
  isBuiltIn: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('PII masking page', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(h).forEach((m) => {
      if (typeof m === 'function') m.mockReset();
    });
    h.toast.success.mockReset();
    h.toast.error.mockReset();
    h.listRules.mockResolvedValue([rule()]);
    h.getProjects.mockResolvedValue({
      projects: [
        { id: 'p1', name: 'Checkout' },
        { id: 'p2', name: 'Billing' },
      ],
    });
    h.createRule.mockResolvedValue(rule());
    h.deleteRule.mockResolvedValue(undefined);
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
    organizationStore.setCurrentOrganization(org('owner') as never);
  });

  it('has the header scoped to the organization', async () => {
    render(Page);
    await screen.findByText('Custom ID');
    expect(screen.getByRole('heading', { level: 1, name: 'PII masking' })).toBeInTheDocument();
    expect(screen.getByText('Applies to: Organization')).toBeInTheDocument();
  });

  it('selecting a project reloads rules with that projectId', async () => {
    render(Page);
    await screen.findByText('Custom ID');
    expect(h.listRules).toHaveBeenLastCalledWith(undefined);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Checkout' })).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText('Applies to:'), { target: { value: 'p1' } });
    await waitFor(() => expect(h.listRules).toHaveBeenLastCalledWith('p1'));
  });

  async function fillAndCreate() {
    await fireEvent.click(await screen.findByRole('button', { name: /Add rule/ }));
    await fireEvent.input(screen.getByLabelText('Name *'), { target: { value: 'my_rule' } });
    await fireEvent.input(screen.getByLabelText('Display name *'), { target: { value: 'My rule' } });
    await fireEvent.input(screen.getByLabelText('Regex pattern'), { target: { value: 'x+' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(h.createRule).toHaveBeenCalledTimes(1));
    return h.createRule.mock.calls[0][0];
  }

  it('Add rule while a project is selected sends projectId', async () => {
    render(Page);
    await screen.findByText('Custom ID');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Checkout' })).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText('Applies to:'), { target: { value: 'p1' } });
    await waitFor(() => expect(h.listRules).toHaveBeenLastCalledWith('p1'));
    const input = await fillAndCreate();
    expect(input.projectId).toBe('p1');
  });

  it('All projects sends no projectId', async () => {
    render(Page);
    await screen.findByText('Custom ID');
    const input = await fillAndCreate();
    expect('projectId' in input).toBe(false);
  });

  it('scope badge shows Project for rows with projectId', async () => {
    h.listRules.mockResolvedValue([
      rule({ id: 'r1', displayName: 'Org rule' }),
      rule({ id: 'r2', displayName: 'Proj rule', projectId: 'p1' }),
    ]);
    render(Page);
    await screen.findByText('Proj rule');
    const badges = screen.getAllByTestId('rule-scope').map((b) => b.textContent?.trim());
    expect(badges).toEqual(['Organization', 'Project']);
  });

  it('member sees notice and no Add rule button', async () => {
    organizationStore.setCurrentOrganization(org('member') as never);
    render(Page);
    await screen.findByText('Custom ID');
    expect(screen.getByTestId('read-only-notice').textContent).toContain('PII masking rules');
    expect(screen.queryByRole('button', { name: /Add rule/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Custom ID' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Custom ID' })).toBeNull();
    // The test panel stays usable.
    expect(screen.getByRole('button', { name: 'Test masking' })).not.toBeDisabled();
  });

  it('callout mentions new data only, spans, and rejected records', async () => {
    render(Page);
    const callout = await screen.findByTestId('pii-callouts');
    expect(callout.textContent).toContain('Rules apply to new data only. Existing logs are not changed.');
    expect(callout.textContent).toContain('Rules also cover trace spans.');
    expect(callout.textContent).toContain('rejected');
    expect(callout.textContent).toContain('never stored unmasked');
  });

  it('delete uses ConfirmDialog and calls deleteRule on confirm', async () => {
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Delete Custom ID' }));
    expect(h.deleteRule).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete rule');
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete rule'
    ) as HTMLButtonElement;
    await fireEvent.click(confirmBtn);
    await waitFor(() => expect(h.deleteRule).toHaveBeenCalledWith('r1'));
  });

  it('icon buttons expose aria-labels', async () => {
    render(Page);
    await screen.findByText('Custom ID');
    expect(screen.getByRole('button', { name: 'Edit Custom ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Custom ID' })).toBeInTheDocument();
  });
});
