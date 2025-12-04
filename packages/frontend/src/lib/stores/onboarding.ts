import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { authStore } from './auth';
import { checklistStore } from './checklist';
import { OnboardingAPI, type OnboardingState as APIOnboardingState } from '$lib/api/onboarding';

// Map onboarding steps to checklist items
const STEP_TO_CHECKLIST: Record<string, string> = {
  'create-organization': 'create-organization',
  'create-project': 'create-project',
  'api-key': 'create-api-key'
};

export type OnboardingStep =
  | 'welcome'
  | 'create-organization'
  | 'create-project'
  | 'api-key'
  | 'first-log'
  | 'feature-tour'
  | 'completed';

export interface OnboardingState {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  skipped: boolean;
  skipAfterOrgCreation: boolean;
  organizationId: string | null;
  projectId: string | null;
  apiKey: string | null;
  firstLogReceived: boolean;
  startedAt: string | null;
  completedAt: string | null;
  loading: boolean;
  initialized: boolean;
}

const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'create-organization',
  'create-project',
  'api-key',
  'first-log',
  'feature-tour',
  'completed'
];

const defaultState: OnboardingState = {
  currentStep: 'welcome',
  completedSteps: [],
  skipped: false,
  skipAfterOrgCreation: false,
  organizationId: null,
  projectId: null,
  apiKey: null,
  firstLogReceived: false,
  startedAt: null,
  completedAt: null,
  loading: false,
  initialized: false
};

