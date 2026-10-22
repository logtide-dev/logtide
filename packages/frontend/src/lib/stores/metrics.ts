import { writable, derived, get } from 'svelte/store';
import {
  metricsAPI,
  type MetricName,
  type MetricAggregateResult,
  type MetricDataResponse,
  type MetricsOverviewResult,
} from '$lib/api/metrics';
import {
  DEFAULT_QUERY,
  MAX_GROUP_BY,
  cloneQuery,
  type MetricQueryState,
} from '$lib/utils/metrics-query';

export interface MetricsContext {
  projectId: string | null;
  from: Date;
  to: Date;
}

export interface MetricsState {
  projectId: string | null;
  range: { from: Date; to: Date } | null;
  query: MetricQueryState;
  metricNames: MetricName[];
  metricNamesLoading: boolean;
  metricNamesError: string | null;
  timeseries: MetricAggregateResult | null;
  timeseriesLoading: boolean;
  timeseriesError: string | null;
  labelKeys: string[];
  labelValues: Record<string, string[]>;
  dataPoints: MetricDataResponse | null;
  dataPointsLoading: boolean;
  overview: MetricsOverviewResult | null;
  overviewLoading: boolean;
  overviewError: string | null;
  /** Service names seen in the overview; independent of the service filter. */
  services: string[];
  /** Sparkline series by `${metricName}:${serviceName}`. */
  sparklines: Record<string, MetricAggregateResult>;
  sparklinesLoading: string[];
}

function createInitialState(): MetricsState {
  return {
    projectId: null,
    range: null,
    query: cloneQuery(DEFAULT_QUERY),
    metricNames: [],
    metricNamesLoading: false,
    metricNamesError: null,
    timeseries: null,
    timeseriesLoading: false,
    timeseriesError: null,
    labelKeys: [],
    labelValues: {},
    dataPoints: null,
    dataPointsLoading: false,
    overview: null,
    overviewLoading: false,
    overviewError: null,
    services: [],
    sparklines: {},
    sparklinesLoading: [],
  };
}

