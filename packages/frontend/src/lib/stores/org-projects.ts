import { writable, get } from 'svelte/store';
import type { Project } from '@logtide/shared';
import { projectsAPI } from '$lib/api/projects';
import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

/**
 * Projects of the active organization plus per-project activity, for the project
 * cards, the header breadcrumb and the command palette.
 *
 * Last event per project comes from W13's GET /api/v1/projects/last-events
 * (response { lastEvents: Record<projectId, ISO | null> }). Until the shared
 * client lands, `projectLastEventsAPI` below is a local stand-in with the same
 * signature; swap the import when W13 merges.
 */
export const projectLastEventsAPI = {
  async get(organizationId: string): Promise<{ lastEvents: Record<string, string | null> }> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');
    const response = await fetch(
      `${getApiBaseUrl()}/projects/last-events?organizationId=${encodeURIComponent(organizationId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error('Failed to fetch project last events');
    return response.json();
  },
};

export interface OrgProjectsState {
  orgId: string | null;
  projects: Project[];
  lastEventAt: Record<string, string | null>;
  receiving: Set<string>;
  loading: boolean;
  error: string | null;
}

function initial(): OrgProjectsState {
  return {
    orgId: null,
    projects: [],
    lastEventAt: {},
    receiving: new Set(),
    loading: false,
    error: null,
  };
}

function createOrgProjectsStore() {
  const state = writable<OrgProjectsState>(initial());
  // Monotonic token: only the latest load may write state.
  let loadId = 0;

  async function load(orgId: string): Promise<void> {
    const myId = ++loadId;
    state.update((s) => {
      // Switching organization: do not show the previous organization's projects.
      if (s.orgId !== orgId) {
        return { ...initial(), orgId, loading: true };
      }
      return { ...s, loading: true, error: null };
    });

    const [projectsResult, availabilityResult, lastEventsResult] = await Promise.allSettled([
      projectsAPI.getProjects(orgId),
      projectsAPI.getProjectDataAvailability(orgId),
      projectLastEventsAPI.get(orgId),
    ]);

    if (myId !== loadId) return; // stale: the organization changed or a newer load started

    state.update((s) => {
      const next: OrgProjectsState = { ...s, orgId, loading: false };

      if (projectsResult.status === 'fulfilled') {
        next.projects = projectsResult.value.projects;
        next.error = null;
      } else {
        // Keep the previous projects (if any) and surface the failure.
        next.error =
          projectsResult.reason instanceof Error
            ? projectsResult.reason.message
            : 'Failed to load projects';
      }

      if (availabilityResult.status === 'fulfilled') {
        const a = availabilityResult.value;
        next.receiving = new Set([...(a.logs ?? []), ...(a.traces ?? []), ...(a.metrics ?? [])]);
      }

      if (lastEventsResult.status === 'fulfilled') {
        next.lastEventAt = { ...(lastEventsResult.value.lastEvents ?? {}) };
      }

      return next;
    });
  }

  function reset() {
    loadId++;
    state.set(initial());
  }

  function projectName(id: string): string | null {
    const found = get(state).projects.find((p) => p.id === id);
    return found ? found.name : null;
  }

  return { subscribe: state.subscribe, load, reset, projectName };
}

export const orgProjectsStore = createOrgProjectsStore();
