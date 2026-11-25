// ============================================================================
// Source templates (1.8)
// ============================================================================
//
// A source view (host or service) IS a dashboard template: the frontend
// renders these panels with the template variable set to the source, and
// "Customize" saves the same panels as a real dashboard whose variable
// defaults to that source. Edit here and both follow.

import type { DashboardVariable, PanelConfig, PanelTimeRange } from '../types/dashboard.js';
import type { MetricAttrFilter, MetricExplorerQuery, MetricQuerySpec } from './query.js';
import type { MetricSourceKind } from './sources.js';

export interface SourceTemplatePanel {
  /** Stable key inside the template. */
  key: string;
  /** Grid width (1-12) and height (rows). */
  w: number;
  h: number;
  config: PanelConfig;
  /** The panel shows only when the source sends at least one of these metrics. Empty: always. */
  requires: string[];
  /** Trace panels: shown only when the source has spans (see applicableTemplatePanels). */
  requiresTraces?: boolean;
  /** Hidden when the source sends any of these metrics (e.g. a legacy set superseded by a newer one). */
  hiddenWhen?: string[];
}

export interface SourceTemplateSection {
  title: string;
  panels: SourceTemplatePanel[];
}

export interface SourceTemplate {
  kind: MetricSourceKind;
  /** Dashboard name for "Customize": "{name}" is replaced by the source name. */
  dashboardName: string;
  variable: Omit<DashboardVariable, 'default'>;
  sections: SourceTemplateSection[];
}

const DEFAULT_RANGE: PanelTimeRange = '6h';

function q(
  queries: MetricQuerySpec[],
  display: MetricExplorerQuery['display'],
  extra: Partial<MetricExplorerQuery> = {},
): MetricExplorerQuery {
  return { projectIds: null, queries, formulas: [], interval: 'auto', compareTo: 'none', display, ...extra };
}

function metricsPanel(title: string, query: MetricExplorerQuery): PanelConfig {
  return { type: 'metrics', title, source: 'metrics', query, timeRange: DEFAULT_RANGE };
}

const hostFilter = (): MetricAttrFilter => ({ scope: 'resource', key: 'host.name', op: 'eq', values: ['$host'] });

export const HOST_TEMPLATE: SourceTemplate = {
  kind: 'host',
  dashboardName: '{name} resources',
  variable: { name: 'host', label: 'Host', attr: { scope: 'resource', key: 'host.name' }, metricName: null },
  sections: [
    {
      title: 'CPU and memory',
      panels: [
        {
          key: 'cpu-state',
          w: 6,
          h: 4,
          requires: ['system.cpu.utilization'],
          config: metricsPanel(
            'CPU by state',
            q(
              [
                {
                  id: 'A',
                  metricName: 'system.cpu.utilization',
                  aggregation: 'avg',
                  filters: [hostFilter(), { scope: 'metric', key: 'system.cpu.state', op: 'neq', values: ['idle'] }],
                  groupBy: [{ scope: 'metric', key: 'system.cpu.state' }],
                },
              ],
              'area',
            ),
          ),
        },
        {
          key: 'memory-state',
          w: 6,
          h: 4,
          requires: ['system.memory.usage'],
          config: metricsPanel(
            'Memory',
            q(
              [
                {
                  id: 'A',
                  metricName: 'system.memory.usage',
                  aggregation: 'avg',
                  filters: [hostFilter(), { scope: 'metric', key: 'system.memory.state', op: 'in', values: ['used', 'cached', 'buffers'] }],
                  groupBy: [{ scope: 'metric', key: 'system.memory.state' }],
                },
              ],
              'area',
            ),
          ),
        },
        {
          key: 'load',
          w: 6,
          h: 4,
          requires: ['system.cpu.load_average.1m'],
          config: metricsPanel(
            'Load average',
            q(
              [
                { id: 'A', label: '1m', metricName: 'system.cpu.load_average.1m', aggregation: 'avg', filters: [hostFilter()], groupBy: [] },
                { id: 'B', label: '5m', metricName: 'system.cpu.load_average.5m', aggregation: 'avg', filters: [hostFilter()], groupBy: [] },
                { id: 'C', label: '15m', metricName: 'system.cpu.load_average.15m', aggregation: 'avg', filters: [hostFilter()], groupBy: [] },
              ],
              'lines',
            ),
          ),
        },
        {
          key: 'swap',
          w: 6,
          h: 4,
          requires: ['system.paging.utilization'],
          config: metricsPanel(
            'Swap used',
            q([{ id: 'A', metricName: 'system.paging.utilization', aggregation: 'avg', filters: [hostFilter()], groupBy: [] }], 'lines'),
          ),
        },
      ],
    },
    {
      title: 'Disks',
      panels: [
        {
          key: 'filesystems',
          w: 6,
          h: 4,
          requires: ['system.filesystem.utilization'],
          config: metricsPanel(
            'Filesystem usage',
            q(
              [
                {
                  id: 'A',
                  metricName: 'system.filesystem.utilization',
                  aggregation: 'last',
                  filters: [hostFilter()],
                  groupBy: [{ scope: 'metric', key: 'system.filesystem.mountpoint' }],
                  limit: 20,
                },
              ],
              'table',
            ),
          ),
        },
        {
          key: 'disk-io',
          w: 6,
          h: 4,
          requires: ['system.disk.io.rate'],
          config: metricsPanel(
            'Disk throughput',
            q(
              [
                {
                  id: 'A',
                  metricName: 'system.disk.io.rate',
                  aggregation: 'avg',
                  spaceAggregation: 'sum',
                  filters: [hostFilter()],
                  groupBy: [{ scope: 'metric', key: 'system.device' }, { scope: 'metric', key: 'disk.io.direction' }],
                },
              ],
              'lines',
            ),
          ),
        },
        {
          key: 'disk-ops',
          w: 6,
          h: 4,
          requires: ['system.disk.operations.rate'],
          config: metricsPanel(
            'Disk operations',
            q(
              [
                {
                  id: 'A',
                  metricName: 'system.disk.operations.rate',
                  aggregation: 'avg',
                  spaceAggregation: 'sum',
                  filters: [hostFilter()],
                  groupBy: [{ scope: 'metric', key: 'disk.io.direction' }],
                },
              ],
              'lines',
            ),
          ),
        },
      ],
    },
    {
      title: 'Network',
      panels: [
        {
          key: 'network-io',
          w: 12,
          h: 4,
          requires: ['system.network.io.rate'],
          config: metricsPanel(
            'Network throughput',
            q(
              [
                {
                  id: 'A',
                  metricName: 'system.network.io.rate',
                  aggregation: 'avg',
                  spaceAggregation: 'sum',
                  filters: [hostFilter()],
                  groupBy: [{ scope: 'metric', key: 'system.device' }, { scope: 'metric', key: 'network.io.direction' }],
                },
              ],
              'lines',
            ),
          ),
        },
      ],
    },
  ],
};

