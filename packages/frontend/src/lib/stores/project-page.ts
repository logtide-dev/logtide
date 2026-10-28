import { writable } from 'svelte/store';
import { projectsAPI, type ProjectSummary } from '$lib/api/projects';
import { projectHealthAPI, type ProjectHealth } from '$lib/api/project-health';

/**
 * Health and summary numbers of the project page being viewed. The project
 * layout loads it (header pill, tiles, nav badge) and the Health section reads
 * the same data, so the page costs one request per source. Each source fails
 * on its own: a failed summary leaves the tiles on `-`, a failed health call
 * leaves the pill empty and the section on an error line.
 */
export interface ProjectPageState {
  projectId: string | null;
  health: ProjectHealth | null;
  healthError: string | null;
  summary: ProjectSummary | null;
  loading: boolean;
}

function initial(): ProjectPageState {
  return { projectId: null, health: null, healthError: null, summary: null, loading: false };
}

function createProjectPageStore() {
  const state = writable<ProjectPageState>(initial());
  // Only the latest load may write state (project switches mid-flight).
  let loadId = 0;

  async function load(projectId: string): Promise<void> {
    const myId = ++loadId;
    state.set({ ...initial(), projectId, loading: true });

    const [health, summary] = await Promise.allSettled([
      projectHealthAPI.getProjectHealth(projectId),
      projectsAPI.getProjectSummary(projectId),
    ]);
    if (myId !== loadId) return;

    state.set({
      projectId,
      health: health.status === 'fulfilled' ? health.value : null,
      healthError:
        health.status === 'rejected'
          ? health.reason instanceof Error
            ? health.reason.message
            : 'Failed to fetch project health'
          : null,
      summary: summary.status === 'fulfilled' ? summary.value : null,
      loading: false,
    });
  }

  /** Re-read health only (after a mute change), keeping the tiles as they are. */
  async function reloadHealth(projectId: string): Promise<void> {
    try {
      const health = await projectHealthAPI.getProjectHealth(projectId);
      state.update((s) => (s.projectId === projectId ? { ...s, health, healthError: null } : s));
    } catch (e) {
      state.update((s) =>
        s.projectId === projectId
          ? { ...s, healthError: e instanceof Error ? e.message : 'Failed to fetch project health' }
          : s,
      );
    }
  }

  function reset() {
    loadId++;
    state.set(initial());
  }

  return { subscribe: state.subscribe, load, reloadHealth, reset };
}

export const projectPageStore = createProjectPageStore();
