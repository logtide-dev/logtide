// ============================================================================
// Custom Dashboards - Frontend Panel Registry
// ============================================================================
//
// THE central file for adding a new panel type. Each entry binds:
//   - the panel's display name + icon
//   - its default layout & config
//   - the Svelte component that renders the panel
//   - the Svelte component that edits the panel's config
//
// To add a new panel type:
//   1. Add the type literal + interface to @logtide/shared/types/dashboard
//   2. Add a Zod schema in backend panel-registry.ts
//   3. Add a fetcher in backend panel-data-service.ts
//   4. Create panels/<NewType>Panel.svelte
//   5. Create config-forms/<NewType>ConfigForm.svelte
//   6. Add an entry below
//
// No other frontend file (renderer, container, store, route) needs to change.

import type { Component } from 'svelte';
import LineChart from '@lucide/svelte/icons/line-chart';
import Hash from '@lucide/svelte/icons/hash';
import List from '@lucide/svelte/icons/list';
import Radio from '@lucide/svelte/icons/radio';
import Bell from '@lucide/svelte/icons/bell';
import Activity from '@lucide/svelte/icons/activity';
import Gauge from '@lucide/svelte/icons/gauge';
import Network from '@lucide/svelte/icons/network';
import Waves from '@lucide/svelte/icons/waves';
import Shield from '@lucide/svelte/icons/shield';
import HeartPulse from '@lucide/svelte/icons/heart-pulse';
import CircleCheck from '@lucide/svelte/icons/circle-check';
import Layers from '@lucide/svelte/icons/layers';
import Globe from '@lucide/svelte/icons/globe';
import Table from '@lucide/svelte/icons/table';
import type {
  PanelType,
  PanelConfig,
  PanelLayout,
  PanelInstance,
  TimeSeriesConfig,
  SingleStatConfig,
  TopNTableConfig,
  LiveLogStreamConfig,
  AlertStatusConfig,
  MetricChartConfig,
  MetricStatConfig,
  TraceLatencyConfig,
  TraceVolumeConfig,
  DetectionEventsConfig,
  MonitorStatusConfig,
  SystemStatusConfig,
  ActivityOverviewConfig,
  GeoMapConfig,
  LogTableConfig,
} from '@logtide/shared';
import { uuid } from '$lib/utils/uuid';

import TimeSeriesPanel from './panels/TimeSeriesPanel.svelte';
import SingleStatPanel from './panels/SingleStatPanel.svelte';
import TopNTablePanel from './panels/TopNTablePanel.svelte';
import LiveLogStreamPanel from './panels/LiveLogStreamPanel.svelte';
import AlertStatusPanel from './panels/AlertStatusPanel.svelte';
import MetricChartPanel from './panels/MetricChartPanel.svelte';
import MetricStatPanel from './panels/MetricStatPanel.svelte';
import TraceLatencyPanel from './panels/TraceLatencyPanel.svelte';
import TraceVolumePanel from './panels/TraceVolumePanel.svelte';
import DetectionEventsPanel from './panels/DetectionEventsPanel.svelte';
import MonitorStatusPanel from './panels/MonitorStatusPanel.svelte';
import SystemStatusPanel from './panels/SystemStatusPanel.svelte';
import ActivityOverviewPanel from './panels/ActivityOverviewPanel.svelte';
import GeoMapPanel from './panels/GeoMapPanel.svelte';
import LogTablePanel from './panels/LogTablePanel.svelte';