function createMetricsStore() {
  const store = writable<MetricsState>(createInitialState());
  const { subscribe, set, update } = store;
  const read = () => get(store);

  // Monotonic tokens: a response is applied only if no newer request of the
  // same kind started (or the context changed) while it was in flight.
  const seq = { names: 0, ts: 0, overview: 0, labels: 0, data: 0, spark: 0 };

  // What the loaded data was fetched for, so switching tabs does not refetch.
  const loaded = { overview: '', timeseries: '', data: '' };

  function ctxKey(s: MetricsState): string {
    if (!s.projectId || !s.range) return '';
    return `${s.projectId}|${s.range.from.getTime()}|${s.range.to.getTime()}`;
  }

  function queryKey(s: MetricsState): string {
    const q = s.query;
    return JSON.stringify([ctxKey(s), q.metric, q.aggregation, q.where, q.groupBy, q.interval, q.service]);
  }

  function singleValueFilters(where: Record<string, string[]>): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(where)) if (v.length === 1) out[k] = v[0];
    return Object.keys(out).length > 0 ? out : undefined;
  }

  async function loadMetricNames() {
    const s = read();
    if (!s.projectId || !s.range) return;
    const token = ++seq.names;
    update((x) => ({ ...x, metricNamesLoading: true, metricNamesError: null }));
    try {
      const names = await metricsAPI.getMetricNames(
        s.projectId,
        s.range.from.toISOString(),
        s.range.to.toISOString()
      );
      if (token !== seq.names) return;
      update((x) => ({ ...x, metricNames: names, metricNamesLoading: false }));
    } catch (error) {
      if (token !== seq.names) return;
      update((x) => ({ ...x, metricNamesError: (error as Error).message, metricNamesLoading: false }));
    }
  }

  async function loadLabelKeys() {
    const s = read();
    if (!s.projectId || !s.range || !s.query.metric) return;
    const token = ++seq.labels;
    try {
      const keys = await metricsAPI.getLabelKeys(
        s.projectId,
        s.query.metric,
        s.range.from.toISOString(),
        s.range.to.toISOString()
      );
      if (token !== seq.labels) return;
      update((x) => ({ ...x, labelKeys: keys }));
    } catch {
      if (token !== seq.labels) return;
      update((x) => ({ ...x, labelKeys: [] }));
    }
  }

  async function loadLabelValues(labelKey: string): Promise<string[]> {
    const s = read();
    if (!s.projectId || !s.range || !s.query.metric) return [];
    const cached = s.labelValues[labelKey];
    if (cached) return cached;
    const { projectId, query } = s;
    try {
      const values = await metricsAPI.getLabelValues(
        projectId,
        query.metric!,
        labelKey,
        s.range.from.toISOString(),
        s.range.to.toISOString()
      );
      // Cache only when still on the same metric and project.
      const now = read();
      if (now.projectId === projectId && now.query.metric === query.metric) {
        update((x) => ({ ...x, labelValues: { ...x.labelValues, [labelKey]: values } }));
      }
      return values;
    } catch {
      return [];
    }
  }

  async function loadTimeseries() {
    const s = read();
    if (!s.projectId || !s.range || !s.query.metric) return;
    const q = s.query;
    const token = ++seq.ts;
    loaded.timeseries = queryKey(s);
    update((x) => ({ ...x, timeseriesLoading: true, timeseriesError: null }));
    try {
      const result = await metricsAPI.aggregateMetrics({
        projectId: s.projectId,
        metricName: q.metric!,
        from: s.range.from.toISOString(),
        to: s.range.to.toISOString(),
        interval: q.interval,
        aggregation: q.aggregation,
        groupBy: q.groupBy.length > 0 ? q.groupBy : undefined,
        attributes: Object.keys(q.where).length > 0 ? q.where : undefined,
        serviceName: q.service ?? undefined,
      });
      if (token !== seq.ts) return;
      update((x) => ({ ...x, timeseries: result, timeseriesLoading: false }));
    } catch (error) {
      if (token !== seq.ts) return;
      update((x) => ({ ...x, timeseriesError: (error as Error).message, timeseriesLoading: false }));
    }
  }

  async function loadDataPoints() {
    const s = read();
    if (!s.projectId || !s.range || !s.query.metric) return;
    const token = ++seq.data;
    loaded.data = queryKey(s);
    update((x) => ({ ...x, dataPointsLoading: true }));
    try {
      const result = await metricsAPI.getMetricData({
        projectId: s.projectId,
        metricName: s.query.metric,
        from: s.range.from.toISOString(),
        to: s.range.to.toISOString(),
        includeExemplars: true,
        attributes: singleValueFilters(s.query.where),
        limit: 100,
      });
      if (token !== seq.data) return;
      update((x) => ({ ...x, dataPoints: result, dataPointsLoading: false }));
    } catch {
      if (token !== seq.data) return;
      update((x) => ({ ...x, dataPointsLoading: false }));
    }
  }

  /** Sparklines for the metrics visible under the current service filter. */
  async function loadSparklines() {
    const s = read();
    if (!s.projectId || !s.range || !s.overview) return;
    const { projectId, range } = s;
    const token = seq.spark;
    const wanted = s.overview.services
      .filter((svc) => !s.query.service || svc.serviceName === s.query.service)
      .flatMap((svc) => svc.metrics);

    await Promise.all(
      wanted.map(async (metric) => {
        const key = `${metric.metricName}:${metric.serviceName}`;
        const now = read();
        if (now.sparklines[key] || now.sparklinesLoading.includes(key)) return;
        update((x) => ({ ...x, sparklinesLoading: [...x.sparklinesLoading, key] }));
        try {
          const result = await metricsAPI.aggregateMetrics({
            projectId,
            metricName: metric.metricName,
            from: range.from.toISOString(),
            to: range.to.toISOString(),
            interval: 'auto',
            aggregation: 'avg',
            serviceName: metric.serviceName,
          });
          if (token !== seq.spark) return;
          update((x) => ({ ...x, sparklines: { ...x.sparklines, [key]: result } }));
        } catch {
          // a missing sparkline is not worth an error state
        } finally {
          if (token === seq.spark) {
            update((x) => ({ ...x, sparklinesLoading: x.sparklinesLoading.filter((k) => k !== key) }));
          }
        }
      })
    );
  }

  async function loadOverview() {
    const s = read();
    if (!s.projectId || !s.range) return;
    const token = ++seq.overview;
    loaded.overview = ctxKey(s);
    update((x) => ({ ...x, overviewLoading: true, overviewError: null }));
    try {
      // Always unfiltered: the service filter is applied on the client so the
      // service list stays complete and switching service needs no refetch.
      const result = await metricsAPI.getOverview({
        projectId: s.projectId,
        from: s.range.from.toISOString(),
        to: s.range.to.toISOString(),
      });
      if (token !== seq.overview) return;
      update((x) => ({
        ...x,
        overview: result,
        overviewLoading: false,
        services: [...new Set(result.services.map((svc) => svc.serviceName))].sort(),
      }));
      await loadSparklines();
    } catch (error) {
      if (token !== seq.overview) return;
      update((x) => ({ ...x, overviewError: (error as Error).message, overviewLoading: false }));
    }
  }

  /** Load whatever the active tab needs and has not loaded for this context. */
  function refresh() {
    const s = read();
    if (!s.projectId || !s.range) return;
    if (loaded.overview !== ctxKey(s)) void loadOverview();
    if (s.query.tab === 'explorer' && s.query.metric) {
      const key = queryKey(s);
      if (loaded.timeseries !== key) void loadTimeseries();
      if (loaded.data !== key) void loadDataPoints();
    }
  }

  function invalidateAll() {
    seq.names++;
    seq.ts++;
    seq.overview++;
    seq.labels++;
    seq.data++;
    seq.spark++;
    loaded.overview = '';
    loaded.timeseries = '';
    loaded.data = '';
  }

  const api = {
    subscribe,
    /** Current state, for non-reactive callers. */
    get: read,

    /**
     * Set the project and time bounds (from the scope). One reload of the
     * active tab's data when the project or either bound changed; an identical
     * context is a no-op.
     */
    setContext(ctx: MetricsContext) {
      const s = read();
      const sameProject = s.projectId === ctx.projectId;
      const sameRange =
        s.range !== null &&
        s.range.from.getTime() === ctx.from.getTime() &&
        s.range.to.getTime() === ctx.to.getTime();
      if (sameProject && sameRange) return;

      invalidateAll();
      update((x) => ({
        ...x,
        projectId: ctx.projectId,
        range: { from: ctx.from, to: ctx.to },
        timeseries: null,
        timeseriesLoading: false,
        dataPoints: null,
        dataPointsLoading: false,
        overview: sameProject ? x.overview : null,
        overviewLoading: false,
        services: sameProject ? x.services : [],
        sparklines: {},
        sparklinesLoading: [],
        labelKeys: sameProject ? x.labelKeys : [],
        labelValues: {},
        ...(sameProject ? {} : { metricNames: [], metricNamesError: null }),
      }));

      if (!ctx.projectId) return;
      void loadMetricNames();
      if (read().query.metric) void loadLabelKeys();
      refresh();
    },

    /** Patch the query. Reloads only what the patch affects. */
    setQuery(patch: Partial<MetricQueryState>) {
      const before = read().query;
      const next: MetricQueryState = { ...before, ...patch };
      next.groupBy = [...next.groupBy].slice(0, MAX_GROUP_BY);
      next.where = patch.where ?? before.where;

      const metricChanged = patch.metric !== undefined && patch.metric !== before.metric;
      if (metricChanged) {
        if (patch.where === undefined) next.where = {};
        if (patch.groupBy === undefined) next.groupBy = [];
      }

      update((x) => ({
        ...x,
        query: next,
        ...(metricChanged
          ? { timeseries: null, dataPoints: null, labelKeys: [], labelValues: {}, timeseriesError: null }
          : {}),
      }));

      if (metricChanged) {
        seq.labels++;
        if (next.metric) void loadLabelKeys();
      }
      if (patch.service !== undefined && patch.service !== before.service) void loadSparklines();
      refresh();
    },

    /** Select a metric: clears filters, group by and the previous result. */
    selectMetric(name: string | null) {
      api.setQuery({ metric: name, where: {}, groupBy: [] });
    },

    setGroupBy(keys: string[]) {
      api.setQuery({ groupBy: keys });
    },

    setLabelValues(key: string, values: string[]) {
      const where = { ...read().query.where };
      if (values.length === 0) delete where[key];
      else where[key] = values;
      api.setQuery({ where });
    },

    loadMetricNames,
    loadTimeseries,
    loadLabelValues,

    reset() {
      invalidateAll();
      set(createInitialState());
    },
  };
  return api;
}

export const metricsStore = createMetricsStore();
export const metricNames = derived({ subscribe: metricsStore.subscribe }, ($s) => $s.metricNames);
export const selectedMetric = derived({ subscribe: metricsStore.subscribe }, ($s) => $s.query.metric);
export const timeseries = derived({ subscribe: metricsStore.subscribe }, ($s) => $s.timeseries);
export const timeseriesLoading = derived({ subscribe: metricsStore.subscribe }, ($s) => $s.timeseriesLoading);
export const overview = derived({ subscribe: metricsStore.subscribe }, ($s) => $s.overview);
export const overviewLoading = derived({ subscribe: metricsStore.subscribe }, ($s) => $s.overviewLoading);
export const activeTab = derived({ subscribe: metricsStore.subscribe }, ($s) => $s.query.tab);
