import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { matchesCombo, isTypingTarget } from '$lib/utils/keyboard';
import { layoutStore } from '$lib/stores/layout';
import { flatNavItems } from '$lib/nav/nav-items';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShortcutScope = 'global' | 'search' | 'dashboard' | 'traces';

export type ShortcutCategory = 'navigation' | 'actions' | 'search' | 'time';

export interface Shortcut {
  id: string;
  /** Key combo like 'mod+k', 'j', '/', or sequence 'g d' */
  combo: string;
  label: string;
  scope: ShortcutScope;
  category: ShortcutCategory;
  /** Handler - return true to preventDefault */
  action: () => void;
}

interface ShortcutsState {
  commandPaletteOpen: boolean;
  helpModalOpen: boolean;
  /** Currently active scope (in addition to 'global') */
  activeScope: ShortcutScope | null;
  /** For sequence shortcuts: stores the pending first key (e.g. 'g') */
  pendingKey: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HINT_STORAGE_KEY = 'logtide_shortcuts_hint_shown';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function createShortcutsStore() {
  const state = writable<ShortcutsState>({
    commandPaletteOpen: false,
    helpModalOpen: false,
    activeScope: null,
    pendingKey: null,
  });

  // All registered shortcuts (global + page-specific)
  const shortcuts = writable<Shortcut[]>([]);

  // Pending key timeout for sequence shortcuts
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------------
  // Derived stores
  // ---------------------------------------------------------------------------

  /** Active shortcuts = global + current scope */
  const active = derived([shortcuts, state], ([$shortcuts, $state]) => {
    return $shortcuts.filter(
      (s) => s.scope === 'global' || s.scope === $state.activeScope
    );
  });

  /** Active shortcuts grouped by category for the help modal (what works right now) */
  const grouped = derived(active, ($active) => {
    const groups: Record<string, Shortcut[]> = {};
    for (const s of $active) {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category].push(s);
    }
    return groups;
  });

  // ---------------------------------------------------------------------------
  // Methods
  // ---------------------------------------------------------------------------

  function register(shortcut: Shortcut | Shortcut[]) {
    const items = Array.isArray(shortcut) ? shortcut : [shortcut];
    shortcuts.update((list) => {
      const newList = [...list];
      for (const s of items) {
        // Replace existing with same id
        const idx = newList.findIndex((x) => x.id === s.id);
        if (idx >= 0) {
          newList[idx] = s;
        } else {
          newList.push(s);
        }
      }
      return newList;
    });
  }

  function unregister(id: string | string[]) {
    const ids = Array.isArray(id) ? id : [id];
    shortcuts.update((list) => list.filter((s) => !ids.includes(s.id)));
  }

  function unregisterScope(scope: ShortcutScope) {
    shortcuts.update((list) => list.filter((s) => s.scope !== scope));
  }

  function setScope(scope: ShortcutScope | null) {
    state.update((s) => ({ ...s, activeScope: scope }));
  }

  function openCommandPalette() {
    state.update((s) => ({ ...s, commandPaletteOpen: true }));
  }

  function closeCommandPalette() {
    state.update((s) => ({ ...s, commandPaletteOpen: false }));
  }

  function openHelpModal() {
    state.update((s) => ({ ...s, helpModalOpen: true }));
  }

  function closeHelpModal() {
    state.update((s) => ({ ...s, helpModalOpen: false }));
  }

  function hasShownHint(): boolean {
    if (!browser) return true;
    try {
      return localStorage.getItem(HINT_STORAGE_KEY) === 'true';
    } catch {
      return true;
    }
  }

