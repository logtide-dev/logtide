// ============================================================================
// Custom Dashboards Store
// ============================================================================
//
// Centralized state for the dashboard switcher, the active dashboard,
// per-panel data fetching, and inline edit mode.
//
// Patterned after lib/stores/siem.ts: a writable factory + derived stores.

import { writable, derived, get } from 'svelte/store';
import type {
  CustomDashboard,
  PanelInstance,
  PanelConfig,
  PanelLayout,
} from '@logtide/shared';
import { customDashboardsAPI } from '$lib/api/custom-dashboards';

export interface PanelDataEntry {
  data: unknown;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

interface DashboardStoreState {
  // Switcher list
  dashboards: CustomDashboard[];
  // Currently displayed dashboard
  activeDashboard: CustomDashboard | null;
  // Loading flags
  loadingList: boolean;
  loadingActive: boolean;
  saving: boolean;
  // Errors
  listError: string | null;
  activeError: string | null;
  saveError: string | null;
  // Per-panel data, keyed by panel.id
  panelData: Record<string, PanelDataEntry>;
  // Panels frozen by the user. Ephemeral: never saved with the dashboard,
  // never persisted, cleared when the active dashboard changes.
  pausedPanels: Set<string>;
  // Inline edit mode
  editMode: boolean;
  // Pending edit snapshot - null when not editing
  pendingPanels: PanelInstance[] | null;
  // Snapshot of original panels for cancel
  originalPanels: PanelInstance[] | null;
}

const initialState: DashboardStoreState = {
  dashboards: [],
  activeDashboard: null,
  loadingList: false,
  loadingActive: false,
  saving: false,
  listError: null,
  activeError: null,
  saveError: null,
  panelData: {},
  pausedPanels: new Set<string>(),
  editMode: false,
  pendingPanels: null,
  originalPanels: null,
};

function createDashboardStore() {
  const { subscribe, set, update } = writable<DashboardStoreState>(initialState);

  // Monotonic guard so a stale in-flight fetch cannot write into a
  // dashboard that has since been switched away from.
  let panelFetchSeq = 0;

  function getState(): DashboardStoreState {
    return get({ subscribe });
  }

  function setPanelData(panelId: string, entry: Partial<PanelDataEntry>): void {
    update((state) => {
      const previous = state.panelData[panelId] ?? {
        data: null,
        loading: false,
        error: null,
        lastFetchedAt: null,
      };
      return {
        ...state,
        panelData: {
          ...state.panelData,
          [panelId]: { ...previous, ...entry },
        },
      };
    });
  }

  return {
    subscribe,

    // ─── Loading ────────────────────────────────────────────────────────

    async loadDashboards(organizationId: string, projectId?: string | null): Promise<void> {
      update((s) => ({ ...s, loadingList: true, listError: null }));
      try {
        const dashboards = await customDashboardsAPI.list(organizationId, projectId);
        update((s) => ({ ...s, dashboards, loadingList: false }));
      } catch (e) {
        update((s) => ({
          ...s,
          loadingList: false,
          listError: e instanceof Error ? e.message : 'Failed to load dashboards',
        }));
      }
    },

    async loadDefault(organizationId: string): Promise<void> {
      update((s) => ({ ...s, loadingActive: true, activeError: null }));
      try {
        const dashboard = await customDashboardsAPI.getDefault(organizationId);
        update((s) => ({
          ...s,
          activeDashboard: dashboard,
          dashboards: mergeDashboardIntoList(s.dashboards, dashboard),
          loadingActive: false,
          pausedPanels: new Set<string>(),
        }));
        await this.fetchAllPanelData();
      } catch (e) {
        update((s) => ({
          ...s,
          loadingActive: false,
          activeError: e instanceof Error ? e.message : 'Failed to load dashboard',
        }));
      }
    },

    async switchTo(id: string): Promise<void> {
      const state = getState();
      const fromList = state.dashboards.find((d) => d.id === id);

      if (state.editMode) {
        // Don't allow switching mid-edit without explicit cancel
        return;
      }

      if (fromList) {
        update((s) => ({
          ...s,
          activeDashboard: fromList,
          panelData: {},
          pausedPanels: new Set<string>(),
          activeError: null,
        }));
        await this.fetchAllPanelData();
        return;
      }

      // Not in cache - fetch by id (need org context)
      const orgId = state.activeDashboard?.organizationId;
      if (!orgId) return;

      update((s) => ({ ...s, loadingActive: true, activeError: null }));
      try {
        const dashboard = await customDashboardsAPI.getById(id, orgId);
        update((s) => ({
          ...s,
          activeDashboard: dashboard,
          panelData: {},
          pausedPanels: new Set<string>(),
          loadingActive: false,
        }));
        await this.fetchAllPanelData();
      } catch (e) {
        update((s) => ({
          ...s,
          loadingActive: false,
          activeError: e instanceof Error ? e.message : 'Failed to load dashboard',
        }));
      }
    },

    // ─── Panel data ─────────────────────────────────────────────────────

    async fetchAllPanelData(): Promise<void> {
      const state = getState();
      const dashboard = state.activeDashboard;
      if (!dashboard || dashboard.panels.length === 0) return;

      // Paused panels are frozen: they are left out of the request and their
      // data entries are never touched by the batch. With every panel paused
      // there is nothing to ask for - and the API reads an empty id list as
      // "all panels", so the guard has to happen here.
      const targetPanels = dashboard.panels.filter((p) => !state.pausedPanels.has(p.id));
      if (targetPanels.length === 0) return;
      const targetIds = targetPanels.map((p) => p.id);
      const targetIdSet = new Set(targetIds);
      const somePaused = targetIds.length !== dashboard.panels.length;

      const fetchSeq = ++panelFetchSeq;
      const fetchedDashboardId = dashboard.id;

      // Mark the fetched panels as loading
      update((s) => {
        const next: Record<string, PanelDataEntry> = { ...s.panelData };
        for (const p of targetPanels) {
          next[p.id] = {
            data: next[p.id]?.data ?? null,
            loading: true,
            error: null,
            lastFetchedAt: next[p.id]?.lastFetchedAt ?? null,
          };
        }
        return { ...s, panelData: next };
      });

      try {
        const result = await customDashboardsAPI.fetchPanelData(
          dashboard.id,
          dashboard.organizationId,
          // Undefined keeps the "all panels" request the API already sends
          // when nothing is paused.
          somePaused ? targetIds : undefined
        );
        const now = Date.now();
        update((s) => {
          // Ignore the response if a newer fetch started or the active
          // dashboard changed while this request was in flight.
          if (fetchSeq !== panelFetchSeq || s.activeDashboard?.id !== fetchedDashboardId) {
            return s;
          }
          const next: Record<string, PanelDataEntry> = { ...s.panelData };
          for (const [panelId, entry] of Object.entries(result.panels)) {
            if (!targetIdSet.has(panelId)) continue;
            next[panelId] = {
              data: entry.data,
              loading: false,
              error: entry.error ?? null,
              lastFetchedAt: now,
            };
          }
          return { ...s, panelData: next };
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to load panel data';
        update((s) => {
          if (fetchSeq !== panelFetchSeq || s.activeDashboard?.id !== fetchedDashboardId) {
            return s;
          }
          const next: Record<string, PanelDataEntry> = { ...s.panelData };
          for (const p of targetPanels) {
            next[p.id] = {
              ...(next[p.id] ?? { data: null, lastFetchedAt: null }),
              loading: false,
              error: message,
            };
          }
          return { ...s, panelData: next };
        });
      }
    },

    async refreshPanel(panelId: string): Promise<void> {
      const state = getState();
      const dashboard = state.activeDashboard;
      if (!dashboard) return;

      setPanelData(panelId, { loading: true, error: null });

      try {
        const result = await customDashboardsAPI.fetchPanelData(
          dashboard.id,
          dashboard.organizationId,
          [panelId]
        );
        const entry = result.panels[panelId];
        if (entry) {
          setPanelData(panelId, {
            data: entry.data,
            loading: false,
            error: entry.error ?? null,
            lastFetchedAt: Date.now(),
          });
        }
      } catch (e) {
        setPanelData(panelId, {
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to refresh panel',
        });
      }
    },

    /**
     * Freeze / unfreeze a single panel. A paused panel is skipped by
     * `fetchAllPanelData` (auto-refresh and the `r` shortcut alike) but still
     * honours an explicit `refreshPanel` call.
     */
    togglePanelPause(panelId: string): void {
      update((s) => {
        const next = new Set(s.pausedPanels);
        if (next.has(panelId)) {
          next.delete(panelId);
        } else {
          next.add(panelId);
        }
        return { ...s, pausedPanels: next };
      });
    },

    // ─── Edit mode ──────────────────────────────────────────────────────

    enterEditMode(): void {
      update((s) => {
        if (!s.activeDashboard) return s;
        return {
          ...s,
          editMode: true,
          pendingPanels: [...s.activeDashboard.panels],
          originalPanels: [...s.activeDashboard.panels],
          saveError: null,
        };
      });
    },

    cancelEdit(): void {
      update((s) => ({
        ...s,
        editMode: false,
        pendingPanels: null,
        originalPanels: null,
        saveError: null,
      }));
    },

    setPendingPanels(panels: PanelInstance[]): void {
      update((s) => ({ ...s, pendingPanels: panels }));
    },

    addPanel(panel: PanelInstance): void {
      update((s) => ({
        ...s,
        pendingPanels: [...(s.pendingPanels ?? []), panel],
      }));
    },

    updatePanelConfig(panelId: string, config: PanelConfig): void {
      update((s) => ({
        ...s,
        pendingPanels: (s.pendingPanels ?? []).map((p) =>
          p.id === panelId ? { ...p, config } : p
        ),
      }));
    },

    updatePanelLayout(panelId: string, layout: PanelLayout): void {
      update((s) => ({
        ...s,
        pendingPanels: (s.pendingPanels ?? []).map((p) =>
          p.id === panelId ? { ...p, layout } : p
        ),
      }));
    },

    removePanel(panelId: string): void {
      update((s) => ({
        ...s,
        pendingPanels: (s.pendingPanels ?? []).filter((p) => p.id !== panelId),
      }));
    },

    async saveEdit(): Promise<void> {
      const state = getState();
      const dashboard = state.activeDashboard;
      const pending = state.pendingPanels;
      if (!dashboard || pending === null) return;

      update((s) => ({ ...s, saving: true, saveError: null }));

      try {
        const updated = await customDashboardsAPI.update(
          dashboard.id,
          dashboard.organizationId,
          { panels: pending }
        );
        update((s) => ({
          ...s,
          activeDashboard: updated,
          dashboards: mergeDashboardIntoList(s.dashboards, updated),
          editMode: false,
          pendingPanels: null,
          originalPanels: null,
          saving: false,
        }));
        await this.fetchAllPanelData();
      } catch (e) {
        update((s) => ({
          ...s,
          saving: false,
          saveError: e instanceof Error ? e.message : 'Failed to save dashboard',
        }));
      }
    },

    // ─── CRUD ───────────────────────────────────────────────────────────

    async createDashboard(input: {
      organizationId: string;
      name: string;
      description?: string;
      isPersonal?: boolean;
    }): Promise<CustomDashboard | null> {
      try {
        const dashboard = await customDashboardsAPI.create({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          isPersonal: input.isPersonal,
          panels: [],
        });
        update((s) => ({
          ...s,
          dashboards: mergeDashboardIntoList(s.dashboards, dashboard),
        }));
        return dashboard;
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to create dashboard',
        }));
        return null;
      }
    },

    async setAsDefault(id: string, organizationId: string): Promise<void> {
      try {
        const updated = await customDashboardsAPI.setAsDefault(id, organizationId);
        update((s) => ({
          ...s,
          dashboards: s.dashboards.map((d) => {
            if (d.id === updated.id) return updated;
            if (
              d.isDefault &&
              d.projectId === null &&
              !d.isPersonal &&
              d.id !== updated.id
            ) {
              return { ...d, isDefault: false };
            }
            return d;
          }),
          activeDashboard: (() => {
            const current = s.activeDashboard;
            if (!current) return current;
            if (current.id === updated.id) return updated;
            if (
              current.isDefault &&
              current.projectId === null &&
              !current.isPersonal
            ) {
              return { ...current, isDefault: false };
            }
            return current;
          })(),
        }));
      } catch (e) {
        update((s) => ({
          ...s,
          listError:
            e instanceof Error ? e.message : 'Failed to set default dashboard',
        }));
        throw e;
      }
    },

    async deleteDashboard(id: string, organizationId: string): Promise<void> {
      try {
        await customDashboardsAPI.delete(id, organizationId);
        update((s) => ({
          ...s,
          dashboards: s.dashboards.filter((d) => d.id !== id),
          // If we deleted the active dashboard, clear it - caller should reload default
          activeDashboard: s.activeDashboard?.id === id ? null : s.activeDashboard,
        }));
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to delete dashboard',
        }));
      }
    },

    async renameDashboard(
      id: string,
      organizationId: string,
      name: string
    ): Promise<void> {
      try {
        const updated = await customDashboardsAPI.update(id, organizationId, { name });
        update((s) => ({
          ...s,
          dashboards: mergeDashboardIntoList(s.dashboards, updated),
          activeDashboard:
            s.activeDashboard?.id === id ? updated : s.activeDashboard,
        }));
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to rename dashboard',
        }));
      }
    },

    // ─── YAML ───────────────────────────────────────────────────────────

    async exportYaml(id: string, organizationId: string): Promise<string | null> {
      try {
        return await customDashboardsAPI.exportYaml(id, organizationId);
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to export dashboard',
        }));
        return null;
      }
    },

    async importYaml(
      organizationId: string,
      yamlText: string
    ): Promise<CustomDashboard | null> {
      try {
        const dashboard = await customDashboardsAPI.importYaml(organizationId, yamlText);
        update((s) => ({
          ...s,
          dashboards: mergeDashboardIntoList(s.dashboards, dashboard),
        }));
        return dashboard;
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to import dashboard',
        }));
        return null;
      }
    },

    // ─── Cleanup ────────────────────────────────────────────────────────

    reset(): void {
      set(initialState);
    },
  };
}

function mergeDashboardIntoList(
  list: CustomDashboard[],
  dashboard: CustomDashboard
): CustomDashboard[] {
  const idx = list.findIndex((d) => d.id === dashboard.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = dashboard;
    return next;
  }
  return [...list, dashboard];
}

export const customDashboardsStore = createDashboardStore();

// ─── Derived selectors ──────────────────────────────────────────────────

export const dashboardList = derived(customDashboardsStore, (s) => s.dashboards);
export const activeDashboard = derived(customDashboardsStore, (s) => s.activeDashboard);
export const dashboardLoading = derived(customDashboardsStore, (s) => s.loadingActive);
export const dashboardError = derived(customDashboardsStore, (s) => s.activeError);
export const editMode = derived(customDashboardsStore, (s) => s.editMode);
export const pendingPanels = derived(customDashboardsStore, (s) => s.pendingPanels);
export const dashboardSaving = derived(customDashboardsStore, (s) => s.saving);
export const dashboardSaveError = derived(customDashboardsStore, (s) => s.saveError);
export const panelDataMap = derived(customDashboardsStore, (s) => s.panelData);
export const pausedPanelIds = derived(customDashboardsStore, (s) => s.pausedPanels);
