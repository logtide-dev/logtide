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
  DashboardVariable,
  PanelInstance,
  PanelConfig,
  PanelLayout,
  PanelTimeRange,
} from '@logtide/shared';
import { customDashboardsAPI } from '$lib/api/custom-dashboards';
import type { CreateFromTemplatePayload } from '$lib/api/custom-dashboards';

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
  // Dashboard-level time range override (#305). Ephemeral view state like
  // pausedPanels: overrides every window-scoped panel while active, never
  // saved with the dashboard, cleared when the active dashboard changes.
  timeRangeOverride: PanelTimeRange | null;
  // Inline edit mode
  editMode: boolean;
  // Current variable selections by name (null = All). Ephemeral view state
  // like the time range override: lives in the URL, never saved.
  variableValues: Record<string, string | null>;
  // Pending edit snapshot - null when not editing
  pendingPanels: PanelInstance[] | null;
  // Pending variables while editing - null when not editing
  pendingVariables: DashboardVariable[] | null;
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
  timeRangeOverride: null,
  editMode: false,
  variableValues: {},
  pendingPanels: null,
  pendingVariables: null,
  originalPanels: null,
};

/** Defaults of the dashboard variables, overlaid with the requested values for known names. */
export function resolveVariableValues(
  variables: DashboardVariable[] | undefined,
  requested: Record<string, string | null> = {}
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const v of variables ?? []) {
    out[v.name] = Object.prototype.hasOwnProperty.call(requested, v.name)
      ? requested[v.name]
      : v.default;
  }
  return out;
}

/** Variable selections sent to the batch endpoint; undefined when the dashboard has none. */
function variablesPayload(
  dashboard: CustomDashboard,
  values: Record<string, string | null>
): Record<string, string | null> | undefined {
  const vars = dashboard.variables ?? [];
  if (vars.length === 0) return undefined;
  const out: Record<string, string | null> = {};
  for (const v of vars) out[v.name] = values[v.name] ?? null;
  return out;
}

/** The 5th argument is only sent when the dashboard has variables. */
function fetchBatch(
  dashboard: CustomDashboard,
  panelIds: string[] | undefined,
  range: PanelTimeRange | undefined,
  values: Record<string, string | null>
) {
  const variables = variablesPayload(dashboard, values);
  return variables
    ? customDashboardsAPI.fetchPanelData(dashboard.id, dashboard.organizationId, panelIds, range, variables)
    : customDashboardsAPI.fetchPanelData(dashboard.id, dashboard.organizationId, panelIds, range);
}

