import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const reset = vi.fn();
vi.mock('$lib/stores/org-projects', () => ({
  orgProjectsStore: { reset: (...a: unknown[]) => reset(...a), load: vi.fn(), projectName: vi.fn(), subscribe: vi.fn() },
}));
const clearPaletteCache = vi.fn();
vi.mock('./palette/registry', () => ({ clearPaletteCache: () => clearPaletteCache() }));

import { switchOrganization } from './org-switch';
import { organizationStore } from '$lib/stores/organization';
import { scopeStore } from '$lib/stores/scope';

const org = (id: string, name = id) =>
  ({ id, name, slug: id, role: 'owner' }) as unknown as Parameters<typeof switchOrganization>[0];

describe('switchOrganization', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockReset();
    reset.mockReset();
    clearPaletteCache.mockReset();
    scopeStore.reset();
    organizationStore.setCurrentOrganization(org('org-a'));
  });

  afterEach(() => {
    organizationStore.setCurrentOrganization(null);
    scopeStore.reset();
  });

  it('navigates a detail page to its section list in the new organization', () => {
    switchOrganization(org('org-b'), { pathname: '/dashboard/errors/abc', navigate });
    expect(get(organizationStore).currentOrganization?.id).toBe('org-b');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/dashboard/errors');
  });

  it('drops the query string and the stale project selection', () => {
    scopeStore.setProjects(['p-1']);
    switchOrganization(org('org-b'), { pathname: '/dashboard/traces/abc?project=p-1', navigate });
    expect(navigate).toHaveBeenCalledWith('/dashboard/traces');
    expect(scopeStore.get().projectIds).toEqual([]);
  });

  it('keeps settings paths', () => {
    switchOrganization(org('org-b'), { pathname: '/dashboard/settings/members', navigate });
    expect(navigate).toHaveBeenCalledWith('/dashboard/settings/members');
  });

  it('does nothing when the organization is already active', () => {
    scopeStore.setProjects(['p-1']);
    switchOrganization(org('org-a'), { pathname: '/dashboard/errors/abc', navigate });
    expect(navigate).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(scopeStore.get().projectIds).toEqual(['p-1']);
  });

  it('clears the palette cache and org projects', () => {
    switchOrganization(org('org-b'), { pathname: '/dashboard', navigate });
    expect(clearPaletteCache).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
