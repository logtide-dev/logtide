import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { OrganizationWithRole } from '@logtide/shared';
import { organizationStore } from '$lib/stores/organization';
import { scopeStore } from '$lib/stores/scope';
import { orgProjectsStore } from '$lib/stores/org-projects';
import { sectionListPath } from '$lib/nav/section-path';
import { clearPaletteCache } from './palette/registry';

export interface OrgSwitchDeps {
  pathname: string;
  navigate: (url: string) => unknown;
}

/**
 * Drop everything that belongs to the previous organization: the project
 * selection (ids of another organization), the cached project list and the
 * palette entity cache.
 */
export function resetOrgScopedState(): void {
  scopeStore.setProjects([]);
  orgProjectsStore.reset();
  clearPaletteCache();
}

/**
 * Make `org` the active organization and land on the matching list page: a
 * detail page (or a `project=` filter) of the previous organization must not
 * stay open. Switching to the already active organization is a no-op.
 */
export function switchOrganization(org: OrganizationWithRole, deps?: OrgSwitchDeps): void {
  const current = get(organizationStore).currentOrganization;
  if (current && current.id === org.id) return;

  const pathname = deps?.pathname ?? page.url.pathname;
  const navigate = deps?.navigate ?? ((url: string) => goto(url));

  organizationStore.setCurrentOrganization(org);
  resetOrgScopedState();
  navigate(sectionListPath(pathname));
}
