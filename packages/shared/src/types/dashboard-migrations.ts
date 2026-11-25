// ============================================================================
// Custom Dashboards - Schema Migrations
// ============================================================================
//
// Schema migration framework for the DashboardDocument JSONB. Each migration
// function takes a document at version N-1 and returns a document at version N.
// `migrateDashboard` walks the chain until the target version is reached.
//
// HOW TO ADD A NEW MIGRATION:
//   1. Bump CURRENT_SCHEMA_VERSION in dashboard.ts
//   2. Add an entry to dashboardMigrations keyed by the version it PRODUCES
//      (e.g. migrations[2] = (doc) => transformV1toV2(doc))
//   3. The function does not need to set schema_version itself -
//      migrateDashboard handles that.

import type {
  DashboardDocument,
  MetricChartConfig,
  MetricStatConfig,
  MetricsPanelConfig,
  PanelConfig,
  PanelInstance,
} from './dashboard.js';
import type { MetricAttrFilter, MetricQueryInterval, MetricTimeAggregation } from '../metrics/query.js';

export type SchemaMigration = (doc: DashboardDocument) => DashboardDocument;

export type MigrationMap = Record<number, SchemaMigration>;

function legacyMetricFilters(serviceName: string | null): MetricAttrFilter[] {
  return serviceName ? [{ scope: 'resource', key: 'service.name', op: 'eq', values: [serviceName] }] : [];
}

/** v1 metric_chart / metric_stat to the v2 `metrics` panel (same metric, aggregation, window). */
export function migrateLegacyMetricPanel(config: MetricChartConfig | MetricStatConfig): MetricsPanelConfig {
  const isChart = config.type === 'metric_chart';
  return {
    type: 'metrics',
    title: config.title,
    source: 'metrics',
    timeRange: config.timeRange,
    query: {
      projectIds: config.projectId ? [config.projectId] : null,
      queries: [
        {
          id: 'A',
          metricName: config.metricName,
          aggregation: config.aggregation as MetricTimeAggregation,
          filters: legacyMetricFilters(config.serviceName),
          groupBy: isChart ? (config.groupBy ?? []).map((key) => ({ scope: 'metric' as const, key })) : [],
        },
      ],
      formulas: [],
      interval: isChart ? (config.interval as MetricQueryInterval) : 'auto',
      compareTo: 'none',
      display: isChart ? 'lines' : 'stat',
      unitOverride: isChart ? null : (config.unit ?? null),
    },
  };
}

function migratePanelV2(panel: PanelInstance): PanelInstance {
  const config = panel.config as PanelConfig;
  if (config.type === 'metric_chart' || config.type === 'metric_stat') {
    return { ...panel, config: migrateLegacyMetricPanel(config) };
  }
  return panel;
}

export const dashboardMigrations: MigrationMap = {
  // 1.8: metric_chart/metric_stat -> metrics panel; documents gain variables.
  2: (doc) => ({ ...doc, panels: doc.panels.map(migratePanelV2), variables: doc.variables ?? [] }),
};

/**
 * Migrate a dashboard document from its current schema_version to the target.
 * Idempotent: returns the document unchanged if it is already at the target.
 *
 * Throws if a required intermediate migration is missing - this is a safety
 * net to prevent silently dropping data when an old client writes a future
 * schema version we don't know how to read.
 */
export function migrateDashboard(
  doc: DashboardDocument,
  targetVersion: number
): DashboardDocument {
  let current = doc;
  while (current.schema_version < targetVersion) {
    const nextVersion = current.schema_version + 1;
    const migration = dashboardMigrations[nextVersion];
    if (!migration) {
      throw new Error(
        `No migration registered for dashboard schema_version ${current.schema_version} → ${nextVersion}`
      );
    }
    current = { ...migration(current), schema_version: nextVersion };
  }
  return current;
}
