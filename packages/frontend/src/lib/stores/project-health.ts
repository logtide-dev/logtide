import { writable } from 'svelte/store';
import {
  projectHealthAPI,
  type ProjectHealthSummaryEntry,
} from '$lib/api/project-health';

/**
 * Per-project health summary of the active organization (one batched request).
 * Polls every 5 minutes while at least one subscriber is attached, and drops the
 * previous organization's data on an org change, like orgProjectsStore.
 */
export interface ProjectHealthState {
  orgId: string | null;
  byProject: Record<string, ProjectHealthSummaryEntry>;
  loading: boolean;
}

export const PROJECT_HEALTH_POLL_MS = 5 * 60 * 1000;

function initial(): ProjectHealthState {
  return { orgId: null, byProject: {}, loading: false };
}

function createProjectHealthStore() {
  const state = writable<ProjectHealthState>(initial(), () => {
    // First subscriber attached: (re)start polling for the org we last loaded.
    active = true;
    startPolling();
    return () => {
      active = false;
      stopPolling();
    };
  });
  // Monotonic token: only the latest load may write state.
  let loadId = 0;
  let currentOrgId: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let active = false;

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function startPolling() {
    stopPolling();
    if (!currentOrgId) return;
    timer = setInterval(() => {
      if (currentOrgId) void load(currentOrgId);
    }, PROJECT_HEALTH_POLL_MS);
  }

  async function load(orgId: string): Promise<void> {
    const myId = ++loadId;
    currentOrgId = orgId;
    if (active && !timer) startPolling();

    state.update((s) =>
      s.orgId !== orgId ? { orgId, byProject: {}, loading: true } : { ...s, loading: true },
    );

    try {
      const res = await projectHealthAPI.getSummary(orgId);
      if (myId !== loadId) return;
      state.set({ orgId, byProject: res.projects ?? {}, loading: false });
    } catch {
      if (myId !== loadId) return;
      // Health is decoration: keep what we had and stop the spinner.
      state.update((s) => ({ ...s, loading: false }));
    }
  }

  function reset() {
    loadId++;
    currentOrgId = null;
    stopPolling();
    state.set(initial());
  }

  return { subscribe: state.subscribe, load, reset };
}

export const projectHealthStore = createProjectHealthStore();
