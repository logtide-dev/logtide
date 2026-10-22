// ============================================================================
// Backward compatibility of stored dashboards and exported YAML
// ============================================================================
//
// Every field added after 1.0 is optional and schema_version stays 1, so a
// document written by an older build must load, migrate and re-import
// unchanged.

import { describe, it, expect, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { CURRENT_SCHEMA_VERSION, migrateDashboard } from '@logtide/shared';
import type { PanelInstance } from '@logtide/shared';
import { CustomDashboardsService } from '../../../modules/custom-dashboards/service.js';
import { dashboardDocumentSchema, panelRegistry } from '../../../modules/custom-dashboards/panel-registry.js';
import { createTestContext } from '../../helpers/index.js';

let service: CustomDashboardsService;
let ctx: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  service = new CustomDashboardsService();
  ctx = await createTestContext();
});

const LAYOUT = { x: 0, y: 0, w: 4, h: 3 };

// One valid config per panel type, using only fields that existed before the
// optional groupBy / seriesLabels / metadataField additions where possible.
const ONE_OF_EACH: PanelInstance[] = [
  { id: 'p1', layout: LAYOUT, config: { type: 'time_series', title: 'Logs', source: 'logs', projectId: null, interval: '24h', levels: ['info', 'error'], service: null } },
  { id: 'p2', layout: LAYOUT, config: { type: 'single_stat', title: 'Stat', source: 'logs', metric: 'total_logs', projectId: null, compareWithPrevious: true } },
  { id: 'p3', layout: LAYOUT, config: { type: 'top_n_table', title: 'Top', source: 'logs', dimension: 'service', limit: 5, projectId: null, interval: '7d' } },
  { id: 'p4', layout: LAYOUT, config: { type: 'live_log_stream', title: 'Live', source: 'logs', projectId: null, service: null, levels: ['error'], maxRows: 50 } },
  { id: 'p5', layout: LAYOUT, config: { type: 'alert_status', title: 'Alerts', source: 'alerts', projectId: null, ruleIds: [], showHistory: true, limit: 5 } },
  { id: 'p6', layout: LAYOUT, config: { type: 'metric_chart', title: 'Chart', source: 'metrics', projectId: null, metricName: 'cpu', aggregation: 'avg', interval: '5m', timeRange: '1h', serviceName: null } },
  { id: 'p7', layout: LAYOUT, config: { type: 'metric_stat', title: 'MStat', source: 'metrics', projectId: null, metricName: 'cpu', aggregation: 'max', timeRange: '1h', serviceName: null, unit: '%' } },
  { id: 'p8', layout: LAYOUT, config: { type: 'trace_latency', title: 'Lat', source: 'traces', projectId: null, serviceName: null, timeRange: '24h', showPercentiles: ['p50', 'p99'] } },
  { id: 'p9', layout: LAYOUT, config: { type: 'trace_volume', title: 'Vol', source: 'traces', projectId: null, serviceName: null, timeRange: '24h', showErrors: true } },
  { id: 'p10', layout: LAYOUT, config: { type: 'detection_events', title: 'Det', source: 'detections', projectId: null, timeRange: '7d', severities: ['critical', 'high'] } },
  { id: 'p11', layout: LAYOUT, config: { type: 'monitor_status', title: 'Mon', source: 'monitors', projectId: null, monitorIds: [], limit: 5 } },
  { id: 'p12', layout: LAYOUT, config: { type: 'system_status', title: 'Sys', source: 'monitors', projectId: null, showCounts: true } },
  { id: 'p13', layout: LAYOUT, config: { type: 'activity_overview', title: 'Act', source: 'mixed', projectId: null, timeRange: '24h', series: ['logs', 'detections'] } },
  { id: 'p14', layout: LAYOUT, config: { type: 'geo_map', title: 'Geo', source: 'logs', projectId: null, interval: '24h', mode: 'country', limit: 100, fieldPrefix: 'geo', levels: [], service: null, hostname: null } },
  { id: 'p15', layout: LAYOUT, config: { type: 'log_table', title: 'Rows', source: 'logs', projectId: null, mode: 'snapshot', timeRange: '24h', levels: [], service: null, maxRows: 25, columns: ['http.status'], builtinColumns: ['time', 'message'], wrapCells: false } },
];

