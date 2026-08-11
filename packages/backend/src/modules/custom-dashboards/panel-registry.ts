// ============================================================================
// Panel Registry (backend)
// ============================================================================
//
// The backend registry's only job is to validate incoming panel configs at
// the API boundary. Each entry binds a PanelType to a Zod schema and a
// default layout. To add a new panel type:
//
//   1. Add the new type literal + interface to @logtide/shared/types/dashboard
//   2. Add an entry to `panelRegistry` here with its Zod schema
//   3. Add a fetcher in panel-data-service.ts
//   4. (frontend) add the component + config form + registry entry
//
// No other backend file needs to change.

import { z } from 'zod';
import type { PanelType, PanelConfig, PanelLayout } from '@logtide/shared';

const levelEnum = z.enum(['debug', 'info', 'warn', 'error', 'critical']);

const timeSeriesSchema = z.object({
  type: z.literal('time_series'),
  title: z.string().min(1).max(100),
  source: z.literal('logs'),
  projectId: z.string().uuid().nullable(),
  interval: z.enum(['1h', '6h', '24h', '7d', '30d']),
  levels: z.array(levelEnum).min(1),
  service: z.string().max(200).nullable(),
});

const singleStatSchema = z.object({
  type: z.literal('single_stat'),
  title: z.string().min(1).max(100),
  source: z.literal('logs'),
  metric: z.enum(['total_logs', 'error_rate', 'active_services', 'throughput']),
  projectId: z.string().uuid().nullable(),
  compareWithPrevious: z.boolean(),
});

const topNTableSchema = z.object({
  type: z.literal('top_n_table'),
  title: z.string().min(1).max(100),
  source: z.literal('logs'),
  dimension: z.enum(['service', 'error_message']),
  limit: z.number().int().min(3).max(20),
  projectId: z.string().uuid().nullable(),
  interval: z.enum(['1h', '24h', '7d']),
});

const liveLogStreamSchema = z.object({
  type: z.literal('live_log_stream'),
  title: z.string().min(1).max(100),
  source: z.literal('logs'),
  projectId: z.string().uuid().nullable(),
  service: z.string().max(200).nullable(),
  levels: z.array(levelEnum).min(1),
  maxRows: z.number().int().min(10).max(50),
});

const alertStatusSchema = z.object({
  type: z.literal('alert_status'),
  title: z.string().min(1).max(100),
  source: z.literal('alerts'),
  projectId: z.string().uuid().nullable(),
  ruleIds: z.array(z.string().uuid()),
  showHistory: z.boolean(),
  limit: z.number().int().min(3).max(20),
});

const metricAggregationEnum = z.enum([
  'avg',
  'sum',
  'min',
  'max',
  'count',
  'last',
  'p50',
  'p95',
  'p99',
]);
const metricIntervalEnum = z.enum(['1m', '5m', '15m', '1h', '6h', '1d']);

const metricChartSchema = z.object({
  type: z.literal('metric_chart'),
  title: z.string().min(1).max(100),
  source: z.literal('metrics'),
  projectId: z.string().uuid().nullable(),
  metricName: z.string().min(1).max(255),
  aggregation: metricAggregationEnum,
  interval: metricIntervalEnum,
  timeRange: z.enum(['1h', '6h', '24h', '7d', '30d']),
  serviceName: z.string().max(200).nullable(),
});

const metricStatSchema = z.object({
  type: z.literal('metric_stat'),
  title: z.string().min(1).max(100),
  source: z.literal('metrics'),
  projectId: z.string().uuid().nullable(),
  metricName: z.string().min(1).max(255),
  aggregation: metricAggregationEnum,
  timeRange: z.enum(['1h', '6h', '24h']),
  serviceName: z.string().max(200).nullable(),
  unit: z.string().max(20).nullable(),
});

const traceLatencySchema = z.object({
  type: z.literal('trace_latency'),
  title: z.string().min(1).max(100),
  source: z.literal('traces'),
  projectId: z.string().uuid().nullable(),
  serviceName: z.string().max(200).nullable(),
  timeRange: z.enum(['1h', '6h', '24h', '7d']),
  showPercentiles: z.array(z.enum(['p50', 'p95', 'p99'])).min(1),
});

const traceVolumeSchema = z.object({
  type: z.literal('trace_volume'),
  title: z.string().min(1).max(100),
  source: z.literal('traces'),
  projectId: z.string().uuid().nullable(),
  serviceName: z.string().max(200).nullable(),
  timeRange: z.enum(['1h', '6h', '24h', '7d']),
  showErrors: z.boolean(),
});

const detectionEventsSchema = z.object({
  type: z.literal('detection_events'),
  title: z.string().min(1).max(100),
  source: z.literal('detections'),
  projectId: z.string().uuid().nullable(),
  timeRange: z.enum(['24h', '7d', '30d']),
  severities: z
    .array(z.enum(['critical', 'high', 'medium', 'low', 'informational']))
    .min(1),
});

const monitorStatusSchema = z.object({
  type: z.literal('monitor_status'),
  title: z.string().min(1).max(100),
  source: z.literal('monitors'),
  projectId: z.string().uuid().nullable(),
  monitorIds: z.array(z.string().uuid()),
  limit: z.number().int().min(3).max(20),
});

const systemStatusSchema = z.object({
  type: z.literal('system_status'),
  title: z.string().min(1).max(100),
  source: z.literal('monitors'),
  projectId: z.string().uuid().nullable(),
  showCounts: z.boolean(),
});

const activityOverviewSeriesEnum = z.enum([
  'logs',
  'log_errors',
  'spans',
  'span_errors',
  'detections',
  'alerts',
]);