function createDashboardStore() {
  const { subscribe, set, update } = writable<DashboardStoreState>(initialState);

  // Monotonic guard so a stale in-flight fetch cannot write into a
  // dashboard that has since been switched away from.
  let panelFetchSeq = 0;

  // Monotonic guard for "which dashboard is being activated": a slower earlier
  // switch / initialize must not overwrite the one the user asked for last.
  let activationSeq = 0;

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
      const seq = ++activationSeq;
      update((s) => ({ ...s, loadingActive: true, activeError: null }));
      try {
        const dashboard = await customDashboardsAPI.getDefault(organizationId);
        if (seq !== activationSeq) return;
        update((s) => ({
          ...s,
          activeDashboard: dashboard,
          dashboards: mergeDashboardIntoList(s.dashboards, dashboard),
          loadingActive: false,
          pausedPanels: new Set<string>(),
          timeRangeOverride: null,
          variableValues: resolveVariableValues(dashboard.variables),
        }));
        await this.fetchAllPanelData();
      } catch (e) {
        if (seq !== activationSeq) return;
        update((s) => ({
          ...s,
          loadingActive: false,
          activeError: e instanceof Error ? e.message : 'Failed to load dashboard',
        }));
      }
    },

    /**
     * Page entry point. Loads the switcher list, activates the requested
     * dashboard when it is visible to the user (else the org default) and
     * applies the requested time range BEFORE the first panel fetch, so there
     * is exactly one batch request. A missing, forbidden or failing `dashboardId`
     * falls back to the default silently: `fellBack` tells the page to clean
     * the URL, nothing is shown as an error.
     */
    async initialize(
      organizationId: string,
      opts: {
        dashboardId?: string | null;
        range?: PanelTimeRange | null;
        variables?: Record<string, string | null>;
      } = {}
    ): Promise<{ fellBack: boolean }> {
      const seq = ++activationSeq;
      const requestedId = opts.dashboardId ?? null;
      const range = opts.range ?? null;

      update((s) => ({
        ...s,
        loadingList: true,
        loadingActive: true,
        listError: null,
        activeError: null,
        editMode: false,
        pendingPanels: null,
        pendingVariables: null,
        originalPanels: null,
      }));

      let list: CustomDashboard[] = [];
      try {
        list = await customDashboardsAPI.list(organizationId);
      } catch (e) {
        if (seq !== activationSeq) return { fellBack: false };
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to load dashboards',
        }));
      }
      if (seq !== activationSeq) return { fellBack: false };
      update((s) => ({ ...s, dashboards: list, loadingList: false }));

      let target: CustomDashboard | null = null;
      let fellBack = false;
      if (requestedId) {
        target = list.find((d) => d.id === requestedId) ?? null;
        if (!target) {
          try {
            target = await customDashboardsAPI.getById(requestedId, organizationId);
          } catch {
            target = null;
          }
          if (seq !== activationSeq) return { fellBack: false };
          if (!target) fellBack = true;
        }
      }

      if (!target) {
        try {
          target = await customDashboardsAPI.getDefault(organizationId);
        } catch (e) {
          if (seq !== activationSeq) return { fellBack: false };
          update((s) => ({
            ...s,
            loadingActive: false,
            activeError: e instanceof Error ? e.message : 'Failed to load dashboard',
          }));
          return { fellBack };
        }
        if (seq !== activationSeq) return { fellBack: false };
      }

      const active = target;
      update((s) => ({
        ...s,
        activeDashboard: active,
        dashboards: mergeDashboardIntoList(s.dashboards, active),
        panelData: {},
        pausedPanels: new Set<string>(),
        timeRangeOverride: range,
        variableValues: resolveVariableValues(active.variables, opts.variables),
        loadingActive: false,
      }));
      await this.fetchAllPanelData();
      return { fellBack };
    },

    async switchTo(id: string): Promise<void> {
      const state = getState();
      const fromList = state.dashboards.find((d) => d.id === id);

      if (state.editMode) {
        // Don't allow switching mid-edit without explicit cancel
        return;
      }

      const seq = ++activationSeq;

      if (fromList) {
        update((s) => ({
          ...s,
          activeDashboard: fromList,
          loadingActive: false,
          panelData: {},
          pausedPanels: new Set<string>(),
          timeRangeOverride: null,
          variableValues: resolveVariableValues(fromList.variables),
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
        if (seq !== activationSeq) return;
        update((s) => ({
          ...s,
          activeDashboard: dashboard,
          panelData: {},
          pausedPanels: new Set<string>(),
          timeRangeOverride: null,
          variableValues: resolveVariableValues(dashboard.variables),
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
        const result = await fetchBatch(
          dashboard,
          // Undefined keeps the "all panels" request the API already sends
          // when nothing is paused.
          somePaused ? targetIds : undefined,
          state.timeRangeOverride ?? undefined,
          state.variableValues
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
        const result = await fetchBatch(
          dashboard,
          [panelId],
          // A manual refresh must not silently revert one panel to its
          // configured window while the dashboard override is active.
          state.timeRangeOverride ?? undefined,
          state.variableValues
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

    /**
     * Set (or clear with null) the dashboard-level time range override and
     * refetch every non-paused panel with it. View state only: nothing is
     * saved to the dashboard.
     */
    async setTimeRangeOverride(range: PanelTimeRange | null): Promise<void> {
      update((s) => ({ ...s, timeRangeOverride: range }));
      await this.fetchAllPanelData();
    },

    /** Select a variable value (null = All) and refetch every non-paused panel. */
    async setVariable(name: string, value: string | null): Promise<void> {
      update((s) => ({ ...s, variableValues: { ...s.variableValues, [name]: value } }));
      await this.fetchAllPanelData();
    },

    // ─── Edit mode ──────────────────────────────────────────────────────

    enterEditMode(): void {
      update((s) => {
        if (!s.activeDashboard) return s;
        return {
          ...s,
          editMode: true,
          pendingPanels: [...s.activeDashboard.panels],
          pendingVariables: [...(s.activeDashboard.variables ?? [])],
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
        pendingVariables: null,
        originalPanels: null,
        saveError: null,
      }));
    },

    setPendingVariables(variables: DashboardVariable[]): void {
      update((s) => ({ ...s, pendingVariables: variables }));
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
      const pendingVars = state.pendingVariables;
      if (!dashboard || pending === null) return;

      update((s) => ({ ...s, saving: true, saveError: null }));

      try {
        const updated = await customDashboardsAPI.update(
          dashboard.id,
          dashboard.organizationId,
          { panels: pending, ...(pendingVars ? { variables: pendingVars } : {}) }
        );
        update((s) => ({
          ...s,
          activeDashboard: updated,
          dashboards: mergeDashboardIntoList(s.dashboards, updated),
          editMode: false,
          pendingPanels: null,
          pendingVariables: null,
          originalPanels: null,
          // Keep the selections that still match a variable, defaults for new ones.
          variableValues: resolveVariableValues(updated.variables, s.variableValues),
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

    /** Resolves true only when the server confirmed the delete. */
    async deleteDashboard(id: string, organizationId: string): Promise<boolean> {
      try {
        await customDashboardsAPI.delete(id, organizationId);
        update((s) => ({
          ...s,
          dashboards: s.dashboards.filter((d) => d.id !== id),
          // If we deleted the active dashboard, clear it - caller should reload default
          activeDashboard: s.activeDashboard?.id === id ? null : s.activeDashboard,
        }));
        return true;
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to delete dashboard',
        }));
        return false;
      }
    },

    async duplicateDashboard(
      id: string,
      organizationId: string,
      name?: string
    ): Promise<CustomDashboard | null> {
      try {
        const copy = await customDashboardsAPI.duplicate(id, organizationId, name);
        update((s) => ({ ...s, dashboards: mergeDashboardIntoList(s.dashboards, copy) }));
        return copy;
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to duplicate dashboard',
        }));
        return null;
      }
    },

    async createFromTemplate(input: CreateFromTemplatePayload): Promise<CustomDashboard | null> {
      try {
        const dashboard = await customDashboardsAPI.createFromTemplate(input);
        update((s) => ({
          ...s,
          dashboards: mergeDashboardIntoList(s.dashboards, dashboard),
        }));
        return dashboard;
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to create dashboard from template',
        }));
        return null;
      }
    },

    async renameDashboard(
      id: string,
      organizationId: string,
      name: string,
      description?: string | null
    ): Promise<boolean> {
      try {
        const updated = await customDashboardsAPI.update(id, organizationId, {
          name,
          ...(description !== undefined ? { description } : {}),
        });
        update((s) => ({
          ...s,
          dashboards: mergeDashboardIntoList(s.dashboards, updated),
          activeDashboard:
            s.activeDashboard?.id === id ? updated : s.activeDashboard,
        }));
        return true;
      } catch (e) {
        update((s) => ({
          ...s,
          listError: e instanceof Error ? e.message : 'Failed to rename dashboard',
        }));
        return false;
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
export const dashboardListError = derived(customDashboardsStore, (s) => s.listError);
export const editMode = derived(customDashboardsStore, (s) => s.editMode);
export const pendingPanels = derived(customDashboardsStore, (s) => s.pendingPanels);
export const variableValuesMap = derived(customDashboardsStore, (s) => s.variableValues);
/** Variables in force: the draft while editing, else the saved ones. */
export const dashboardVariables = derived(customDashboardsStore, (s): DashboardVariable[] =>
  s.editMode && s.pendingVariables !== null
    ? s.pendingVariables
    : (s.activeDashboard?.variables ?? [])
);
export const dashboardSaving = derived(customDashboardsStore, (s) => s.saving);
export const dashboardSaveError = derived(customDashboardsStore, (s) => s.saveError);
export const panelDataMap = derived(customDashboardsStore, (s) => s.panelData);
export const pausedPanelIds = derived(customDashboardsStore, (s) => s.pausedPanels);
export const timeRangeOverride = derived(customDashboardsStore, (s) => s.timeRangeOverride);
