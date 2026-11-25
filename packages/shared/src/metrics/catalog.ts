// ============================================================================
// Metric catalog (1.8)
// ============================================================================
//
// Metadata kept by the backend (Postgres table metric_catalog, every storage
// engine) from OTLP: type, unit, description, first/last seen per project.
//
// Endpoints (session auth, organization scoped):
//   GET /api/v1/metrics/catalog?organizationId&projectIds&search&prefix
//       -> { metrics: MetricCatalogEntry[] }
//   GET /api/v1/metrics/catalog/entry?organizationId&projectIds&name
//       -> MetricCatalogDetail (404 when unknown)
//   GET /api/v1/metrics/attributes?organizationId&projectIds&metricName&scope&from&to
//       -> { keys: string[] }        (metricName optional for scope=resource)
//   GET /api/v1/metrics/attribute-values?organizationId&projectIds&metricName&scope&key&from&to
//       -> { values: string[] }

export interface MetricCatalogEntry {
  name: string;
  /** gauge | sum | histogram | exp_histogram | summary */
  type: string;
  unit: string | null;
  description: string | null;
  /** Sums only. */
  isMonotonic: boolean | null;
  projectIds: string[];
  /** ISO */
  firstSeen: string;
  lastSeen: string;
}

export interface MetricCatalogAttribute {
  key: string;
  /** Up to 20 sample values, most frequent first when the engine can tell. */
  values: string[];
}

export interface MetricCatalogDetail {
  entry: MetricCatalogEntry;
  attributes: { metric: MetricCatalogAttribute[]; resource: MetricCatalogAttribute[] };
  sources: { hosts: string[]; services: string[] };
  usedIn: { dashboards: Array<{ id: string; name: string }> };
}

export interface MetricCatalogListResponse {
  metrics: MetricCatalogEntry[];
}
