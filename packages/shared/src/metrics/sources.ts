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
//   GET  /api/v1/metrics/sources/index?organizationId&projectIds&from&to
//        -> MetricSourceIndex (names, metric counts and last seen only: two
//           storage reads, for pickers; no signals, no status)
//   GET  /api/v1/metrics/sources/host/:name?organizationId&projectIds&from&to
//        -> HostSourceDetail (404 when the host sent nothing in the window)
//   GET  /api/v1/metrics/sources/service/:name?organizationId&projectIds&from&to
//        -> ServiceSourceDetail
//   GET  /api/v1/metrics/sources/:kind/:name/traces?organizationId&projectIds&from&to
//        -> SourceTraceSeries (requests, errors and p95 of the entry spans of
//           the source over time: a host by the resource host.name of its spans)
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
  /**
   * Hardware host rows for this name (one per project). isVirtual is null until
   * the agent reported hw.host.info; a VM has no hardware sensors to judge.
   */
  hardwareHosts: Array<{ projectId: string; id: string; isVirtual?: boolean | null }>;
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
  /**
   * Where the three RED signals below come from: entry spans when the service
   * has spans in the window, else the HTTP server duration histogram, else null
   * (the signals are then empty).
   */
  redSource: 'traces' | 'metrics' | null;
  /** Requests per second (null value when redSource is null). */
  requestRate: SourceSignalValue;
  /** Error % (5xx or error spans over all requests). */
  errorRate: SourceSignalValue;
  /** p95 duration in ms. */
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

/** One bucket of entry spans (server and consumer spans: one per request handled). */
export interface SourceTraceBucket {
  /** ISO start of the bucket. */
  time: string;
  requests: number;
  errors: number;
  /** p95 duration in ms, null without requests. */
  p95: number | null;
}

export interface SourceTraceSeries {
  bucketSeconds: number;
  /** Every bucket of the window, oldest first; empty buckets have 0 requests. */
  buckets: SourceTraceBucket[];
  totals: { requests: number; errors: number };
}

/** One host or service in a picker: no signals, no health. */
export interface MetricSourceIndexEntry {
  name: string;
  metricCount: number;
  /** ISO */
  lastSeen: string;
  /** Sent data within SOURCE_STALE_AFTER_MS of the end of the window. */
  live: boolean;
}

export interface MetricSourceIndex {
  hosts: MetricSourceIndexEntry[];
  services: MetricSourceIndexEntry[];
}