function createOnboardingStore() {
  const { subscribe, set, update } = writable<OnboardingState>(defaultState);

  let api: OnboardingAPI | null = null;
  let currentToken: string | null = null;

  async function loadFromServer() {
    if (!api) return;

    update(state => ({ ...state, loading: true }));

    try {
      const serverState = await api.getState();

      // Convert tutorial step number to step name
      const stepIndex = serverState.tutorialStep;
      const currentStep = stepIndex < STEP_ORDER.length ? STEP_ORDER[stepIndex] : 'completed';

      // Reconstruct completed steps from step index
      const completedSteps: OnboardingStep[] = [];
      for (let i = 0; i < stepIndex && i < STEP_ORDER.length - 1; i++) {
        completedSteps.push(STEP_ORDER[i]);
      }

      update(state => ({
        ...state,
        currentStep: serverState.tutorialCompleted ? 'completed' : currentStep,
        completedSteps,
        skipped: serverState.tutorialSkipped,
        completedAt: serverState.tutorialCompleted ? new Date().toISOString() : null,
        loading: false,
        initialized: true
      }));
    } catch (error) {
      console.error('Failed to load onboarding state from server:', error);
      update(state => ({ ...state, loading: false, initialized: true }));
    }
  }

  async function saveToServer(stepIndex: number, completed: boolean, skipped: boolean) {
    if (!api) return;

    try {
      await api.updateState({
        tutorialStep: stepIndex,
        tutorialCompleted: completed,
        tutorialSkipped: skipped
      });
    } catch (error) {
      console.error('Failed to save onboarding state to server:', error);
    }
  }

  // Subscribe to auth changes to update API instance
  if (browser) {
    authStore.subscribe(state => {
      if (state.token !== currentToken) {
        currentToken = state.token;
        if (state.token) {
          api = new OnboardingAPI(() => state.token);
          // Load state from server when authenticated
          loadFromServer();
        } else {
          api = null;
          // Reset to default state when logged out
          set(defaultState);
        }
      }
    });
  }

  return {
    subscribe,

    /**
     * Start the onboarding tutorial
     */
    start: async () => {
      update(state => ({
        ...state,
        currentStep: 'welcome',
        startedAt: new Date().toISOString(),
        skipped: false
      }));
      await saveToServer(0, false, false);
    },

    /**
     * Move to the next step
     */
    nextStep: async () => {
      let newStepIndex = 0;
      let isCompleted = false;

      update(state => {
        const currentIndex = STEP_ORDER.indexOf(state.currentStep);
        const nextIndex = currentIndex + 1;
        newStepIndex = nextIndex;

        if (nextIndex >= STEP_ORDER.length) {
          isCompleted = true;
          return {
            ...state,
            currentStep: 'completed',
            completedSteps: [...state.completedSteps, state.currentStep],
            completedAt: new Date().toISOString()
          };
        }

        return {
          ...state,
          currentStep: STEP_ORDER[nextIndex],
          completedSteps: [...state.completedSteps, state.currentStep]
        };
      });

      await saveToServer(newStepIndex, isCompleted, false);
    },

    /**
     * Go to a specific step
     */
    goToStep: async (step: OnboardingStep) => {
      const stepIndex = STEP_ORDER.indexOf(step);
      update(state => ({
        ...state,
        currentStep: step
      }));
      await saveToServer(stepIndex, step === 'completed', false);
    },

    /**
     * Mark current step as completed and optionally move to next
     */
    completeStep: async (step: OnboardingStep, moveToNext = true) => {
      let newStepIndex = 0;
      let isCompleted = false;

      update(state => {
        const newCompletedSteps = state.completedSteps.includes(step)
          ? state.completedSteps
          : [...state.completedSteps, step];

        // Also update the checklist if there's a corresponding item
        // Don't show confetti during onboarding flow
        const checklistItemId = STEP_TO_CHECKLIST[step];
        if (checklistItemId) {
          checklistStore.completeItem(checklistItemId, false);
        }

        if (!moveToNext) {
          newStepIndex = STEP_ORDER.indexOf(step);
          return { ...state, completedSteps: newCompletedSteps };
        }

        const currentIndex = STEP_ORDER.indexOf(step);
        const nextStep = STEP_ORDER[currentIndex + 1] || 'completed';
        newStepIndex = currentIndex + 1;
        isCompleted = nextStep === 'completed';

        return {
          ...state,
          currentStep: nextStep,
          completedSteps: newCompletedSteps,
          completedAt: isCompleted ? new Date().toISOString() : state.completedAt
        };
      });

      await saveToServer(newStepIndex, isCompleted, false);
    },

    /**
     * Skip the entire tutorial
     */
    skip: async () => {
      update(state => ({
        ...state,
        skipped: true,
        currentStep: 'completed',
        completedAt: new Date().toISOString()
      }));
      await saveToServer(STEP_ORDER.length - 1, true, true);
    },

    /**
     * Save organization ID created during onboarding
     */
    setOrganizationId: (orgId: string) => {
      update(state => ({
        ...state,
        organizationId: orgId
      }));
    },

    /**
     * Save project ID created during onboarding
     */
    setProjectId: (projectId: string) => {
      update(state => ({
        ...state,
        projectId: projectId
      }));
    },

    /**
     * Save API key generated during onboarding
     */
    setApiKey: (apiKey: string) => {
      update(state => ({
        ...state,
        apiKey: apiKey
      }));
    },

    /**
     * Set flag to skip tutorial after org creation
     * (used when user clicks "skip" but still needs to create an org)
     */
    setSkipAfterOrgCreation: (skip: boolean) => {
      update(state => ({
        ...state,
        skipAfterOrgCreation: skip
      }));
    },

    /**
     * Mark that the first log was received
     */
    markFirstLogReceived: () => {
      update(state => ({
        ...state,
        firstLogReceived: true
      }));
    },

    /**
     * Reset the onboarding to start fresh
     */
    reset: async () => {
      set({ ...defaultState, loading: true });

      if (api) {
        try {
          await api.reset();
          await loadFromServer();
        } catch (error) {
          console.error('Failed to reset onboarding:', error);
          update(state => ({ ...state, loading: false }));
        }
      } else {
        set(defaultState);
      }
    },

    /**
     * Check if onboarding is in progress (not completed or skipped)
     */
    isInProgress: derived({ subscribe }, ($state) => {
      return !$state.skipped && $state.currentStep !== 'completed';
    }),

    /**
     * Check if a step has been completed
     */
    isStepCompleted: (step: OnboardingStep) => {
      const state = get({ subscribe });
      return state.completedSteps.includes(step);
    },

    /**
     * Get the step index for progress display
     */
    getStepIndex: (step: OnboardingStep) => {
      return STEP_ORDER.indexOf(step);
    },

    /**
     * Total number of steps (excluding 'completed')
     */
    totalSteps: STEP_ORDER.length - 1,

    /**
     * Step order for iteration
     */
    stepOrder: STEP_ORDER.filter(s => s !== 'completed')
  };
}

export const onboardingStore = createOnboardingStore();

// Derived stores for convenience
export const currentStep = derived(onboardingStore, $state => $state.currentStep);
export const isOnboardingComplete = derived(
  onboardingStore,
  $state => $state.currentStep === 'completed' || $state.skipped
);
export const onboardingProgress = derived(onboardingStore, $state => {
  const totalSteps = 6; // All steps except 'completed'
  const completedCount = $state.completedSteps.length;
  return Math.round((completedCount / totalSteps) * 100);
});
