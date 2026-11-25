// ============================================================================
// Custom Dashboards - Shared Types
// ============================================================================
//
// This file is the canonical schema for dashboard configurations. It is
// imported by both backend (validation, persistence) and frontend (rendering,
// editing). The DashboardDocument JSON shape is stored verbatim in the
// `dashboards.panels` JSONB column.
//
// Versioning: every saved document carries a `schema_version` integer. When we
// add new panel types or change existing config shapes in a backwards-
// incompatible way, we bump CURRENT_SCHEMA_VERSION and add a migration
// function in dashboard-migrations.ts.

import type { MetricAttrRef, MetricExplorerQuery } from '../metrics/query.js';

/**
 * v2 (1.8): metric_chart and metric_stat become the `metrics` panel (the
 * explorer query model) and documents gain `variables`. The v1 types stay in
 * the unions so old documents can be read and migrated.
 */
export const CURRENT_SCHEMA_VERSION = 2;

export type PanelType =
  | 'metrics'
  | 'time_series'
  | 'single_stat'
  | 'top_n_table'
  | 'live_log_stream'
  | 'alert_status'
  | 'metric_chart'
  | 'metric_stat'
  | 'trace_latency'
  | 'trace_volume'
  | 'detection_events'
  | 'monitor_status'
  | 'system_status'
  | 'activity_overview'
  | 'geo_map'
  | 'log_table';

// ─── Time range presets ─────────────────────────────────────────────────────
//
// One catalog for every panel that scopes its query to a lookback window
// (issue #305). Widening this list is backwards compatible; narrowing it or
// renaming a key is a breaking change for stored dashboards and needs a
// schema_version bump + migration.

export const PANEL_TIME_RANGES = [
  '15m',
  '1h',
  '6h',
  '12h',
  '24h',
  '48h',
  '3d',
  '7d',
  '14d',
  '30d',
] as const;

export type PanelTimeRange = (typeof PANEL_TIME_RANGES)[number];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const PANEL_TIME_RANGE_MS: Record<PanelTimeRange, number> = {
  '15m': 15 * MINUTE_MS,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '12h': 12 * HOUR_MS,
  '24h': DAY_MS,
  '48h': 2 * DAY_MS,
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '14d': 14 * DAY_MS,
  '30d': 30 * DAY_MS,
};

export const PANEL_TIME_RANGE_LABELS: Record<PanelTimeRange, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '12h': 'Last 12 hours',
  '24h': 'Last 24 hours',
  '48h': 'Last 48 hours',
  '3d': 'Last 3 days',
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
};

/**
 * Window size in ms for a panel time range. Unknown strings fall back to 24h,
 * matching the historical behavior of the backend's timeRangeToMs helper so a
 * config written by a future version never crashes an older backend.
 */
export function panelTimeRangeToMs(range: string): number {
  return PANEL_TIME_RANGE_MS[range as PanelTimeRange] ?? PANEL_TIME_RANGE_MS['24h'];
}

// ─── Layout (12-column grid) ────────────────────────────────────────────────

export interface PanelLayout {
  x: number; // 0-11
  y: number; // 0-based row index
  w: number; // 1-12 column span
  h: number; // row units (1 unit ≈ 80px)
}

// ─── Per-type panel configs ─────────────────────────────────────────────────

export type LogLevelKey = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface TimeSeriesConfig {
  type: 'time_series';
  title: string;
  source: 'logs';
  projectId: string | null; // null = org-wide
  interval: PanelTimeRange;
  levels: LogLevelKey[];
  service: string | null;
  /** Optional per-level display labels for legend and tooltip; falls back to Debug/Info/Warn/Error/Critical */
  seriesLabels?: Partial<Record<LogLevelKey, string>>;
}

export interface SingleStatConfig {
  type: 'single_stat';
  title: string;
  source: 'logs';
  metric: 'total_logs' | 'error_rate' | 'active_services' | 'throughput';
  projectId: string | null;
  compareWithPrevious: boolean;
}

