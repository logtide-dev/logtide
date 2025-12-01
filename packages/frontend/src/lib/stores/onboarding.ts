import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

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
  organizationId: string | null;
  projectId: string | null;
  apiKey: string | null;
  firstLogReceived: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

const STORAGE_KEY = 'logward_onboarding';

const defaultState: OnboardingState = {
  currentStep: 'welcome',
  completedSteps: [],
  skipped: false,
  organizationId: null,
  projectId: null,
  apiKey: null,
  firstLogReceived: false,
  startedAt: null,
  completedAt: null
};

function loadFromStorage(): OnboardingState {
  if (!browser) return defaultState;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultState, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load onboarding state:', e);
  }

  return defaultState;
}

function saveToStorage(state: OnboardingState): void {
  if (!browser) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save onboarding state:', e);
  }
}

function createOnboardingStore() {
  const { subscribe, set, update } = writable<OnboardingState>(loadFromStorage());

  // Auto-save on changes
  subscribe((state) => {
    saveToStorage(state);
  });

  const STEP_ORDER: OnboardingStep[] = [
    'welcome',
    'create-organization',
    'create-project',
    'api-key',
    'first-log',
    'feature-tour',
    'completed'
  ];

  return {
    subscribe,

    /**
     * Start the onboarding tutorial
     */
    start: () => {
      update(state => ({
        ...state,
        currentStep: 'welcome',
        startedAt: new Date().toISOString(),
        skipped: false
      }));
    },

    /**
     * Move to the next step
     */
    nextStep: () => {
      update(state => {
        const currentIndex = STEP_ORDER.indexOf(state.currentStep);
        const nextIndex = currentIndex + 1;

        if (nextIndex >= STEP_ORDER.length) {
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
    },

    /**
     * Go to a specific step
     */
    goToStep: (step: OnboardingStep) => {
      update(state => ({
        ...state,
        currentStep: step
      }));
    },

    /**
     * Mark current step as completed and optionally move to next
     */
    completeStep: (step: OnboardingStep, moveToNext = true) => {
      update(state => {
        const newCompletedSteps = state.completedSteps.includes(step)
          ? state.completedSteps
          : [...state.completedSteps, step];

        if (!moveToNext) {
          return { ...state, completedSteps: newCompletedSteps };
        }

        const currentIndex = STEP_ORDER.indexOf(step);
        const nextStep = STEP_ORDER[currentIndex + 1] || 'completed';

        return {
          ...state,
          currentStep: nextStep,
          completedSteps: newCompletedSteps,
          completedAt: nextStep === 'completed' ? new Date().toISOString() : state.completedAt
        };
      });
    },

    /**
     * Skip the entire tutorial
     */
    skip: () => {
      update(state => ({
        ...state,
        skipped: true,
        currentStep: 'completed',
        completedAt: new Date().toISOString()
      }));
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
    reset: () => {
      set(defaultState);
      if (browser) {
        localStorage.removeItem(STORAGE_KEY);
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
