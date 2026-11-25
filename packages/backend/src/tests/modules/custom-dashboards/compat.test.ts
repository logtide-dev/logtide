// ============================================================================
// Backward compatibility of stored dashboards and exported YAML
// ============================================================================
//
// Fields added after 1.0 are optional. Schema v2 (1.8) turns metric_chart and
// metric_stat into the `metrics` panel: v1 documents must load, migrate and
// re-import (YAML) into valid v2 documents.

import { describe, it, expect, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { CURRENT_SCHEMA_VERSION, migrateDashboard } from '@logtide/shared';
import type { PanelInstance } from '@logtide/shared';
import { CustomDashboardsService } from '../../../modules/custom-dashboards/service.js';
import { dashboardDocumentSchema, panelRegistry } from '../../../modules/custom-dashboards/panel-registry.js';
import { db } from '../../../database/index.js';
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
  { id: 'p6', layout: LAYOUT, config: { type: 'metrics', title: 'Metrics', source: 'metrics', timeRange: '1h', query: { projectIds: null, queries: [{ id: 'A', metricName: 'cpu', aggregation: 'avg', filters: [], groupBy: [] }], formulas: [], interval: 'auto', compareTo: 'none', display: 'lines', unitOverride: null } } },
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
  const LEGACY_CHART = { type: 'metric_chart', title: 'Chart', source: 'metrics', projectId: null, metricName: 'cpu', aggregation: 'avg', interval: '5m', timeRange: '1h', serviceName: 'api', groupBy: ['host'] };
  const LEGACY_STAT = { type: 'metric_stat', title: 'MStat', source: 'metrics', projectId: null, metricName: 'cpu', aggregation: 'max', timeRange: '1h', serviceName: null, unit: '%' };

  it('a v1 document with metric panels migrates to valid v2 metrics panels', async () => {
    const legacy = {
      schema_version: 1,
      panels: [
        { id: 'l1', layout: LAYOUT, config: LEGACY_CHART },
        { id: 'l2', layout: LAYOUT, config: LEGACY_STAT },
        ONE_OF_EACH[0],
      ],
    } as unknown as { schema_version: number; panels: PanelInstance[] };

    // Raw v1 no longer validates (metric_chart is not a registered panel type)...
    expect(() => dashboardDocumentSchema.parse(legacy)).toThrow();

    // ...but migrates and validates.
    const migrated = migrateDashboard(legacy, CURRENT_SCHEMA_VERSION);
    expect(migrated.schema_version).toBe(2);
    const parsed = dashboardDocumentSchema.parse(migrated);
    expect(parsed.panels.map((p) => p.config.type)).toEqual(['metrics', 'metrics', 'time_series']);

    // Same through the database: a stored v1 row reads back as v2.
    const created = await service.create({ organizationId: ctx.organization.id, name: 'Legacy' }, ctx.user.id);
    await db
      .updateTable('custom_dashboards')
      .set({ schema_version: 1, panels: JSON.stringify(legacy.panels) as unknown as PanelInstance[] })
      .where('id', '=', created.id)
      .execute();
    const read = await service.getById(created.id, ctx.organization.id, ctx.user.id);
    expect(read!.schemaVersion).toBe(2);
    expect(read!.variables).toEqual([]);
    expect(read!.panels.map((p) => p.config.type)).toEqual(['metrics', 'metrics', 'time_series']);
    const chart = read!.panels[0].config as unknown as { query: { queries: Array<Record<string, unknown>> } };
    expect(chart.query.queries[0]).toMatchObject({
      id: 'A',
      metricName: 'cpu',
      filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['api'] }],
      groupBy: [{ scope: 'metric', key: 'host' }],
    });
  });

  it('updating only variables on a v1 row writes the migrated panels with the new schema version', async () => {
    const created = await service.create({ organizationId: ctx.organization.id, name: 'Legacy vars' }, ctx.user.id);
    await db
      .updateTable('custom_dashboards')
      .set({ schema_version: 1, panels: JSON.stringify([{ id: 'l1', layout: LAYOUT, config: LEGACY_CHART }]) as unknown as PanelInstance[] })
      .where('id', '=', created.id)
      .execute();

    await service.update(created.id, ctx.organization.id, ctx.user.id, {
      variables: [{ name: 'host', label: 'Host', attr: { scope: 'resource', key: 'host.name' }, metricName: null, default: null }],
    });

    const row = await db.selectFrom('custom_dashboards').select(['schema_version', 'panels']).where('id', '=', created.id).executeTakeFirstOrThrow();
    expect(row.schema_version).toBe(2);
    const stored = (typeof row.panels === 'string' ? JSON.parse(row.panels) : row.panels) as Array<{ config: { type: string } }>;
    expect(stored.map((p) => p.config.type)).toEqual(['metrics']);
  });

  it('metric_chart and metric_stat can no longer be saved', async () => {
    for (const config of [LEGACY_CHART, LEGACY_STAT]) {
      await expect(
        service.create(
          { organizationId: ctx.organization.id, name: 'No', panels: [{ id: 'x', layout: LAYOUT, config } as unknown as PanelInstance] },
          ctx.user.id
        )
      ).rejects.toBeInstanceOf(ZodError);
    }
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
      { id: 'o1', layout: LAYOUT, config: { type: 'metrics', title: 'Grouped', source: 'metrics', timeRange: '1h', query: { projectIds: null, queries: [{ id: 'A', metricName: 'cpu', aggregation: 'avg', filters: [{ scope: 'resource', key: 'host.name', op: 'in', values: ['a', 'b'] }], groupBy: [{ scope: 'resource', key: 'host.name' }], limit: 5 }], formulas: [{ id: 'F1', expression: 'A * 2' }], interval: '5m', compareTo: '1d', display: 'split', unitOverride: 'ms' } } },
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

  it('a v1 yaml with metric panels (rate included) imports as v2 metrics panels', async () => {
    const text = `
name: Old board
schema_version: 1
panels:
  - id: r1
    layout: { x: 0, y: 0, w: 4, h: 3 }
    config:
      type: metric_chart
      title: Rate
      source: metrics
      projectId: null
      metricName: requests
      aggregation: rate
      interval: 5m
      timeRange: 1h
      serviceName: null
      groupBy: [host]
  - id: r2
    layout: { x: 4, y: 0, w: 4, h: 3 }
    config:
      type: metric_stat
      title: Rate stat
      source: metrics
      projectId: null
      metricName: requests
      aggregation: rate
      timeRange: 1h
      serviceName: null
      unit: /s
`;
    const imported = await service.importYaml(text, ctx.organization.id, ctx.user.id);
    expect(imported.schemaVersion).toBe(2);
    const [a, b] = imported.panels.map((p) => p.config) as unknown as Array<{ type: string; query: { queries: Array<{ aggregation: string }>; display: string; unitOverride: string | null } }>;
    expect(a.type).toBe('metrics');
    expect(a.query.queries[0].aggregation).toBe('rate');
    expect(b.query.display).toBe('stat');
    expect(b.query.unitOverride).toBe('/s');

    const again = await service.importYaml(
      await service.exportYaml(imported.id, ctx.organization.id, ctx.user.id),
      ctx.organization.id,
      ctx.user.id
    );
    expect(again.panels.map((p) => p.config)).toEqual(imported.panels.map((p) => p.config));
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

  it('schema_version is 2', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    const d = await service.create({ organizationId: ctx.organization.id, name: 'V' }, ctx.user.id);
    expect(d.schemaVersion).toBe(2);
    const added = await service.addPanel(d.id, ctx.organization.id, ctx.user.id, { config: ONE_OF_EACH[5].config });
    expect(added.dashboard.schemaVersion).toBe(2);
    const fromTemplate = await service.createFromTemplate('service-health', ctx.organization.id, ctx.user.id);
    expect(fromTemplate.schemaVersion).toBe(2);
  });
});
