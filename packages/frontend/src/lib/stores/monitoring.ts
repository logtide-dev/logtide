import { writable, derived, get } from 'svelte/store';
import {
  listMonitors,
  getMonitor,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  getMonitorResults,
  getMonitorUptime,
  getMonitorUptimeSummary,
  getMonitorResponseTimes,
  getMonitorOutages,
  type Monitor,
  type MonitorResult,
  type UptimeBucket,
  type UptimeSummary,
  type ResponseTimePoint,
  type ResponseTimeRange,
  type MonitorOutage,
  type CreateMonitorInput,
  type UpdateMonitorInput,
} from '$lib/api/monitoring';

export interface MonitoringState {
  monitors: Monitor[];
  loading: boolean;
  error: string | null;
  selectedMonitor: Monitor | null;
  selectedMonitorResults: MonitorResult[];
  selectedMonitorUptime: UptimeBucket[];
  selectedMonitorSummary: UptimeSummary | null;
  selectedMonitorResponseTimes: ResponseTimePoint[];
  responseTimeRange: ResponseTimeRange;
  selectedMonitorOutages: MonitorOutage[];
  detailLoading: boolean;
  detailError: string | null;
}

const initialState: MonitoringState = {
  monitors: [],
  loading: false,
  error: null,
  selectedMonitor: null,
  selectedMonitorResults: [],
  selectedMonitorUptime: [],
  selectedMonitorSummary: null,
  selectedMonitorResponseTimes: [],
  responseTimeRange: '24h',
  selectedMonitorOutages: [],
  detailLoading: false,
  detailError: null,
};

function createMonitoringStore() {
  const { subscribe, set, update } = writable<MonitoringState>(initialState);

  let loadSeq = 0;
  let detailSeq = 0;
  let responseTimeSeq = 0;

  return {
    subscribe,

    async load(organizationId: string, projectId?: string): Promise<void> {
      const seq = ++loadSeq;
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const { monitors } = await listMonitors(organizationId, projectId);
        if (seq !== loadSeq) return;
        update((s) => ({ ...s, monitors, loading: false }));
      } catch (err) {
        if (seq !== loadSeq) return;
        update((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load monitors',
        }));
      }
    },

    async loadDetail(id: string, organizationId: string): Promise<void> {
      // Loading a monitor also cancels any range reload still in flight.
      const seq = ++detailSeq;
      responseTimeSeq++;
      const range = get({ subscribe }).responseTimeRange;
      update((s) => ({ ...s, detailLoading: true, detailError: null }));
      try {
        // The summary, chart and outages are supplementary: a failure there
        // leaves the section empty instead of failing the whole page.
        const [monitorRes, resultsRes, uptimeRes, summary, responseTimes, outages] = await Promise.all([
          getMonitor(id, organizationId),
          getMonitorResults(id, organizationId, 100),
          getMonitorUptime(id, organizationId, 90),
          getMonitorUptimeSummary(id, organizationId).catch(() => null),
          getMonitorResponseTimes(id, organizationId, range).catch(() => null),
          getMonitorOutages(id, organizationId).catch(() => null),
        ]);
        if (seq !== detailSeq) return;
        update((s) => ({
          ...s,
          selectedMonitor: monitorRes.monitor,
          selectedMonitorResults: resultsRes.results,
          selectedMonitorUptime: uptimeRes.history,
          selectedMonitorSummary: summary,
          selectedMonitorResponseTimes: responseTimes?.points ?? [],
          selectedMonitorOutages: outages?.outages ?? [],
          detailLoading: false,
        }));
      } catch (err) {
        if (seq !== detailSeq) return;
        update((s) => ({
          ...s,
          detailLoading: false,
          detailError: err instanceof Error ? err.message : 'Failed to load monitor',
        }));
      }
    },

    async loadResponseTimes(id: string, organizationId: string, range: ResponseTimeRange): Promise<void> {
      const seq = ++responseTimeSeq;
      update((s) => ({ ...s, responseTimeRange: range }));
      try {
        const res = await getMonitorResponseTimes(id, organizationId, range);
        if (seq !== responseTimeSeq) return;
        update((s) => ({ ...s, selectedMonitorResponseTimes: res.points }));
      } catch {
        if (seq !== responseTimeSeq) return;
        update((s) => ({ ...s, selectedMonitorResponseTimes: [] }));
      }
    },

    async create(input: CreateMonitorInput): Promise<Monitor> {
      const { monitor } = await createMonitor(input);
      update((s) => ({ ...s, monitors: [monitor, ...s.monitors] }));
      return monitor;
    },

    async update(id: string, organizationId: string, input: UpdateMonitorInput): Promise<Monitor> {
      const { monitor } = await updateMonitor(id, organizationId, input);
      update((s) => ({
        ...s,
        monitors: s.monitors.map((m) => (m.id === id ? monitor : m)),
        selectedMonitor: s.selectedMonitor?.id === id ? monitor : s.selectedMonitor,
      }));
      return monitor;
    },

    async delete(id: string, organizationId: string): Promise<void> {
      await deleteMonitor(id, organizationId);
      update((s) => ({
        ...s,
        monitors: s.monitors.filter((m) => m.id !== id),
      }));
    },

    clearDetail(): void {
      update((s) => ({
        ...s,
        selectedMonitor: null,
        selectedMonitorResults: [],
        selectedMonitorUptime: [],
        selectedMonitorSummary: null,
        selectedMonitorResponseTimes: [],
        selectedMonitorOutages: [],
        detailError: null,
      }));
    },

    clear(): void {
      set(initialState);
    },
  };
}

export const monitoringStore = createMonitoringStore();

export const monitors = derived(monitoringStore, ($s) => $s.monitors);
export const monitorsLoading = derived(monitoringStore, ($s) => $s.loading);
export const monitorsError = derived(monitoringStore, ($s) => $s.error);
export const selectedMonitor = derived(monitoringStore, ($s) => $s.selectedMonitor);
export const monitorResults = derived(monitoringStore, ($s) => $s.selectedMonitorResults);
export const monitorUptime = derived(monitoringStore, ($s) => $s.selectedMonitorUptime);
export const monitorSummary = derived(monitoringStore, ($s) => $s.selectedMonitorSummary);
export const monitorResponseTimes = derived(monitoringStore, ($s) => $s.selectedMonitorResponseTimes);
export const monitorResponseTimeRange = derived(monitoringStore, ($s) => $s.responseTimeRange);
export const monitorOutages = derived(monitoringStore, ($s) => $s.selectedMonitorOutages);
export const monitorDetailLoading = derived(monitoringStore, ($s) => $s.detailLoading);
export const monitorDetailError = derived(monitoringStore, ($s) => $s.detailError);
