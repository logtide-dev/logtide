import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { OrganizationWithRole } from '@logtide/shared';

interface OrganizationState {
  organizations: OrganizationWithRole[];
  currentOrganization: OrganizationWithRole | null;
  loading: boolean;
}

const ORG_ID_KEY = 'currentOrganizationId';
const ORG_OBJECT_KEY = 'currentOrganization';

/**
 * Restore the last selected organization object from localStorage.
 * Persisting the whole object (not just its id) lets a hard reload of a
 * sub-route render the org name immediately instead of flashing
 * "Select organization" while the org list is still being fetched.
 */
function loadCachedOrganization(): OrganizationWithRole | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(ORG_OBJECT_KEY);
    return raw ? (JSON.parse(raw) as OrganizationWithRole) : null;
  } catch {
    return null;
  }
}

function persistCurrentOrganization(org: OrganizationWithRole | null): void {
  if (!browser) return;
  if (org) {
    localStorage.setItem(ORG_ID_KEY, org.id);
    localStorage.setItem(ORG_OBJECT_KEY, JSON.stringify(org));
  } else {
    localStorage.removeItem(ORG_ID_KEY);
    localStorage.removeItem(ORG_OBJECT_KEY);
  }
}

const initialState: OrganizationState = {
  organizations: [],
  currentOrganization: loadCachedOrganization(),
  loading: false,
};

function createOrganizationStore() {
  const { subscribe, set, update } = writable<OrganizationState>(initialState);

  return {
    subscribe,


    setOrganizations: (organizations: OrganizationWithRole[]) => {
      update((state) => {
        const currentOrganization = state.currentOrganization || organizations[0] || null;

        const savedOrgId = browser ? localStorage.getItem(ORG_ID_KEY) : null;
        const restoredOrg = savedOrgId
          ? organizations.find((org) => org.id === savedOrgId)
          : null;

        const resolved = restoredOrg || currentOrganization;
        persistCurrentOrganization(resolved);

        return {
          ...state,
          organizations,
          currentOrganization: resolved,
        };
      });
    },


    setCurrentOrganization: (organizationOrId: OrganizationWithRole | string | null) => {
      update((state) => {
        let organization: OrganizationWithRole | null = null;

        if (typeof organizationOrId === 'string') {
          organization = state.organizations.find((org) => org.id === organizationOrId) || null;
        } else {
          organization = organizationOrId;
        }

        persistCurrentOrganization(organization);

        return {
          ...state,
          currentOrganization: organization,
        };
      });
    },


    addOrganization: (organization: OrganizationWithRole) => {
      update((state) => {
        persistCurrentOrganization(organization);
        return {
          ...state,
          organizations: [organization, ...state.organizations],
          currentOrganization: organization,
        };
      });
    },

    updateOrganization: (id: string, updates: Partial<OrganizationWithRole>) => {
      update((state) => {
        const organizations = state.organizations.map((org) =>
          org.id === id ? { ...org, ...updates } : org
        );

        const currentOrganization =
          state.currentOrganization?.id === id
            ? { ...state.currentOrganization, ...updates }
            : state.currentOrganization;

        // Keep the cached object fresh so a reload does not show a stale name.
        if (state.currentOrganization?.id === id) {
          persistCurrentOrganization(currentOrganization);
        }

        return {
          ...state,
          organizations,
          currentOrganization,
        };
      });
    },


    removeOrganization: (id: string) => {
      update((state) => {
        const organizations = state.organizations.filter((org) => org.id !== id);
        const currentOrganization =
          state.currentOrganization?.id === id
            ? organizations[0] || null
            : state.currentOrganization;

        if (state.currentOrganization?.id === id) {
          persistCurrentOrganization(currentOrganization);
        }

        return {
          ...state,
          organizations,
          currentOrganization,
        };
      });
    },


    setLoading: (loading: boolean) => {
      update((state) => ({ ...state, loading }));
    },


    createOrganization: async (apiCall: () => Promise<OrganizationWithRole>) => {
      update((state) => ({ ...state, loading: true }));

      try {
        const newOrg = await apiCall();

        update((state) => {
          persistCurrentOrganization(newOrg);

          return {
            ...state,
            organizations: [newOrg, ...state.organizations],
            currentOrganization: newOrg,
            loading: false,
          };
        });

        return newOrg;
      } catch (error) {
        update((state) => ({ ...state, loading: false }));
        throw error;
      }
    },


    fetchOrganizations: async (apiCall: () => Promise<OrganizationWithRole[]>) => {
      update((state) => ({ ...state, loading: true }));

      try {
        const orgs = await apiCall();

        update((state) => {
          const savedOrgId = browser ? localStorage.getItem(ORG_ID_KEY) : null;
          const restoredOrg = savedOrgId
            ? orgs.find((org) => org.id === savedOrgId)
            : null;

          const currentOrganization = restoredOrg || orgs[0] || null;

          // Refresh the cache with the authoritative fetched object (fresh name/role),
          // or drop it if the previously selected org no longer exists.
          persistCurrentOrganization(currentOrganization);

          return {
            ...state,
            organizations: orgs,
            currentOrganization,
            loading: false,
          };
        });

        return orgs;
      } catch (error) {
        update((state) => ({ ...state, loading: false }));
        throw error;
      }
    },


    hasOrganizations: () => {
      const state = get(organizationStore);
      return state.organizations.length > 0;
    },


    clear: () => {
      persistCurrentOrganization(null);
      set({ organizations: [], currentOrganization: null, loading: false });
    },
  };
}

export const organizationStore = createOrganizationStore();

export const currentOrganization = derived(
  organizationStore,
  ($store) => $store.currentOrganization
);

export const organizations = derived(organizationStore, ($store) => $store.organizations);
