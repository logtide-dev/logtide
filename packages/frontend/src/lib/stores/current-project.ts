import { derived } from 'svelte/store';
import { scopeStore } from './scope.js';

// Deprecated facade, removed in Wave D once pages adopt ScopeBar.
// The single "current project" is the first project of the shared scope, so
// unmigrated pages and ScopeBar pages agree on the selection. State and
// persistence live in scopeStore (key logtide_scope); this store no longer
// writes its old localStorage key.

const view = derived(scopeStore, ($scope): string | null => $scope.projectIds[0] ?? null);

export const currentProjectStore = {
  subscribe: view.subscribe,
  set: (projectId: string | null) => {
    scopeStore.setProjects(projectId ? [projectId] : []);
  },
  /** Current value without subscribing. */
  get: (): string | null => scopeStore.get().projectIds[0] ?? null,
};
