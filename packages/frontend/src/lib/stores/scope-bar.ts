import { writable } from 'svelte/store';

/**
 * The project picker of the page's ScopeBar, if the page has one. The header
 * project switcher reads it to stay in sync: it rewrites the URL only when a
 * page picker will pick the change up, and offers "All projects" only where
 * the page accepts it.
 */
export interface ActiveScopeBar {
  mode: 'single' | 'multi';
}

export const activeScopeBar = writable<ActiveScopeBar | null>(null);
