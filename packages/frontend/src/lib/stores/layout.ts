import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export type ContentDensity = 'compact' | 'normal' | 'wide';

interface LayoutState {
  contentDensity: ContentDensity;
  sidebarVisible: boolean;
  terminalWrapEnabled: boolean;
}

const STORAGE_KEYS = {
  density: 'logtide_layout_density',
  sidebar: 'logtide_sidebar_visible',
  terminalWrap: 'logtide_terminal_wrap',
} as const;

const DEFAULTS: LayoutState = {
  contentDensity: 'compact',
  sidebarVisible: true,
  terminalWrapEnabled: true,
};

function loadInitialState(): LayoutState {
  if (!browser) return DEFAULTS;

  try {
    const density = localStorage.getItem(STORAGE_KEYS.density);
    const sidebar = localStorage.getItem(STORAGE_KEYS.sidebar);
    const terminalWrap = localStorage.getItem(STORAGE_KEYS.terminalWrap);

    return {
      contentDensity: (density === 'compact' || density === 'normal' || density === 'wide')
        ? density
        : DEFAULTS.contentDensity,
      sidebarVisible: sidebar !== null ? sidebar === 'true' : DEFAULTS.sidebarVisible,
      terminalWrapEnabled: terminalWrap !== null ? terminalWrap === 'true' : DEFAULTS.terminalWrapEnabled,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: LayoutState) {
  if (browser) {
    try {
      localStorage.setItem(STORAGE_KEYS.density, state.contentDensity);
      localStorage.setItem(STORAGE_KEYS.sidebar, String(state.sidebarVisible));
      localStorage.setItem(STORAGE_KEYS.terminalWrap, String(state.terminalWrapEnabled));
    } catch {
      // localStorage unavailable (incognito, etc.)
    }
  }
}

function createLayoutStore() {
  const initialState = loadInitialState();
  const { subscribe, set, update } = writable<LayoutState>(initialState);

  // Derived store for max-width class
  // compact: 1280px (max-w-7xl), normal: 1536px (max-w-screen-2xl), wide: full width
  const maxWidthClass = derived({ subscribe }, ($state) => {
    switch ($state.contentDensity) {
      case 'compact':
        return 'max-w-7xl';     // 1280px
      case 'normal':
        return 'max-w-screen-2xl'; // 1536px
      case 'wide':
        return 'max-w-full';    // full width
      default:
        return 'max-w-7xl';
    }
  });

  // Derived store for container padding
  const containerPadding = derived({ subscribe }, ($state) => {
    switch ($state.contentDensity) {
      case 'compact':
        return 'px-8 py-8';
      case 'normal':
        return 'px-6 py-6';
      case 'wide':
        return 'px-4 py-4';
      default:
        return 'px-8 py-8';
    }
  });

  return {
    subscribe,
    maxWidthClass,
    containerPadding,

    setContentDensity: (density: ContentDensity) => {
      update((state) => {
        const newState = { ...state, contentDensity: density };
        persist(newState);
        return newState;
      });
    },

    toggleSidebar: () => {
      update((state) => {
        const newState = { ...state, sidebarVisible: !state.sidebarVisible };
        persist(newState);
        return newState;
      });
    },

    setSidebarVisible: (visible: boolean) => {
      update((state) => {
        const newState = { ...state, sidebarVisible: visible };
        persist(newState);
        return newState;
      });
    },

    setTerminalWrap: (enabled: boolean) => {
      update((state) => {
        const newState = { ...state, terminalWrapEnabled: enabled };
        persist(newState);
        return newState;
      });
    },

    toggleTerminalWrap: () => {
      update((state) => {
        const newState = { ...state, terminalWrapEnabled: !state.terminalWrapEnabled };
        persist(newState);
        return newState;
      });
    },

    resetToDefaults: () => {
      set(DEFAULTS);
      persist(DEFAULTS);
    },
  };
}

export const layoutStore = createLayoutStore();
