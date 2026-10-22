// ============================================================================
// Dashboard starter templates
// ============================================================================
//
// Code-defined dashboard documents offered from the empty state and the
// dashboard menu. They are serialised to YAML and instantiated through the
// regular importYaml path, so validation, fresh panel ids and the limit check
// behave exactly like an import. Templates never replace the logs-only
// default dashboard.

import yaml from 'js-yaml';
import { CURRENT_SCHEMA_VERSION } from '@logtide/shared';
import type { PanelConfig, PanelInstance, PanelType } from '@logtide/shared';

export type DashboardTemplateId =
  | 'service-health'
  | 'errors-overview'
  | 'web-vitals'
  | 'security-overview';

export interface DashboardTemplateSummary {
  id: DashboardTemplateId;
  name: string;
  description: string;
  panelCount: number;
  panelTypes: PanelType[];
}

interface DashboardTemplate {
  id: DashboardTemplateId;
  name: string;
  description: string;
  panels: PanelInstance[];
}

const ALL_LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;

function panel(
  n: number,
  layout: { x: number; y: number; w: number; h: number },
  config: PanelConfig
): PanelInstance {
  return { id: `template-panel-${n}`, layout, config };
}

const TEMPLATES: DashboardTemplate[] = [
  {
    id: 'service-health',
    name: 'Service health',
    description: 'Log volume, latency, uptime and monitor status for your services.',
    panels: [
      panel(1, { x: 0, y: 0, w: 3, h: 2 }, {
        type: 'single_stat', title: 'Total logs', source: 'logs', metric: 'total_logs',
        projectId: null, compareWithPrevious: true,
      }),
      panel(2, { x: 3, y: 0, w: 3, h: 2 }, {
        type: 'single_stat', title: 'Error rate', source: 'logs', metric: 'error_rate',
        projectId: null, compareWithPrevious: true,
      }),
      panel(3, { x: 6, y: 0, w: 3, h: 2 }, {
        type: 'single_stat', title: 'Active services', source: 'logs', metric: 'active_services',
        projectId: null, compareWithPrevious: true,
      }),
      panel(4, { x: 9, y: 0, w: 3, h: 2 }, {
        type: 'single_stat', title: 'Throughput', source: 'logs', metric: 'throughput',
        projectId: null, compareWithPrevious: true,
      }),
      panel(5, { x: 0, y: 2, w: 8, h: 3 }, {
        type: 'time_series', title: 'Log volume', source: 'logs', projectId: null,
        interval: '24h', levels: [...ALL_LEVELS], service: null,
      }),
      panel(6, { x: 8, y: 2, w: 4, h: 3 }, {
        type: 'top_n_table', title: 'Top services', source: 'logs', dimension: 'service',
        limit: 10, projectId: null, interval: '24h',
      }),
      panel(7, { x: 0, y: 5, w: 6, h: 4 }, {
        type: 'trace_latency', title: 'Trace latency', source: 'traces', projectId: null,
        serviceName: null, timeRange: '24h', showPercentiles: ['p50', 'p95', 'p99'],
      }),
      panel(8, { x: 6, y: 5, w: 6, h: 4 }, {
        type: 'trace_volume', title: 'Trace volume', source: 'traces', projectId: null,
        serviceName: null, timeRange: '24h', showErrors: true,
      }),
      panel(9, { x: 0, y: 9, w: 12, h: 2 }, {
        type: 'system_status', title: 'System status', source: 'monitors', projectId: null,
        showCounts: true,
      }),
      panel(10, { x: 0, y: 11, w: 12, h: 3 }, {
        type: 'monitor_status', title: 'Monitors', source: 'monitors', projectId: null,
        monitorIds: [], limit: 10,
      }),
    ],
  },
  {
    id: 'errors-overview',
    name: 'Errors overview',
    description: 'Error rate, warnings, the most common error messages and recent alerts.',
    panels: [
      panel(1, { x: 0, y: 0, w: 3, h: 3 }, {
        type: 'single_stat', title: 'Error rate', source: 'logs', metric: 'error_rate',
        projectId: null, compareWithPrevious: true,
      }),
      panel(2, { x: 3, y: 0, w: 9, h: 3 }, {
        type: 'time_series', title: 'Warnings and errors', source: 'logs', projectId: null,
        interval: '24h', levels: ['warn', 'error', 'critical'], service: null,
      }),
      panel(3, { x: 0, y: 3, w: 6, h: 4 }, {
        type: 'top_n_table', title: 'Top error messages', source: 'logs',
        dimension: 'error_message', limit: 10, projectId: null, interval: '24h',
        showLastSeen: true,
      }),
      panel(4, { x: 6, y: 3, w: 6, h: 4 }, {
        type: 'live_log_stream', title: 'Latest errors', source: 'logs', projectId: null,
        service: null, levels: ['error', 'critical'], maxRows: 25,
      }),
      panel(5, { x: 0, y: 7, w: 12, h: 3 }, {
        type: 'alert_status', title: 'Recent alerts', source: 'alerts', projectId: null,
        ruleIds: [], showHistory: true, limit: 10,
      }),
    ],
  },
  {
    // Web vitals are logs with flat metadata keys (performance.metric,
    // performance.value, performance.rating) as written by the logtide-javascript
    // browser SDK. A p75 panel is out of scope until a dedicated panel type exists.
    id: 'web-vitals',
    name: 'Web vitals',
    description: 'Browser performance samples reported by the JavaScript SDK.',
    panels: [
      panel(1, { x: 0, y: 0, w: 6, h: 4 }, {
        type: 'top_n_table', title: 'Samples by metric', source: 'logs', dimension: 'metadata',
        metadataField: 'performance.metric', limit: 10, projectId: null, interval: '7d',
      }),
      panel(2, { x: 6, y: 0, w: 6, h: 4 }, {
        type: 'top_n_table', title: 'Ratings', source: 'logs', dimension: 'metadata',
        metadataField: 'performance.rating', limit: 3, projectId: null, interval: '7d',
      }),
      panel(3, { x: 0, y: 4, w: 12, h: 4 }, {
        type: 'trace_latency', title: 'Backend latency', source: 'traces', projectId: null,
        serviceName: null, timeRange: '7d', showPercentiles: ['p50', 'p95', 'p99'],
      }),
    ],
  },
  {
    id: 'security-overview',
    name: 'Security overview',
    description: 'Detection events by severity and recent security activity.',
    panels: [
      panel(1, { x: 0, y: 0, w: 12, h: 4 }, {
        type: 'detection_events', title: 'Detections', source: 'detections', projectId: null,
        timeRange: '7d', severities: ['critical', 'high', 'medium', 'low', 'informational'],
      }),
      panel(2, { x: 0, y: 4, w: 6, h: 4 }, {
        type: 'detection_events', title: 'Critical and high', source: 'detections',
        projectId: null, timeRange: '24h', severities: ['critical', 'high'],
      }),
      panel(3, { x: 6, y: 4, w: 6, h: 4 }, {
        type: 'activity_overview', title: 'Detections and errors', source: 'mixed',
        projectId: null, timeRange: '7d', series: ['detections', 'log_errors'],
      }),
    ],
  },
];

function findTemplate(id: string): DashboardTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function listDashboardTemplates(): DashboardTemplateSummary[] {
  return TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    panelCount: t.panels.length,
    panelTypes: [...new Set(t.panels.map((p) => p.config.type))],
  }));
}

/**
 * Serialise a template to the YAML shape importYaml reads. Every panel config
 * carrying a projectId gets `opts.projectId` (null = all projects). Returns
 * null for an unknown template id.
 */
export function buildTemplateYaml(
  id: string,
  opts: { projectId?: string | null; name?: string } = {}
): string | null {
  const template = findTemplate(id);
  if (!template) return null;

  const projectId = opts.projectId ?? null;
  const panels = template.panels.map((p) => ({
    ...p,
    config: 'projectId' in p.config ? { ...p.config, projectId } : { ...p.config },
  }));

  return yaml.dump(
    {
      name: opts.name ?? template.name,
      description: template.description,
      schema_version: CURRENT_SCHEMA_VERSION,
      panels,
    },
    { noRefs: true, sortKeys: false }
  );
}
