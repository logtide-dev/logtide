import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { authStore } from './auth';
import { OnboardingAPI, type OnboardingState as APIOnboardingState } from '$lib/api/onboarding';
import confetti from 'canvas-confetti';

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  link?: string;
}

export interface ChecklistState {
  items: ChecklistItem[];
  collapsed: boolean;
  dismissed: boolean;
  loading: boolean;
  initialized: boolean;
}

const defaultItems: Omit<ChecklistItem, 'completed'>[] = [
  {
    id: 'create-organization',
    label: 'Create organization',
    description: 'Set up your workspace',
    link: '/onboarding'
  },
  {
    id: 'create-project',
    label: 'Create project',
    description: 'Organize your logs by app or environment',
    link: '/dashboard/projects'
  },
  {
    id: 'create-api-key',
    label: 'Create an API key',
    description: 'Generate credentials for log ingestion',
    link: '/dashboard/projects'
  },
  {
    id: 'create-alert',
    label: 'Create an alert',
    description: 'Get notified when issues occur',
    link: '/dashboard/alerts'
  },
  {
    id: 'try-live-tail',
    label: 'Try live tail',
    description: 'Watch logs in real-time',
    link: '/dashboard/logs?live=true'
  },
  {
    id: 'import-sigma-rule',
    label: 'Import Sigma rule',
    description: 'Detect security threats',
    link: '/dashboard/alerts'
  }
];

const defaultState: ChecklistState = {
  items: defaultItems.map(item => ({ ...item, completed: false })),
  collapsed: true,
  dismissed: false,
  loading: false,
  initialized: false
};

function createChecklistStore() {
  const { subscribe, set, update } = writable<ChecklistState>(defaultState);

  let api: OnboardingAPI | null = null;
  let currentToken: string | null = null;

  async function loadFromServer() {
    if (!api) return;

    update(state => ({ ...state, loading: true }));

    try {
      const serverState = await api.getState();
      update(state => ({
        ...state,
        items: defaultItems.map(item => ({
          ...item,
          completed: serverState.checklistItems[item.id] ?? false
        })),
        collapsed: serverState.checklistCollapsed,
        dismissed: serverState.checklistDismissed,
        loading: false,
        initialized: true
      }));
    } catch (error) {
      console.error('Failed to load checklist state from server:', error);
      update(state => ({ ...state, loading: false, initialized: true }));
    }
  }

  async function saveToServer(updates: Partial<APIOnboardingState>) {
    if (!api) return;

    try {
      await api.updateState(updates);
    } catch (error) {
      console.error('Failed to save checklist state to server:', error);
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
     * Initialize the store (call this on app load if user is authenticated)
     */
    initialize: () => {
      if (api) {
        loadFromServer();
      }
    },

    /**
     * Mark an item as completed
     * @param itemId - The ID of the item to complete
     * @param showConfetti - Whether to show confetti animation (default: true, set to false for onboarding flow)
     */
    completeItem: async (itemId: string, showConfetti = true) => {
      // Check if item was already completed
      let wasAlreadyCompleted = false;
      update(state => {
        const item = state.items.find(i => i.id === itemId);
        wasAlreadyCompleted = item?.completed ?? false;
        return {
          ...state,
          items: state.items.map(item =>
            item.id === itemId ? { ...item, completed: true } : item
          )
        };
      });

      // Show confetti only if item wasn't already completed and showConfetti is true
      if (browser && showConfetti && !wasAlreadyCompleted) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      }

      if (api) {
        try {
          await api.completeChecklistItem(itemId);
        } catch (error) {
          console.error('Failed to complete checklist item:', error);
        }
      }
    },

    /**
     * Mark an item as not completed
     */
    uncompleteItem: async (itemId: string) => {
      let newItems: Record<string, boolean> = {};

      update(state => {
        const updatedItems = state.items.map(item =>
          item.id === itemId ? { ...item, completed: false } : item
        );
        newItems = Object.fromEntries(updatedItems.map(i => [i.id, i.completed]));
        return { ...state, items: updatedItems };
      });

      await saveToServer({ checklistItems: newItems });
    },

    /**
     * Toggle collapsed state
     */
    toggleCollapsed: async () => {
      let newCollapsed = false;

      update(state => {
        newCollapsed = !state.collapsed;
        return { ...state, collapsed: newCollapsed };
      });

      await saveToServer({ checklistCollapsed: newCollapsed });
    },

    /**
     * Dismiss the checklist
     */
    dismiss: async () => {
      update(state => ({ ...state, dismissed: true }));
      await saveToServer({ checklistDismissed: true });
    },

    /**
     * Reset the checklist
     */
    reset: async () => {
      set({ ...defaultState, loading: true });

      if (api) {
        try {
          await api.reset();
          await loadFromServer();
        } catch (error) {
          console.error('Failed to reset checklist:', error);
          update(state => ({ ...state, loading: false }));
        }
      } else {
        set(defaultState);
      }
    },

    /**
     * Show the checklist again after dismissal
     */
    show: async () => {
      update(state => ({ ...state, dismissed: false }));
      await saveToServer({ checklistDismissed: false });
    }
  };
}

export const checklistStore = createChecklistStore();

// Derived stores for convenience
export const checklistProgress = derived(checklistStore, $state => {
  const completedCount = $state.items.filter(item => item.completed).length;
  const totalCount = $state.items.length;
  return Math.round((completedCount / totalCount) * 100);
});

export const isChecklistComplete = derived(checklistStore, $state => {
  return $state.items.every(item => item.completed);
});