import TimeSeriesConfigForm from './config-forms/TimeSeriesConfigForm.svelte';
import SingleStatConfigForm from './config-forms/SingleStatConfigForm.svelte';
import TopNTableConfigForm from './config-forms/TopNTableConfigForm.svelte';
import LiveLogStreamConfigForm from './config-forms/LiveLogStreamConfigForm.svelte';
import AlertStatusConfigForm from './config-forms/AlertStatusConfigForm.svelte';
import MetricChartConfigForm from './config-forms/MetricChartConfigForm.svelte';
import MetricStatConfigForm from './config-forms/MetricStatConfigForm.svelte';
import TraceLatencyConfigForm from './config-forms/TraceLatencyConfigForm.svelte';
import TraceVolumeConfigForm from './config-forms/TraceVolumeConfigForm.svelte';
import DetectionEventsConfigForm from './config-forms/DetectionEventsConfigForm.svelte';
import MonitorStatusConfigForm from './config-forms/MonitorStatusConfigForm.svelte';
import SystemStatusConfigForm from './config-forms/SystemStatusConfigForm.svelte';
import ActivityOverviewConfigForm from './config-forms/ActivityOverviewConfigForm.svelte';
import GeoMapConfigForm from './config-forms/GeoMapConfigForm.svelte';
import LogTableConfigForm from './config-forms/LogTableConfigForm.svelte';

export interface PanelComponentProps<TConfig extends PanelConfig = PanelConfig> {
  config: TConfig;
  data: unknown;
  loading: boolean;
  error: string | null;
}

export interface ConfigFormProps<TConfig extends PanelConfig = PanelConfig> {
  config: TConfig;
  onChange: (updated: TConfig) => void;
}

export interface FrontendPanelDefinition<
  TConfig extends PanelConfig = PanelConfig,
> {
  readonly type: PanelType;
  readonly label: string;
  readonly description: string;
  readonly icon: Component<{ class?: string }>;
  readonly defaultLayout: PanelLayout;
  readonly defaultConfig: TConfig;
  readonly component: Component<PanelComponentProps<TConfig>>;
  readonly configForm: Component<ConfigFormProps<TConfig>>;
  readonly minW: number;
  readonly minH: number;
}

