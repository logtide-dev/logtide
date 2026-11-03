import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const pending = () => new Promise<never>(() => {});

const h = vi.hoisted(() => ({
  extList: [] as unknown[],
  getAuthConfig: vi.fn(),
  pageState: { params: { id: 'org-1' }, url: { pathname: '/dashboard/admin/organizations/org-1' } },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: h.pageState }));
vi.mock('$lib/extensions/index', () => ({ extensions: h.extList }));
vi.mock('$lib/api/auth', () => ({ authAPI: { getAuthConfig: h.getAuthConfig } }));
vi.mock('$lib/api/admin', () => ({
  adminAPI: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'getOrganizationDetails')
          return async () => ({
            id: 'org-1',
            name: 'Acme',
            slug: 'acme',
            retentionDays: 30,
            auditRetentionDays: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            members: [],
            projects: [],
          });
        if (prop === 'getProjects') return async () => ({ projects: [], total: 0, totalPages: 1 });
        return () => pending();
      },
    },
  ),
}));

import { authStore } from '$lib/stores/auth';
import type { FrontendExtension } from '$lib/extensions/types';
import OrgPage from '../../../routes/dashboard/admin/organizations/[id]/+page.svelte';
import EchoPanel from './__fixtures__/EchoPanel.svelte';
import ThrowingPanel from './__fixtures__/ThrowingPanel.svelte';

const enabled = { authMode: 'standard', signupEnabled: true, extensions: { fx: { enabled: true } } };

function navIds(): string[] {
  const nav = screen.getByTestId('org-side-nav');
  return [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href')!.slice(1));
}

describe('admin organization page: extension panels', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A', is_admin: true }, 'token');
    h.extList.splice(0, h.extList.length);
    h.getAuthConfig.mockReset();
    h.getAuthConfig.mockResolvedValue(enabled);
  });

  it('without extensions the side nav lists the core sections', async () => {
    render(OrgPage as never);
    await screen.findByTestId('org-side-nav');
    expect(navIds()).toEqual(['projects', 'members', 'retention', 'entitlements', 'danger-zone']);
    expect(h.getAuthConfig).not.toHaveBeenCalled();
  });

  it('extension panels are listed before Danger zone and rendered with orgId', async () => {
    const fx: FrontendExtension = {
      name: 'fx',
      isEnabled: (c) => c.extensions?.fx?.enabled === true,
      adminOrgPanels: [{ id: 'billing', label: 'Billing', component: EchoPanel }],
    };
    h.extList.push(fx);
    render(OrgPage as never);
    expect(await screen.findByTestId('echo-panel')).toHaveTextContent('panel for org-1');
    expect(navIds()).toEqual(['projects', 'members', 'retention', 'entitlements', 'ext-fx-billing', 'danger-zone']);
    expect(screen.getByTestId('echo-panel').closest('#ext-fx-billing')).not.toBeNull();
  });

  it('a panel that throws shows the error line and the rest of the page still renders', async () => {
    const fx: FrontendExtension = {
      name: 'fx',
      isEnabled: (c) => c.extensions?.fx?.enabled === true,
      adminOrgPanels: [{ id: 'broken', label: 'Broken', component: ThrowingPanel }],
    };
    h.extList.push(fx);
    render(OrgPage as never);
    await waitFor(() => expect(screen.getByText(/Could not load Broken/)).toBeInTheDocument());
    expect(screen.getByText(/panel exploded for org-1/)).toBeInTheDocument();
    expect(document.getElementById('danger-zone')).not.toBeNull();
    expect(document.getElementById('retention')).not.toBeNull();
  });
});