const activityOverviewSchema = z.object({
  type: z.literal('activity_overview'),
  title: z.string().min(1).max(100),
  source: z.literal('mixed'),
  projectId: z.string().uuid().nullable(),
  timeRange: z.enum(['24h', '7d', '30d']),
  series: z.array(activityOverviewSeriesEnum).min(1),
});

// fieldPrefix is interpolated into the metadata JSON key of the topValues SQL
// (via `metadata.${prefix}_country_code`). The charset here is the FIRST of two
// independent injection barriers; reservoir's validateFieldName is the second.
// No dots: a dot would let a prefix masquerade as a nested metadata path.
const geoMapSchema = z.object({
  type: z.literal('geo_map'),
  title: z.string().min(1).max(100),
  source: z.literal('logs'),
  projectId: z.string().uuid().nullable(),
  interval: z.enum(['1h', '24h', '7d']),
  mode: z.enum(['country', 'points']),
  limit: z.number().int().min(10).max(500),
  fieldPrefix: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/),
  levels: z.array(levelEnum),
  service: z.string().max(200).nullable(),
  hostname: z.string().max(200).nullable(),
});

const builtinLogColumnEnum = z.enum(['time', 'level', 'service', 'message']);

// Unlike geo_map's fieldPrefix, column paths are NEVER interpolated into SQL:
// the fetcher pulls whole rows via reservoir.query and resolves paths in
// memory. Bounds (count/length) are the only enforcement needed here.
const logTableBaseSchema = z.object({
  type: z.literal('log_table'),
  title: z.string().min(1).max(100),
  source: z.literal('logs'),
  projectId: z.string().uuid().nullable(),
  mode: z.enum(['snapshot', 'live']),
  timeRange: z.enum(['15m', '1h', '6h', '24h', '7d']),
  levels: z.array(levelEnum),
  service: z.string().max(200).nullable(),
  maxRows: z.number().int().min(10).max(100),
  columns: z.array(z.string().min(1).max(200)).max(10),
  builtinColumns: z.array(builtinLogColumnEnum),
  wrapCells: z.boolean(),
});

type LogTableShape = z.infer<typeof logTableBaseSchema>;

function refineLogTable(cfg: LogTableShape, ctx: z.RefinementCtx): void {
  if (cfg.mode === 'live' && cfg.projectId === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Live mode requires a specific project',
      path: ['projectId'],
    });
  }
  if (cfg.builtinColumns.length + cfg.columns.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one column (built-in or metadata) is required',
      path: ['columns'],
    });
  }
}

const logTableSchema = logTableBaseSchema.superRefine(refineLogTable);

// The union members must stay plain ZodObjects (discriminatedUnion cannot
// contain refined schemas), so log_table's cross-field rules are re-applied
// on top of the union.
export const panelConfigSchema = z
  .discriminatedUnion('type', [
    timeSeriesSchema,
    singleStatSchema,
    topNTableSchema,
    liveLogStreamSchema,
    alertStatusSchema,
    metricChartSchema,
    metricStatSchema,
    traceLatencySchema,
    traceVolumeSchema,
    detectionEventsSchema,
    monitorStatusSchema,
    systemStatusSchema,
    activityOverviewSchema,
    geoMapSchema,
    logTableBaseSchema,
  ])
  .superRefine((cfg, ctx) => {
    if (cfg.type === 'log_table') refineLogTable(cfg, ctx);
  });

export interface BackendPanelDefinition {
  readonly type: PanelType;
  readonly schema: z.ZodType<PanelConfig>;
  readonly defaultLayout: Pick<PanelLayout, 'w' | 'h'>;
}

export const panelRegistry: Record<PanelType, BackendPanelDefinition> = {
  time_series: {
    type: 'time_series',
    schema: timeSeriesSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 8, h: 3 },
  },
  single_stat: {
    type: 'single_stat',
    schema: singleStatSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 3, h: 2 },
  },
  top_n_table: {
    type: 'top_n_table',
    schema: topNTableSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 6, h: 3 },
  },
  live_log_stream: {
    type: 'live_log_stream',
    schema: liveLogStreamSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 6, h: 4 },
  },
  alert_status: {
    type: 'alert_status',
    schema: alertStatusSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 4, h: 3 },
  },
  metric_chart: {
    type: 'metric_chart',
    schema: metricChartSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 6, h: 4 },
  },
  metric_stat: {
    type: 'metric_stat',
    schema: metricStatSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 3, h: 2 },
  },
  trace_latency: {
    type: 'trace_latency',
    schema: traceLatencySchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 6, h: 4 },
  },
  trace_volume: {
    type: 'trace_volume',
    schema: traceVolumeSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 8, h: 3 },
  },
  detection_events: {
    type: 'detection_events',
    schema: detectionEventsSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 6, h: 4 },
  },
  monitor_status: {
    type: 'monitor_status',
    schema: monitorStatusSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 6, h: 3 },
  },
  system_status: {
    type: 'system_status',
    schema: systemStatusSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 12, h: 2 },
  },
  activity_overview: {
    type: 'activity_overview',
    schema: activityOverviewSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 12, h: 4 },
  },
  geo_map: {
    type: 'geo_map',
    schema: geoMapSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 6, h: 4 },
  },
  log_table: {
    type: 'log_table',
    schema: logTableSchema as unknown as z.ZodType<PanelConfig>,
    defaultLayout: { w: 12, h: 4 },
  },
};

const panelLayoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

export const panelInstanceSchema = z.object({
  id: z.string().min(1).max(64),
  layout: panelLayoutSchema,
  config: panelConfigSchema,
});

export const dashboardDocumentSchema = z.object({
  schema_version: z.number().int().min(1),
  panels: z.array(panelInstanceSchema),
});