export interface TopNTableConfig {
  type: 'top_n_table';
  title: string;
  source: 'logs';
  dimension: 'service' | 'error_message' | 'metadata';
  /** required when dimension === 'metadata'; flat metadata key, no leading 'metadata.' */
  metadataField?: string | null;
  limit: number; // 3-50
  projectId: string | null;
  interval: PanelTimeRange;
  /** default false; honored for error_message and metadata dimensions */
  showLastSeen?: boolean;
  /** metadata dimension only; empty/absent = all levels */
  levels?: LogLevelKey[];
  /** metadata dimension only */
  service?: string | null;
}

export interface LiveLogStreamConfig {
  type: 'live_log_stream';
  title: string;
  source: 'logs';
  projectId: string | null;
  service: string | null;
  levels: LogLevelKey[];
  maxRows: number; // 10-100
}

export interface AlertStatusConfig {
  type: 'alert_status';
  title: string;
  source: 'alerts';
  projectId: string | null;
  ruleIds: string[]; // empty = show all rules in scope
  showHistory: boolean;
  limit: number; // 5-20
}

// ─── Metrics panels (OTLP) ───────────────────────────────────────────────────

export type MetricAggregation =
  | 'avg'
  | 'sum'
  | 'min'
  | 'max'
  | 'count'
  | 'last'
  | 'rate'
  | 'p50'
  | 'p95'
  | 'p99';

export type MetricInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';

export interface MetricChartConfig {
  type: 'metric_chart';
  title: string;
  source: 'metrics';
  projectId: string | null;
  metricName: string;
  aggregation: MetricAggregation;
  interval: MetricInterval;
  timeRange: PanelTimeRange;
  serviceName: string | null;
  /** optional, max 2 metric attribute keys; one series per label combination */
  groupBy?: string[];
}

export interface MetricStatConfig {
  type: 'metric_stat';
  title: string;
  source: 'metrics';
  projectId: string | null;
  metricName: string;
  aggregation: MetricAggregation;
  timeRange: PanelTimeRange;
  serviceName: string | null;
  unit: string | null;
}

// ─── Trace latency panel ─────────────────────────────────────────────────────

export interface TraceLatencyConfig {
  type: 'trace_latency';
  title: string;
  source: 'traces';
  projectId: string | null;
  serviceName: string | null;
  timeRange: PanelTimeRange;
  showPercentiles: Array<'p50' | 'p95' | 'p99'>;
}

// ─── Trace volume panel ──────────────────────────────────────────────────────

export interface TraceVolumeConfig {
  type: 'trace_volume';
  title: string;
  source: 'traces';
  projectId: string | null;
  serviceName: string | null;
  timeRange: PanelTimeRange;
  showErrors: boolean;
}

// ─── Detection events panel ──────────────────────────────────────────────────

export interface DetectionEventsConfig {
  type: 'detection_events';
  title: string;
  source: 'detections';
  projectId: string | null;
  timeRange: PanelTimeRange;
  severities: Array<'critical' | 'high' | 'medium' | 'low' | 'informational'>;
}

// ─── Monitor status panel ────────────────────────────────────────────────────

export interface MonitorStatusConfig {
  type: 'monitor_status';
  title: string;
  source: 'monitors';
  projectId: string | null;
  monitorIds: string[]; // empty = show all monitors in scope
  limit: number; // 3-20
}

// ─── System status banner ────────────────────────────────────────────────────

export interface SystemStatusConfig {
  type: 'system_status';
  title: string;
  source: 'monitors';
  projectId: string | null;
  showCounts: boolean;
}

// ─── Activity overview panel (logs + traces + detections + alerts) ──────────

export type ActivityOverviewSeries =
  | 'logs'
  | 'log_errors'
  | 'spans'
  | 'span_errors'
  | 'detections'
  | 'alerts';

export interface ActivityOverviewConfig {
  type: 'activity_overview';
  title: string;
  source: 'mixed';
  projectId: string | null;
  timeRange: PanelTimeRange;
  series: ActivityOverviewSeries[];
}