const serviceFilter = (): MetricAttrFilter => ({ scope: 'resource', key: 'service.name', op: 'eq', values: ['$service'] });

/**
 * HTTP server panels read from an OTel HTTP server duration histogram. Two
 * semconv generations exist: `http.server.request.duration` (seconds, status in
 * `http.response.status_code`) and the older `http.server.duration`
 * (milliseconds, status in `http.status_code`). Each gets its own panel set,
 * shown only when that metric is present.
 */
function httpPanels(
  metricName: string,
  statusKey: string,
  keyPrefix: string,
  hiddenWhen: string[] = [],
): SourceTemplatePanel[] {
  const status5xx: MetricAttrFilter = { scope: 'metric', key: statusKey, op: 'gte', values: ['500'] };
  const latency = (id: string, aggregation: 'p50' | 'p95' | 'p99'): MetricQuerySpec => ({
    id,
    metricName,
    aggregation,
    filters: [serviceFilter()],
    groupBy: [],
    label: aggregation,
  });
  return [
    {
      key: `${keyPrefix}-rate`,
      w: 6,
      h: 4,
      requires: [metricName],
      hiddenWhen,
      config: metricsPanel(
        'Requests per second by route',
        q([{ id: 'A', metricName, aggregation: 'rate', filters: [serviceFilter()], groupBy: [{ scope: 'metric', key: 'http.route' }], limit: 10 }], 'lines'),
      ),
    },
    {
      key: `${keyPrefix}-error-rate`,
      w: 6,
      h: 4,
      requires: [metricName],
      hiddenWhen,
      config: metricsPanel(
        'Error rate (5xx)',
        q(
          [
            { id: 'A', metricName, aggregation: 'rate', filters: [serviceFilter(), status5xx], groupBy: [], hidden: true },
            { id: 'B', metricName, aggregation: 'rate', filters: [serviceFilter()], groupBy: [], hidden: true },
          ],
          'lines',
          { formulas: [{ id: 'F1', expression: 'A / B * 100', label: 'Error rate %', missingAsZero: true }], unitOverride: '%' },
        ),
      ),
    },
    {
      key: `${keyPrefix}-latency`,
      w: 12,
      h: 4,
      requires: [metricName],
      hiddenWhen,
      config: metricsPanel('Request latency', q([latency('A', 'p50'), latency('B', 'p95'), latency('C', 'p99')], 'lines')),
    },
  ];
}

