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

export const CURRENT_SCHEMA_VERSION = 1;

export type PanelType =
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

// ─── Layout (12-column grid) ────────────────────────────────────────────────

export interface PanelLayout {
  x: number; // 0–11
  y: number; // 0-based row index
  w: number; // 1–12 column span
  h: number; // row units (1 unit ≈ 80px)
}

// ─── Per-type panel configs ─────────────────────────────────────────────────

export type LogLevelKey = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface TimeSeriesConfig {
  type: 'time_series';
  title: string;
  source: 'logs';
  projectId: string | null; // null = org-wide
  interval: '1h' | '6h' | '24h' | '7d' | '30d';
  levels: LogLevelKey[];
  service: string | null;
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
  dimension: 'service' | 'error_message';
  limit: number; // 5–20
  projectId: string | null;
  interval: '1h' | '24h' | '7d';
}

export interface LiveLogStreamConfig {
  type: 'live_log_stream';
  title: string;
  source: 'logs';
  projectId: string | null;
  service: string | null;
  levels: LogLevelKey[];
  maxRows: number; // 10–50
}

export interface AlertStatusConfig {
  type: 'alert_status';
  title: string;
  source: 'alerts';
  projectId: string | null;
  ruleIds: string[]; // empty = show all rules in scope
  showHistory: boolean;
  limit: number; // 5–20
}

// ─── Metrics panels (OTLP) ───────────────────────────────────────────────────

export type MetricAggregation =
  | 'avg'
  | 'sum'
  | 'min'
  | 'max'
  | 'count'
  | 'last'
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
  timeRange: '1h' | '6h' | '24h' | '7d' | '30d';
  serviceName: string | null;
}

export interface MetricStatConfig {
  type: 'metric_stat';
  title: string;
  source: 'metrics';
  projectId: string | null;
  metricName: string;
  aggregation: MetricAggregation;
  timeRange: '1h' | '6h' | '24h';
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
  timeRange: '1h' | '6h' | '24h' | '7d';
  showPercentiles: Array<'p50' | 'p95' | 'p99'>;
}

// ─── Trace volume panel ──────────────────────────────────────────────────────

export interface TraceVolumeConfig {
  type: 'trace_volume';
  title: string;
  source: 'traces';
  projectId: string | null;
  serviceName: string | null;
  timeRange: '1h' | '6h' | '24h' | '7d';
  showErrors: boolean;
}

// ─── Detection events panel ──────────────────────────────────────────────────

export interface DetectionEventsConfig {
  type: 'detection_events';
  title: string;
  source: 'detections';
  projectId: string | null;
  timeRange: '24h' | '7d' | '30d';
  severities: Array<'critical' | 'high' | 'medium' | 'low' | 'informational'>;
}

// ─── Monitor status panel ────────────────────────────────────────────────────

export interface MonitorStatusConfig {
  type: 'monitor_status';
  title: string;
  source: 'monitors';
  projectId: string | null;
  monitorIds: string[]; // empty = show all monitors in scope
  limit: number; // 3–20
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
  timeRange: '24h' | '7d' | '30d';
  series: ActivityOverviewSeries[];
}

// ─── Geo map panel (GeoIP world map) ────────────────────────────────────────

export interface GeoMapConfig {
  type: 'geo_map';
  title: string;
  source: 'logs';
  projectId: string | null;
  interval: '1h' | '24h' | '7d';
  mode: 'country' | 'points';
  limit: number; // points mode top-N; 10-500
  fieldPrefix: string; // geoip step target, e.g. 'geo'; strict charset, no dots
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
  timeRange: '15m' | '1h' | '6h' | '24h' | '7d'; // snapshot mode only
  levels: LogLevelKey[]; // empty = all levels
  service: string | null;
  maxRows: number; // 10-100
  columns: string[]; // metadata paths (resolveMetadataPath semantics), max 10
  builtinColumns: BuiltinLogColumn[]; // built-ins to show; builtins+columns >= 1
  wrapCells: boolean; // wrap cell content instead of single-line ellipsis
}

export type PanelConfig =
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

export interface DashboardDocument {
  schema_version: number;
  panels: PanelInstance[];
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
  createdAt: string;
  updatedAt: string;
}