const registry: Record<PanelType, FrontendPanelDefinition> = {
  time_series: {
    type: 'time_series',
    label: 'Time Series',
    description: 'Log volume over time, broken down by level.',
    icon: LineChart,
    defaultLayout: { x: 0, y: 0, w: 8, h: 3 },
    defaultConfig: {
      type: 'time_series',
      title: 'Log Volume',
      source: 'logs',
      projectId: null,
      interval: '24h',
      levels: ['info', 'warn', 'error', 'critical'],
      service: null,
    } as TimeSeriesConfig,
    component: TimeSeriesPanel as Component<PanelComponentProps>,
    configForm: TimeSeriesConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 2,
  },
  single_stat: {
    type: 'single_stat',
    label: 'Single Stat',
    description: 'A headline number with trend (e.g. error rate, throughput).',
    icon: Hash,
    defaultLayout: { x: 0, y: 0, w: 3, h: 2 },
    defaultConfig: {
      type: 'single_stat',
      title: 'Total Logs',
      source: 'logs',
      metric: 'total_logs',
      projectId: null,
      compareWithPrevious: true,
    } as SingleStatConfig,
    component: SingleStatPanel as Component<PanelComponentProps>,
    configForm: SingleStatConfigForm as Component<ConfigFormProps>,
    minW: 2,
    minH: 2,
  },
  top_n_table: {
    type: 'top_n_table',
    label: 'Top N Table',
    description: 'Ranked list (top services, top error messages, …).',
    icon: List,
    defaultLayout: { x: 0, y: 0, w: 6, h: 3 },
    defaultConfig: {
      type: 'top_n_table',
      title: 'Top Services',
      source: 'logs',
      dimension: 'service',
      limit: 5,
      projectId: null,
      interval: '24h',
    } as TopNTableConfig,
    component: TopNTablePanel as Component<PanelComponentProps>,
    configForm: TopNTableConfigForm as Component<ConfigFormProps>,
    minW: 3,
    minH: 2,
  },
  live_log_stream: {
    type: 'live_log_stream',
    label: 'Live Log Stream',
    description: 'A scrolling feed of recent logs.',
    icon: Radio,
    defaultLayout: { x: 0, y: 0, w: 6, h: 4 },
    defaultConfig: {
      type: 'live_log_stream',
      title: 'Recent Logs',
      source: 'logs',
      projectId: null,
      service: null,
      levels: ['info', 'warn', 'error', 'critical'],
      maxRows: 25,
    } as LiveLogStreamConfig,
    component: LiveLogStreamPanel as Component<PanelComponentProps>,
    configForm: LiveLogStreamConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 3,
  },
  alert_status: {
    type: 'alert_status',
    label: 'Alert Status',
    description: 'Status indicators for selected alert rules.',
    icon: Bell,
    defaultLayout: { x: 0, y: 0, w: 4, h: 3 },
    defaultConfig: {
      type: 'alert_status',
      title: 'Alerts',
      source: 'alerts',
      projectId: null,
      ruleIds: [],
      showHistory: true,
      limit: 5,
    } as AlertStatusConfig,
    component: AlertStatusPanel as Component<PanelComponentProps>,
    configForm: AlertStatusConfigForm as Component<ConfigFormProps>,
    minW: 3,
    minH: 2,
  },
  metric_chart: {
    type: 'metric_chart',
    label: 'Metric Chart',
    description: 'OTLP metric over time with aggregation (avg, p95, sum...).',
    icon: Activity,
    defaultLayout: { x: 0, y: 0, w: 6, h: 4 },
    defaultConfig: {
      type: 'metric_chart',
      title: 'Metric',
      source: 'metrics',
      projectId: null,
      metricName: '',
      aggregation: 'avg',
      interval: '5m',
      timeRange: '24h',
      serviceName: null,
    } as MetricChartConfig,
    component: MetricChartPanel as Component<PanelComponentProps>,
    configForm: MetricChartConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 3,
  },
  metric_stat: {
    type: 'metric_stat',
    label: 'Metric Stat',
    description: 'Single OTLP metric value with aggregation.',
    icon: Gauge,
    defaultLayout: { x: 0, y: 0, w: 3, h: 2 },
    defaultConfig: {
      type: 'metric_stat',
      title: 'Metric value',
      source: 'metrics',
      projectId: null,
      metricName: '',
      aggregation: 'last',
      timeRange: '1h',
      serviceName: null,
      unit: null,
    } as MetricStatConfig,
    component: MetricStatPanel as Component<PanelComponentProps>,
    configForm: MetricStatConfigForm as Component<ConfigFormProps>,
    minW: 2,
    minH: 2,
  },
  trace_latency: {
    type: 'trace_latency',
    label: 'Trace Latency',
    description: 'Span latency percentiles (p50/p95/p99) over time.',
    icon: Network,
    defaultLayout: { x: 0, y: 0, w: 6, h: 4 },
    defaultConfig: {
      type: 'trace_latency',
      title: 'Latency',
      source: 'traces',
      projectId: null,
      serviceName: null,
      timeRange: '24h',
      showPercentiles: ['p50', 'p95', 'p99'],
    } as TraceLatencyConfig,
    component: TraceLatencyPanel as Component<PanelComponentProps>,
    configForm: TraceLatencyConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 3,
  },
  trace_volume: {
    type: 'trace_volume',
    label: 'Trace Volume',
    description: 'Span count over time, with optional errors line.',
    icon: Waves,
    defaultLayout: { x: 0, y: 0, w: 8, h: 3 },
    defaultConfig: {
      type: 'trace_volume',
      title: 'Trace Volume',
      source: 'traces',
      projectId: null,
      serviceName: null,
      timeRange: '24h',
      showErrors: true,
    } as TraceVolumeConfig,
    component: TraceVolumePanel as Component<PanelComponentProps>,
    configForm: TraceVolumeConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 2,
  },
  detection_events: {
    type: 'detection_events',
    label: 'Detection Events',
    description: 'Sigma detection events over time, by severity.',
    icon: Shield,
    defaultLayout: { x: 0, y: 0, w: 6, h: 4 },
    defaultConfig: {
      type: 'detection_events',
      title: 'Detections',
      source: 'detections',
      projectId: null,
      timeRange: '24h',
      severities: ['critical', 'high', 'medium', 'low'],
    } as DetectionEventsConfig,
    component: DetectionEventsPanel as Component<PanelComponentProps>,
    configForm: DetectionEventsConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 3,
  },
  monitor_status: {
    type: 'monitor_status',
    label: 'Monitor Status',
    description: 'Uptime and current status of HTTP/heartbeat monitors.',
    icon: HeartPulse,
    defaultLayout: { x: 0, y: 0, w: 6, h: 3 },
    defaultConfig: {
      type: 'monitor_status',
      title: 'Monitors',
      source: 'monitors',
      projectId: null,
      monitorIds: [],
      limit: 5,
    } as MonitorStatusConfig,
    component: MonitorStatusPanel as Component<PanelComponentProps>,
    configForm: MonitorStatusConfigForm as Component<ConfigFormProps>,
    minW: 3,
    minH: 2,
  },
  system_status: {
    type: 'system_status',
    label: 'System Status',
    description: 'Aggregated banner: All systems operational / Degraded / Outage.',
    icon: CircleCheck,
    defaultLayout: { x: 0, y: 0, w: 12, h: 2 },
    defaultConfig: {
      type: 'system_status',
      title: 'System status',
      source: 'monitors',
      projectId: null,
      showCounts: true,
    } as SystemStatusConfig,
    component: SystemStatusPanel as Component<PanelComponentProps>,
    configForm: SystemStatusConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 2,
  },
  activity_overview: {
    type: 'activity_overview',
    label: 'Activity Overview',
    description: 'Logs, traces, detections and alerts on a single timeline.',
    icon: Layers,
    defaultLayout: { x: 0, y: 0, w: 12, h: 4 },
    defaultConfig: {
      type: 'activity_overview',
      title: 'Activity Overview',
      source: 'mixed',
      projectId: null,
      timeRange: '24h',
      series: ['logs', 'log_errors', 'spans', 'span_errors', 'detections', 'alerts'],
    } as ActivityOverviewConfig,
    component: ActivityOverviewPanel as Component<PanelComponentProps>,
    configForm: ActivityOverviewConfigForm as Component<ConfigFormProps>,
    minW: 6,
    minH: 3,
  },
  geo_map: {
    type: 'geo_map',
    label: 'Geo Map',
    description: 'World map of log volume from GeoIP metadata.',
    icon: Globe,
    defaultLayout: { x: 0, y: 0, w: 6, h: 4 },
    defaultConfig: {
      type: 'geo_map',
      title: 'Traffic Map',
      source: 'logs',
      projectId: null,
      interval: '24h',
      mode: 'country',
      limit: 100,
      fieldPrefix: 'geo',
      levels: [],
      service: null,
      hostname: null,
    } as GeoMapConfig,
    component: GeoMapPanel as Component<PanelComponentProps>,
    configForm: GeoMapConfigForm as Component<ConfigFormProps>,
    minW: 4,
    minH: 3,
  },
  log_table: {
    type: 'log_table',
    label: 'Log Table',
    description: 'Individual log rows with configurable metadata columns.',
    icon: Table,
    defaultLayout: { x: 0, y: 0, w: 12, h: 4 },
    defaultConfig: {
      type: 'log_table',
      title: 'Log Table',
      source: 'logs',
      projectId: null,
      mode: 'snapshot',
      timeRange: '1h',
      levels: [],
      service: null,
      maxRows: 25,
      columns: [],
      builtinColumns: ['time', 'level', 'service', 'message'],
      wrapCells: false,
    } as LogTableConfig,
    component: LogTablePanel as Component<PanelComponentProps>,
    configForm: LogTableConfigForm as Component<ConfigFormProps>,
    minW: 6,
    minH: 3,
  },
};

export function getPanelDefinition(type: PanelType): FrontendPanelDefinition {
  const def = registry[type];
  if (!def) throw new Error(`Unknown panel type: ${type}`);
  return def;
}

export function getAllPanelDefinitions(): FrontendPanelDefinition[] {
  return Object.values(registry);
}

/**
 * Build a fresh PanelInstance for a given panel type, with its default config
 * and a generated id. The caller assigns the layout slot.
 */
export function createPanelInstance(type: PanelType): PanelInstance {
  const def = getPanelDefinition(type);
  return {
    id: `panel-${uuid()}`,
    layout: { ...def.defaultLayout },
    config: { ...def.defaultConfig },
  };
}
