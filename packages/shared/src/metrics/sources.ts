// ============================================================================
// Metric sources (1.8): who sends metrics
// ============================================================================
//
// A source is identified by a resource attribute: hosts by host.name,
// services by service.name. A data point can belong to both (an app on a
// host). Agent services (only host-level metrics, see HOST_METRIC_PREFIXES)
// are not listed as services.
//
// Endpoints (session auth, organization scoped):
//   GET  /api/v1/metrics/sources?organizationId&projectIds=a,b&from&to
//        -> MetricSourcesResponse
//   GET  /api/v1/metrics/sources/host/:name?organizationId&projectIds&from&to
//        -> HostSourceDetail (404 when the host sent nothing in the window)
//   GET  /api/v1/metrics/sources/service/:name?organizationId&projectIds&from&to
//        -> ServiceSourceDetail
//   POST /api/v1/metrics/sources/:kind/:name/customize
//        body { organizationId, projectIds?: string[] | null }
//        -> { dashboardId } (a new dashboard from the kind's template, its
//           variable defaulting to this source)

export type MetricSourceKind = 'host' | 'service';

/** stale: no data for SOURCE_STALE_AFTER_MS; unknown: too little data to judge. */
export type MetricSourceStatus = 'ok' | 'warning' | 'critical' | 'stale' | 'unknown';

/** A headline value with its unit and a short trend (oldest first, about 24 points). */
export interface SourceSignalValue {
  value: number | null;
  unit: string | null;
  spark: Array<number | null>;
}

export interface HostSourceSummary {
  kind: 'host';
  /** host.name */
  name: string;
  projectIds: string[];
  /** ISO */
  lastSeen: string;
  status: MetricSourceStatus;
  /** Human reason for a non-ok status, e.g. "Disk /var at 93%", "No data for 14 min". */
  statusReason: string | null;
  /** Busy CPU %. */
  cpu: SourceSignalValue;
  /** Used memory %. */
  memory: SourceSignalValue;
  /** Fullest filesystem %. */
  disk: SourceSignalValue;
  /** Network throughput, bytes/s, every interface and direction. */
  network: SourceSignalValue;
  /** 5 minute load average. */
  load: SourceSignalValue;
  /** Hardware Health status when the host is also a hardware host (hw.* metrics), else null. */
  hardwareStatus: 'ok' | 'warning' | 'critical' | 'unknown' | 'stale' | null;
  /** Hardware host rows for this name (one per project). */
  hardwareHosts: Array<{ projectId: string; id: string }>;
  /** Services (service.name) seen on this host, agent services excluded. */
  services: string[];
  /** Operating system, e.g. "Debian 12" or the kernel when that is all we know. */
  os: string | null;
  metricCount: number;
}

export interface ServiceSourceSummary {
  kind: 'service';
  /** service.name */
  name: string;
  projectIds: string[];
  lastSeen: string;
  status: MetricSourceStatus;
  statusReason: string | null;
  /** Requests per second, from server/consumer spans (null without traces). */
  requestRate: SourceSignalValue;
  /** Error %, from spans (null without traces). */
  errorRate: SourceSignalValue;
  /** p95 duration in ms, from spans (null without traces). */
  p95: SourceSignalValue;
  /** Hosts (host.name) the service runs on. */
  hosts: string[];
  metricCount: number;
  hasTraces: boolean;
}

export interface MetricSourcesResponse {
  hosts: HostSourceSummary[];
  services: ServiceSourceSummary[];
}

export interface HostSourceInfo {
  os?: string;
  kernel?: string;
  vendor?: string;
  model?: string;
  virtual?: boolean;
  agentVersion?: string;
  memoryBytes?: number;
  uptimeSeconds?: number;
  cpuCount?: number;
}

export interface HostSourceDetail extends HostSourceSummary {
  info: HostSourceInfo;
  /** Every metric name the host sent in the window, sorted. */
  metricNames: string[];
}

export interface ServiceSourceDetail extends ServiceSourceSummary {
  metricNames: string[];
}
