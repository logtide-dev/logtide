import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { authStore } from './auth';
import { checklistStore } from './checklist';
import { OnboardingAPI, type OnboardingStep } from '$lib/api/onboarding';

export type { OnboardingStep } from '$lib/api/onboarding';

export const ONBOARDING_STEPS: OnboardingStep[] = ['verify-email', 'workspace', 'connect', 'done'];

export interface OnboardingState {
  step: OnboardingStep | null;
  organizationId: string | null;
  projectId: string | null;
  /** Name of the project created in this session, used to suggest a service name. Memory only. */
  projectName: string | null;
  /** The API key shown once. Memory only, never persisted. */
  apiKey: string | null;
  completed: boolean;
  skipped: boolean;
  loading: boolean;
  initialized: boolean;
}

/** Raw server shape handed to `decideEntry`. */
export interface ServerOnboarding {
  step: OnboardingStep | null;
  organizationId: string | null;
  projectId: string | null;
  completed: boolean;
  skipped: boolean;
}

const defaultState: OnboardingState = {
  step: null,
  organizationId: null,
  projectId: null,
  projectName: null,
  apiKey: null,
  completed: false,
  skipped: false,
  loading: false,
  initialized: false,
};

function createOnboardingStore() {
  const { subscribe, set, update } = writable<OnboardingState>({ ...defaultState });
  const api = new OnboardingAPI(() => get(authStore).token);
  let lastToken: string | null = null;

  /** Write the current position to the server. Failures are logged and never block the UI. */
  async function persist(extra: Record<string, unknown> = {}) {
    const s = get({ subscribe });
    const payload: Record<string, unknown> = { ...extra };
    if (s.step) {
      payload.step = s.step;
      payload.tutorialStep = ONBOARDING_STEPS.indexOf(s.step);
    }
    if (s.organizationId) payload.organizationId = s.organizationId;
    if (s.projectId) payload.projectId = s.projectId;
    try {
      await api.updateState(payload);
    } catch (error) {
      console.error('Failed to save onboarding state:', error);
    }
  }

  if (browser) {
    authStore.subscribe((state) => {
      if (state.token !== lastToken) {
        lastToken = state.token;
        if (!state.token) {
          set({ ...defaultState });
        }
      }
    });
  }

  return {
    subscribe,

    /** Fetch the server state, mirror it locally and return the raw shape. */
    load: async (): Promise<ServerOnboarding> => {
      update((s) => ({ ...s, loading: true }));
      try {
        const server = await api.getState();
        const raw: ServerOnboarding = {
          step: server.step ?? null,
          organizationId: server.organizationId ?? null,
          projectId: server.projectId ?? null,
          completed: server.tutorialCompleted,
          skipped: server.tutorialSkipped,
        };
        update((s) => ({
          ...s,
          ...raw,
          loading: false,
          initialized: true,
        }));
        return raw;
      } catch (error) {
        console.error('Failed to load onboarding state:', error);
        update((s) => ({ ...s, loading: false, initialized: true }));
        return { step: null, organizationId: null, projectId: null, completed: false, skipped: false };
      }
    },

    /** Set the local position without writing to the server (entry decision). */
    hydrate: (position: {
      step: OnboardingStep;
      organizationId: string | null;
      projectId: string | null;
    }) => {
      update((s) => ({ ...s, ...position }));
    },

    goToStep: async (step: OnboardingStep) => {
      update((s) => ({ ...s, step }));
      await persist();
    },

    /** Store the org (and project) as soon as they exist so a failure later resumes in the right place. */
    setWorkspace: async (workspace: {
      organizationId: string;
      projectId?: string;
      projectName?: string;
    }) => {
      update((s) => ({
        ...s,
        organizationId: workspace.organizationId,
        projectId: workspace.projectId ?? s.projectId,
        projectName: workspace.projectName ?? s.projectName,
      }));
      void checklistStore.completeItem('create-organization', false);
      if (workspace.projectId) {
        void checklistStore.completeItem('create-project', false);
      }
      await persist();
    },

    setApiKey: (apiKey: string | null) => {
      update((s) => ({ ...s, apiKey }));
      if (apiKey) {
        void checklistStore.completeItem('create-api-key', false);
      }
    },

    complete: async () => {
      update((s) => ({ ...s, step: 'done', completed: true }));
      await persist({ tutorialCompleted: true });
    },

    skip: async () => {
      update((s) => ({ ...s, skipped: true, completed: true }));
      await persist({ tutorialSkipped: true, tutorialCompleted: true });
    },

    reset: async () => {
      set({ ...defaultState, loading: true });
      try {
        await api.reset();
        const server = await api.getState();
        set({
          ...defaultState,
          step: server.step ?? null,
          organizationId: server.organizationId ?? null,
          projectId: server.projectId ?? null,
          completed: server.tutorialCompleted,
          skipped: server.tutorialSkipped,
          initialized: true,
        });
      } catch (error) {
        console.error('Failed to reset onboarding:', error);
        set({ ...defaultState, initialized: true });
      }
    },

    isInProgress: derived({ subscribe }, (s) => !s.skipped && !s.completed),
  };
}

export const onboardingStore = createOnboardingStore();

export const isOnboardingComplete = derived(
  onboardingStore,
  (s) => s.completed || s.skipped
);