export const SERVICE_TEMPLATE: SourceTemplate = {
  kind: 'service',
  dashboardName: '{name} overview',
  variable: { name: 'service', label: 'Service', attr: { scope: 'resource', key: 'service.name' }, metricName: null },
  sections: [
    {
      title: 'Traffic (from traces)',
      panels: [
        {
          key: 'trace-volume',
          w: 6,
          h: 4,
          requires: [],
          requiresTraces: true,
          // serviceName "$service" is resolved like a metrics filter variable.
          config: { type: 'trace_volume', title: 'Requests and errors', source: 'traces', projectId: null, serviceName: '$service', timeRange: DEFAULT_RANGE, showErrors: true },
        },
        {
          key: 'trace-latency',
          w: 6,
          h: 4,
          requires: [],
          requiresTraces: true,
          config: { type: 'trace_latency', title: 'Latency', source: 'traces', projectId: null, serviceName: '$service', timeRange: DEFAULT_RANGE, showPercentiles: ['p50', 'p95', 'p99'] },
        },
      ],
    },
    {
      title: 'HTTP (from metrics)',
      panels: [
        ...httpPanels('http.server.request.duration', 'http.response.status_code', 'http'),
        ...httpPanels('http.server.duration', 'http.status_code', 'http-legacy', ['http.server.request.duration']),
      ],
    },
    {
      title: 'Runtime',
      panels: [
        {
          key: 'node-heap',
          w: 6,
          h: 4,
          requires: ['v8js.memory.heap.used'],
          config: metricsPanel(
            'Node.js heap used',
            q([{ id: 'A', metricName: 'v8js.memory.heap.used', aggregation: 'avg', spaceAggregation: 'sum', filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['$service'] }], groupBy: [] }], 'area'),
          ),
        },
        {
          key: 'node-eventloop',
          w: 6,
          h: 4,
          requires: ['nodejs.eventloop.delay.p99'],
          config: metricsPanel(
            'Event loop delay p99',
            q([{ id: 'A', metricName: 'nodejs.eventloop.delay.p99', aggregation: 'max', filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['$service'] }], groupBy: [] }], 'lines'),
          ),
        },
        {
          key: 'jvm-memory',
          w: 6,
          h: 4,
          requires: ['jvm.memory.used'],
          config: metricsPanel(
            'JVM memory used',
            q([{ id: 'A', metricName: 'jvm.memory.used', aggregation: 'avg', spaceAggregation: 'sum', filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['$service'] }], groupBy: [{ scope: 'metric', key: 'jvm.memory.type' }] }], 'area'),
          ),
        },
        {
          key: 'process-cpu',
          w: 6,
          h: 4,
          requires: ['process.cpu.utilization'],
          config: metricsPanel(
            'Process CPU',
            q([{ id: 'A', metricName: 'process.cpu.utilization', aggregation: 'avg', filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['$service'] }], groupBy: [] }], 'lines'),
          ),
        },
        {
          key: 'process-memory',
          w: 6,
          h: 4,
          requires: ['process.memory.usage'],
          config: metricsPanel(
            'Process memory',
            q([{ id: 'A', metricName: 'process.memory.usage', aggregation: 'avg', spaceAggregation: 'sum', filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['$service'] }], groupBy: [] }], 'area'),
          ),
        },
        {
          key: 'db-connections',
          w: 6,
          h: 4,
          requires: ['db.client.connection.count'],
          config: metricsPanel(
            'DB connections',
            q([{ id: 'A', metricName: 'db.client.connection.count', aggregation: 'avg', spaceAggregation: 'sum', filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['$service'] }], groupBy: [{ scope: 'metric', key: 'db.client.connection.state' }] }], 'lines'),
          ),
        },
      ],
    },
  ],
};

export const SOURCE_TEMPLATES: Record<MetricSourceKind, SourceTemplate> = {
  host: HOST_TEMPLATE,
  service: SERVICE_TEMPLATE,
};

/**
 * Panels of a template the source can fill: `requires` empty or one of them in
 * `metricNames`, and trace panels only unless `hasTraces` is false (default
 * true: a saved dashboard keeps them, spans may arrive later).
 */
export function applicableTemplatePanels(
  template: SourceTemplate,
  metricNames: Iterable<string>,
  opts: { hasTraces?: boolean } = {},
): SourceTemplateSection[] {
  const have = new Set(metricNames);
  const hasTraces = opts.hasTraces ?? true;
  return template.sections
    .map((section) => ({
      ...section,
      panels: section.panels.filter(
        (p) =>
          (hasTraces || !p.requiresTraces) &&
          (p.requires.length === 0 || p.requires.some((m) => have.has(m))) &&
          !(p.hiddenWhen ?? []).some((m) => have.has(m)),
      ),
    }))
    .filter((section) => section.panels.length > 0);
}