describe('dashboard compatibility', () => {
  it('a document saved before this release (no groupBy, no seriesLabels, no metadataField) parses and migrates unchanged', async () => {
    const legacy = {
      schema_version: 1,
      panels: ONE_OF_EACH.filter((p) =>
        ['time_series', 'metric_chart', 'top_n_table'].includes(p.config.type)
      ),
    };
    for (const p of legacy.panels) {
      expect(p.config).not.toHaveProperty('groupBy');
      expect(p.config).not.toHaveProperty('seriesLabels');
      expect(p.config).not.toHaveProperty('metadataField');
    }

    const parsed = dashboardDocumentSchema.parse(legacy);
    expect(parsed).toEqual(legacy);
    expect(migrateDashboard(legacy, CURRENT_SCHEMA_VERSION)).toEqual(legacy);

    // Same through the database round trip.
    const created = await service.create(
      { organizationId: ctx.organization.id, name: 'Legacy', panels: legacy.panels },
      ctx.user.id
    );
    const read = await service.getById(created.id, ctx.organization.id, ctx.user.id);
    expect(read!.panels).toEqual(legacy.panels);
    expect(read!.schemaVersion).toBe(1);
  });

  it('yaml export then import round trips every panel type', async () => {
    expect(ONE_OF_EACH.map((p) => p.config.type).sort()).toEqual(Object.keys(panelRegistry).sort());

    const source = await service.create(
      { organizationId: ctx.organization.id, name: 'All types', description: 'every panel', panels: ONE_OF_EACH },
      ctx.user.id
    );
    const text = await service.exportYaml(source.id, ctx.organization.id, ctx.user.id);
    const imported = await service.importYaml(text, ctx.organization.id, ctx.user.id);

    expect(imported.name).toBe('All types');
    expect(imported.description).toBe('every panel');
    expect(imported.panels.map((p) => p.config)).toEqual(ONE_OF_EACH.map((p) => p.config));
    expect(imported.panels.map((p) => p.layout)).toEqual(ONE_OF_EACH.map((p) => p.layout));
    const importedIds = imported.panels.map((p) => p.id);
    expect(new Set(importedIds).size).toBe(importedIds.length);
    expect(importedIds.some((id) => ONE_OF_EACH.some((p) => p.id === id))).toBe(false);
  });

  it('yaml round trip keeps the optional fields added after 1.0', async () => {
    const withOptionals: PanelInstance[] = [
      { id: 'o1', layout: LAYOUT, config: { type: 'metric_chart', title: 'Grouped', source: 'metrics', projectId: null, metricName: 'cpu', aggregation: 'avg', interval: '5m', timeRange: '1h', serviceName: null, groupBy: ['host'] } },
      { id: 'o2', layout: LAYOUT, config: { type: 'time_series', title: 'Labels', source: 'logs', projectId: null, interval: '24h', levels: ['error'], service: null, seriesLabels: { error: 'Failures' } } },
      { id: 'o3', layout: LAYOUT, config: { type: 'top_n_table', title: 'Meta', source: 'logs', dimension: 'metadata', metadataField: 'performance.metric', limit: 5, projectId: null, interval: '7d' } },
    ];
    const source = await service.create(
      { organizationId: ctx.organization.id, name: 'Optionals', panels: withOptionals },
      ctx.user.id
    );
    const text = await service.exportYaml(source.id, ctx.organization.id, ctx.user.id);
    const imported = await service.importYaml(text, ctx.organization.id, ctx.user.id);
    expect(imported.panels.map((p) => p.config)).toEqual(withOptionals.map((p) => p.config));
  });

  it('accepts the rate aggregation on metric panels and keeps it through a yaml round trip', async () => {
    const withRate: PanelInstance[] = [
      { id: 'r1', layout: LAYOUT, config: { type: 'metric_chart', title: 'Rate', source: 'metrics', projectId: null, metricName: 'requests', aggregation: 'rate', interval: '5m', timeRange: '1h', serviceName: null, groupBy: ['host'] } },
      { id: 'r2', layout: LAYOUT, config: { type: 'metric_stat', title: 'Rate stat', source: 'metrics', projectId: null, metricName: 'requests', aggregation: 'rate', timeRange: '1h', serviceName: null, unit: '/s' } },
    ];
    const source = await service.create(
      { organizationId: ctx.organization.id, name: 'Rates', panels: withRate },
      ctx.user.id
    );
    const text = await service.exportYaml(source.id, ctx.organization.id, ctx.user.id);
    const imported = await service.importYaml(text, ctx.organization.id, ctx.user.id);
    expect(imported.panels.map((p) => p.config)).toEqual(withRate.map((p) => p.config));
  });

  it('a panel using a field unknown to this version is rejected with a validation error, not a crash', async () => {
    const yamlFor = (config: string) => `
name: From the future
schema_version: 1
panels:
  - id: f1
    layout: { x: 0, y: 0, w: 4, h: 3 }
    config:
${config}
`;
    // Unknown panel type
    await expect(
      service.importYaml(
        yamlFor('      type: flame_graph\n      title: Future'),
        ctx.organization.id,
        ctx.user.id
      )
    ).rejects.toBeInstanceOf(ZodError);

    // Unknown aggregation value
    await expect(
      service.importYaml(
        yamlFor(
          '      type: metric_chart\n      title: Future\n      source: metrics\n      projectId: null\n      metricName: cpu\n      aggregation: geomean\n      interval: 5m\n      timeRange: 1h\n      serviceName: null'
        ),
        ctx.organization.id,
        ctx.user.id
      )
    ).rejects.toBeInstanceOf(ZodError);

    // Unknown key inside the strict seriesLabels object
    await expect(
      service.importYaml(
        yamlFor(
          '      type: time_series\n      title: Future\n      source: logs\n      projectId: null\n      interval: 24h\n      levels: [info]\n      service: null\n      seriesLabels:\n        fatal: Fatal'
        ),
        ctx.organization.id,
        ctx.user.id
      )
    ).rejects.toBeInstanceOf(ZodError);

    expect(await service.countForOrg(ctx.organization.id)).toBe(0);
  });

  it('schema_version is still 1', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    const d = await service.create({ organizationId: ctx.organization.id, name: 'V' }, ctx.user.id);
    expect(d.schemaVersion).toBe(1);
    const added = await service.addPanel(d.id, ctx.organization.id, ctx.user.id, { config: ONE_OF_EACH[5].config });
    expect(added.dashboard.schemaVersion).toBe(1);
    const fromTemplate = await service.createFromTemplate('service-health', ctx.organization.id, ctx.user.id);
    expect(fromTemplate.schemaVersion).toBe(1);
  });
});