  function markHintShown() {
    if (!browser) return;
    try {
      localStorage.setItem(HINT_STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Global keyboard handler
  // ---------------------------------------------------------------------------

  function handleKeyDown(event: KeyboardEvent) {
    const currentState = get(state);

    // Don't handle shortcuts when a modal from the shortcuts system is open
    // (command palette has its own key handling)
    if (currentState.commandPaletteOpen) return;

    // Get active shortcuts
    const activeShortcuts = get(active);

    const typing = isTypingTarget(event);

    // Handle pending sequence key (e.g., user pressed 'g', now waiting for second key)
    if (currentState.pendingKey) {
      const seqCombo = `${currentState.pendingKey} ${event.key.toLowerCase()}`;

      // Clear pending state
      if (pendingTimeout) clearTimeout(pendingTimeout);
      state.update((s) => ({ ...s, pendingKey: null }));

      // Find matching sequence shortcut
      const match = activeShortcuts.find((s) => s.combo === seqCombo);
      if (match) {
        event.preventDefault();
        match.action();
        return;
      }
      // No match for sequence - fall through to normal handling
    }

    // Check for sequence starters (shortcuts with spaces like "g d")
    if (!typing) {
      const key = event.key.toLowerCase();
      const hasSequence = activeShortcuts.some((s) => s.combo.startsWith(key + ' '));
      if (hasSequence && !event.ctrlKey && !event.metaKey && !event.altKey) {
        state.update((s) => ({ ...s, pendingKey: key }));
        // Auto-clear pending after 1 second
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(() => {
          state.update((s) => ({ ...s, pendingKey: null }));
        }, 1000);
        event.preventDefault();
        return;
      }
    }

    // Normal (non-sequence) shortcut matching
    for (const shortcut of activeShortcuts) {
      // Skip sequence shortcuts (they're handled above)
      if (shortcut.combo.includes(' ')) continue;

      // Single-key shortcuts (no modifier) should be ignored when typing
      const hasModifier = shortcut.combo.includes('+');
      if (!hasModifier && typing) continue;

      if (matchesCombo(event, shortcut.combo)) {
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Register global shortcuts
  // ---------------------------------------------------------------------------

  function navShortcuts(): Shortcut[] {
    return flatNavItems()
      .filter((item) => item.shortcut)
      .map((item) => ({
        id: `global:go-${item.id}`,
        combo: item.shortcut as string,
        label: `Go to ${item.label}`,
        scope: 'global' as const,
        category: 'navigation' as const,
        action: () => {
          goto(item.href);
        },
      }));
  }

  function registerGlobalShortcuts() {
    register([
      {
        id: 'global:command-palette',
        combo: 'mod+k',
        label: 'Open command palette',
        scope: 'global',
        category: 'actions',
        action: openCommandPalette,
      },
      {
        id: 'global:help',
        combo: '?',
        label: 'Show keyboard shortcuts',
        scope: 'global',
        category: 'actions',
        action: openHelpModal,
      },
      {
        id: 'global:search-focus',
        combo: 'mod+/',
        label: 'Go to Logs or focus the search box',
        scope: 'global',
        category: 'search',
        action: () => {
          // If already on search page, focus the input. Otherwise navigate.
          const searchInput = document.getElementById('search') as HTMLInputElement | null;
          if (searchInput) {
            searchInput.focus();
          } else {
            goto('/dashboard/logs');
          }
        },
      },
      {
        id: 'global:escape',
        combo: 'escape',
        label: 'Close modal / clear',
        scope: 'global',
        category: 'actions',
        action: () => {
          if (pendingTimeout) {
            clearTimeout(pendingTimeout);
            pendingTimeout = null;
          }
          state.update((s) => ({
            ...s,
            commandPaletteOpen: false,
            helpModalOpen: false,
            pendingKey: null,
          }));
        },
      },
      // Navigation sequences come from the nav definition (one source of truth)
      ...navShortcuts(),
      // UI toggles
      {
        id: 'global:toggle-sidebar',
        combo: 'mod+b',
        label: 'Toggle sidebar',
        scope: 'global',
        category: 'actions',
        action: () => layoutStore.toggleSidebar(),
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Install handler
  // ---------------------------------------------------------------------------

  let installed = false;

  function install() {
    if (!browser || installed) return;
    document.addEventListener('keydown', handleKeyDown);
    installed = true;
    registerGlobalShortcuts();
  }

  function uninstall() {
    if (!browser || !installed) return;
    document.removeEventListener('keydown', handleKeyDown);
    installed = false;
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
    state.update((st) => ({ ...st, pendingKey: null }));
    shortcuts.update((list) => list.filter((sc) => !sc.id.startsWith('global:')));
  }

  return {
    subscribe: state.subscribe,
    shortcuts,
    grouped,
    active,

    register,
    unregister,
    unregisterScope,
    setScope,

    openCommandPalette,
    closeCommandPalette,
    openHelpModal,
    closeHelpModal,

    hasShownHint,
    markHintShown,

    install,
    uninstall,
  };
}

export const shortcutsStore = createShortcutsStore();
