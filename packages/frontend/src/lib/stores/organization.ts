import { writable, derived, get } from 'svelte/store';
import type { OrganizationWithRole } from '@logtide/shared';

interface OrganizationState {
  organizations: OrganizationWithRole[];
  currentOrganization: OrganizationWithRole | null;
  loading: boolean;
}

const initialState: OrganizationState = {
  organizations: [],
  currentOrganization: null,
  loading: false,
};

function createOrganizationStore() {
  const { subscribe, set, update } = writable<OrganizationState>(initialState);

  return {
    subscribe,


    setOrganizations: (organizations: OrganizationWithRole[]) => {
      update((state) => {
        const currentOrganization = state.currentOrganization || organizations[0] || null;

        const savedOrgId = localStorage.getItem('currentOrganizationId');
        const restoredOrg = savedOrgId
          ? organizations.find((org) => org.id === savedOrgId)
          : null;

        return {
          ...state,
          organizations,
          currentOrganization: restoredOrg || currentOrganization,
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

        if (organization) {
          localStorage.setItem('currentOrganizationId', organization.id);
        } else {
          localStorage.removeItem('currentOrganizationId');
        }

        return {
          ...state,
          currentOrganization: organization,
        };
      });
    },


    addOrganization: (organization: OrganizationWithRole) => {
      update((state) => ({
        ...state,
        organizations: [organization, ...state.organizations],
        currentOrganization: organization,
      }));
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
          localStorage.setItem('currentOrganizationId', newOrg.id);

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
          const savedOrgId = localStorage.getItem('currentOrganizationId');
          const restoredOrg = savedOrgId
            ? orgs.find((org) => org.id === savedOrgId)
            : null;

          const currentOrganization = restoredOrg || orgs[0] || null;

          if (currentOrganization && !savedOrgId) {
            localStorage.setItem('currentOrganizationId', currentOrganization.id);
          }

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
      localStorage.removeItem('currentOrganizationId');
      set(initialState);
    },
  };
}

export const organizationStore = createOrganizationStore();

export const currentOrganization = derived(
  organizationStore,
  ($store) => $store.currentOrganization
);

export const organizations = derived(organizationStore, ($store) => $store.organizations);