// ─── Geo map panel (GeoIP world map) ────────────────────────────────────────

export interface GeoMapConfig {
  type: 'geo_map';
  title: string;
  source: 'logs';
  projectId: string | null;
  interval: PanelTimeRange;
  mode: 'country' | 'points';
  limit: number; // points mode top-N; 10-500
  fieldPrefix: string; // geoip step target, e.g. 'geo'; strict charset, no dots
  /** Metadata key with the client IP, located at read time without GeoIP fields; null/absent = auto. */
  ipField?: string | null;
  levels: LogLevelKey[]; // empty = all levels
  service: string | null;
  hostname: string | null;
}

// ─── Log table panel (raw rows with metadata columns) ───────────────────────

export type BuiltinLogColumn = 'time' | 'level' | 'service' | 'message';

export interface LogTableConfig {
  type: 'log_table';
  title: string;
  source: 'logs';
  projectId: string | null; // null = org-wide; REQUIRED when mode === 'live'
  mode: 'snapshot' | 'live'; // live = per-project WebSocket tail
  timeRange: PanelTimeRange; // snapshot mode only
  levels: LogLevelKey[]; // empty = all levels
  service: string | null;
  maxRows: number; // 10-100
  columns: string[]; // metadata paths (resolveMetadataPath semantics), max 10
  builtinColumns: BuiltinLogColumn[]; // built-ins to show; builtins+columns >= 1
  wrapCells: boolean; // wrap cell content instead of single-line ellipsis
}

/**
 * 1.8 metrics panel: any explorer query (several metrics, formulas, group by,
 * resource filters, several projects) rendered as lines/area/bars/split/stat/table.
 * Replaces metric_chart and metric_stat (migrated by schema v2).
 */
export interface MetricsPanelConfig {
  type: 'metrics';
  title: string;
  source: 'metrics';
  query: MetricExplorerQuery;
  timeRange: PanelTimeRange;
}

export type PanelConfig =
  | MetricsPanelConfig
  | TimeSeriesConfig
  | SingleStatConfig
  | TopNTableConfig
  | LiveLogStreamConfig
  | AlertStatusConfig
  | MetricChartConfig
  | MetricStatConfig
  | TraceLatencyConfig
  | TraceVolumeConfig
  | DetectionEventsConfig
  | MonitorStatusConfig
  | SystemStatusConfig
  | ActivityOverviewConfig
  | GeoMapConfig
  | LogTableConfig;

// ─── Panel instance (layout + config) ───────────────────────────────────────

export interface PanelInstance {
  id: string; // stable uuid generated client-side
  layout: PanelLayout;
  config: PanelConfig;
}

// ─── Dashboard document (the JSON stored in DB) ─────────────────────────────

/**
 * Dashboard variable (1.8): a selector at the top of a dashboard, e.g. "host".
 * Metrics panel filters whose value is "$<name>" take the selected value;
 * with nothing selected (All) those filters are dropped.
 */
export interface DashboardVariable {
  /** /^[a-z][a-z0-9_]{0,31}$/, unique in the dashboard. */
  name: string;
  label: string;
  /** The attribute whose distinct values fill the selector. */
  attr: MetricAttrRef;
  /** Read values only from this metric (optional; resource scope may omit it). */
  metricName?: string | null;
  /** Initial selection; null = All. */
  default: string | null;
}

export const DASHBOARD_VARIABLE_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const DASHBOARD_MAX_VARIABLES = 5;

export interface DashboardDocument {
  schema_version: number;
  panels: PanelInstance[];
  /** v2+. Absent means none. */
  variables?: DashboardVariable[];
}

// ─── Dashboard DTO returned by the API ──────────────────────────────────────

export interface CustomDashboard {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  isDefault: boolean;
  isPersonal: boolean;
  createdBy: string | null;
  schemaVersion: number;
  panels: PanelInstance[];
  /** 1.8; [] when none. */
  variables: DashboardVariable[];
  createdAt: string;
  updatedAt: string;
}
