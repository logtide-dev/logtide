// ============================================================================
// Hardware Health (1.7.0)
//
// Shared contract between the hw-agent metrics (`hw.*`), the backend health
// evaluator and the Monitor > Hardware pages. Thresholds live here so the UI
// and the backend always agree.
// ============================================================================

// ---------------------------------------------------------------------------
// Status model
// ---------------------------------------------------------------------------

/** Host status. `stale` = no hw.* data point for longer than HARDWARE_STALE_AFTER_MS. */
export const HARDWARE_STATUSES = ['ok', 'warning', 'critical', 'unknown', 'stale'] as const;
export type HardwareStatus = (typeof HARDWARE_STATUSES)[number];

/** Status of a single component (a host is stale, a component is not). */
export type HardwareComponentStatus = Exclude<HardwareStatus, 'stale'>;

export const HARDWARE_COMPONENT_KEYS = ['disks', 'memory', 'cpu', 'cooling', 'power', 'network'] as const;
export type HardwareComponentKey = (typeof HARDWARE_COMPONENT_KEYS)[number];

export const HARDWARE_COMPONENT_LABELS: Record<HardwareComponentKey, string> = {
  disks: 'Disks',
  memory: 'Memory',
  cpu: 'CPU',
  cooling: 'Cooling',
  power: 'Power',
  network: 'Network',
};

export type HardwareFindingSeverity = 'warning' | 'critical';

/** A single problem found by the evaluator. `code` is a stable string, never reworded. */
export interface HardwareFinding {
  component: HardwareComponentKey;
  /** The `hw.id` attribute of the offending device (disk, DIMM controller, interface, sensor chip...). */
  hwId: string;
  severity: HardwareFindingSeverity;
  /** Stable machine code, e.g. `disk.reallocated_growing`. */
  code: string;
  /** Human readable, ready to render. */
  message: string;
  /** Observed value that tripped the rule, when numeric. */
  value?: number;
  /** Threshold that was crossed, when numeric. */
  threshold?: number;
}

/** Every finding code the evaluator can emit. */
export const HARDWARE_FINDING_CODES = [
  'disk.smart_failed',
  'disk.offline_uncorrectable',
  'disk.critical_warning',
  'disk.spare_low',
  'disk.endurance_critical',
  'disk.reallocated_growing',
  'disk.reallocated',
  'disk.pending_sectors',
  'disk.reported_uncorrect',
  'disk.media_errors_growing',
  'disk.endurance_high',
  'disk.cable_errors',
  'disk.temperature_critical',
  'disk.temperature_high',
  'memory.uncorrected',
  'memory.corrected_surge',
  'memory.corrected',
  'cpu.temperature_critical',
  'cpu.temperature_high',
  'cpu.throttled',
  'cooling.fan_below_limit',
  'cooling.fan_stopped',
  'power.supply_failed',
  'power.voltage_low',
  'power.voltage_high',
  'network.crc_errors',
  'network.link_flapping',
  'network.errors',
] as const;
export type HardwareFindingCode = (typeof HARDWARE_FINDING_CODES)[number];

// ---------------------------------------------------------------------------
// Metric contract
// ---------------------------------------------------------------------------

/** Every metric name the hw-agent emits. */
export const HARDWARE_METRIC_NAMES = [
  'hw.host.info',
  'hw.agent.collector.status',
  'hw.physical_disk.smart_status',
  'hw.physical_disk.smart',
  'hw.physical_disk.endurance_utilization',
  'hw.physical_disk.available_spare',
  'hw.physical_disk.available_spare_threshold',
  'hw.physical_disk.media_errors',
  'hw.physical_disk.critical_warning',
  'hw.temperature',
  'hw.temperature.limit',
  'hw.fan.speed',
  'hw.fan.speed.limit',
  'hw.voltage',
  'hw.voltage.limit',
  'hw.power_supply.status',
  'hw.memory.errors',
  'hw.memory.size',
  'hw.cpu.throttle_count',
  'hw.network.errors',
  'hw.network.carrier_changes',
  'hw.network.up',
] as const;
export type HardwareMetricName = (typeof HARDWARE_METRIC_NAMES)[number];

/** Prefix shared by all hardware metrics (used to detect a hardware batch at ingest). */
export const HARDWARE_METRIC_PREFIX = 'hw.';

/** SMART attributes sent as `hw.physical_disk.smart` with the `smart_attribute` label. */
export const HARDWARE_SMART_ATTRIBUTES = [
  'reallocated_sector_count',
  'current_pending_sector',
  'offline_uncorrectable',
  'reported_uncorrect',
  'udma_crc_error_count',
  'command_timeout',
  'reallocated_event_count',
  'power_on_hours',
] as const;
export type HardwareSmartAttribute = (typeof HARDWARE_SMART_ATTRIBUTES)[number];

/** Collector names reported through `hw.agent.collector.status`. */
export const HARDWARE_COLLECTORS = ['smart', 'edac', 'hwmon', 'ipmi', 'net', 'thermal', 'kmsg', 'sel'] as const;
export type HardwareCollector = (typeof HARDWARE_COLLECTORS)[number];

/**
 * Cumulative-counter series the evaluator needs history for, with the
 * data-point attributes that distinguish one series from another (in addition
 * to `host.name`). Group `aggregateMetrics` by `host.name` + these attributes,
 * with `min` and `max`, over 24 h and 7 d.
 * `hw.fan.speed` is listed because "stopped fan" needs the 24 h max.
 */
export const HARDWARE_HISTORY_SERIES: Readonly<Record<string, readonly string[]>> = {
  'hw.physical_disk.smart': ['hw.id', 'smart_attribute'],
  'hw.physical_disk.media_errors': ['hw.id'],
  'hw.memory.errors': ['hw.id', 'error_type'],
  'hw.cpu.throttle_count': ['hw.id', 'throttle_type'],
  'hw.network.errors': ['hw.id', 'direction', 'error_type'],
  'hw.network.carrier_changes': ['hw.id'],
  'hw.fan.speed': ['hw.id', 'sensor'],
};

// ---------------------------------------------------------------------------
// Timing and thresholds
// ---------------------------------------------------------------------------

/** A host with no hw.* data point for longer than this is `stale`. */
export const HARDWARE_STALE_AFTER_MS = 10 * 60 * 1000;
/** Window of raw points used for the "latest value" of every series. */
export const HARDWARE_LATEST_WINDOW_MS = 15 * 60 * 1000;
export const HARDWARE_WINDOW_24H_MS = 24 * 60 * 60 * 1000;
export const HARDWARE_WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;
/** Evaluation cadence of the backend worker. */
export const HARDWARE_EVALUATION_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Health thresholds. Naming: `...Above` means strictly greater than,
 * `...AtLeast` means greater than or equal, `...Below` strictly lower than.
 */
export const HARDWARE_THRESHOLDS = {
  disk: {
    /** Any reallocated sector is a warning. */
    reallocatedAbove: 0,
    /** Reallocated sectors grew by at least this much in 7 d: critical. */
    reallocatedGrowthCriticalAtLeast7d: 10,
    pendingAbove: 0,
    reportedUncorrectAbove: 0,
    offlineUncorrectableAbove: 0,
    /** NVMe media errors grew in 7 d: warning. */
    mediaErrorsGrowthAbove7d: 0,
    /** UDMA CRC errors grew in 24 h (usually a bad cable): warning. */
    udmaCrcGrowthAbove24h: 0,
    /** Percent of rated endurance used. */
    enduranceWarningAtLeast: 80,
    enduranceCriticalAtLeast: 95,
    /** Degrees Celsius. HDD thresholds also apply to SATA SSDs and SCSI. */
    temperature: {
      hdd: { warningAtLeast: 55, criticalAtLeast: 65 },
      nvme: { warningAtLeast: 70, criticalAtLeast: 80 },
    },
  },
  memory: {
    /** Uncorrected errors since boot, or grown in 7 d: critical. */
    uncorrectedAbove: 0,
    uncorrectedGrowthAbove7d: 0,
    /** Corrected errors grew in 24 h: warning. */
    correctedGrowthWarningAbove24h: 0,
    /** Corrected errors grew by at least this much in 24 h: critical (DIMM degrading fast). */
    correctedGrowthCriticalAtLeast24h: 100,
  },
  cpu: {
    /** Used when the sensor reports no `high` limit. Degrees Celsius. */
    temperatureHighFallback: 85,
    /** Used when the sensor reports no `critical` limit. Degrees Celsius. */
    temperatureCriticalFallback: 95,
    throttleGrowthAbove24h: 0,
  },
  cooling: {
    /** A fan at or below this rpm that reported more in the last 24 h is stopped. */
    stoppedAtMostRpm: 0,
  },
  network: {
    crcGrowthAbove24h: 0,
    carrierChangesAtLeast24h: 5,
    errorsAtLeast24h: 100,
  },
} as const;

// ---------------------------------------------------------------------------
// Component snapshots (what the detail page renders)
// ---------------------------------------------------------------------------

/**
 * A cumulative counter. `total` is the latest raw value; deltas are reset-safe
 * growth over the window, or null when there is not enough history yet.
 */
export interface HardwareCounter {
  total: number;
  delta24h: number | null;
  delta7d: number | null;
}

export interface HardwareDiskAttribute extends HardwareCounter {
  attribute: HardwareSmartAttribute;
}

export interface HardwareDisk {
  hwId: string;
  device: string;
  model: string | null;
  serial: string | null;
  protocol: 'ata' | 'nvme' | 'scsi' | string | null;
  status: HardwareComponentStatus;
  /** true = SMART overall health passed, false = failed, null = not reported. */
  smartStatus: boolean | null;
  attributes: HardwareDiskAttribute[];
  /** Percent of rated endurance used. */
  endurance: number | null;
  /** NVMe available spare, percent. */
  spare: number | null;
  spareThreshold: number | null;
  /** NVMe media and data integrity errors. */
  mediaErrors: HardwareCounter | null;
  /** NVMe critical warning bitmask. */
  criticalWarning: number | null;
  /** Degrees Celsius. */
  temperature: number | null;
}

export interface HardwareDisksSnapshot {
  status: HardwareComponentStatus;
  disks: HardwareDisk[];
}

export interface HardwareMemoryController {
  hwId: string;
  status: HardwareComponentStatus;
  corrected: HardwareCounter;
  uncorrected: HardwareCounter;
  sizeBytes: number | null;
}

export interface HardwareMemorySnapshot {
  status: HardwareComponentStatus;
  /** Sum of every reported `hw.memory.size` series. */
  sizeBytes: number | null;
  controllers: HardwareMemoryController[];
}

export interface HardwareCpuSensor {
  hwId: string;
  sensor: string;
  status: HardwareComponentStatus;
  /** Degrees Celsius. */
  temperature: number;
  /** Reported `high` limit, or null (the evaluator then falls back to the default). */
  high: number | null;
  /** Reported `critical` limit, or null. */
  critical: number | null;
}

export interface HardwareCpuThrottle extends HardwareCounter {
  hwId: string;
}

export interface HardwareCpuSnapshot {
  status: HardwareComponentStatus;
  sensors: HardwareCpuSensor[];
  throttle: HardwareCpuThrottle[];
}

export interface HardwareFan {
  hwId: string;
  sensor: string;
  status: HardwareComponentStatus;
  rpm: number;
  /** `low.critical` limit, or null. */
  lowCritical: number | null;
  /** Highest rpm seen in the last 24 h, or null without history. */
  max24h: number | null;
}

export interface HardwareCoolingSnapshot {
  status: HardwareComponentStatus;
  fans: HardwareFan[];
}

export interface HardwarePowerSupply {
  hwId: string;
  sensor: string;
  status: HardwareComponentStatus;
  ok: boolean;
}

export interface HardwareVoltage {
  hwId: string;
  sensor: string;
  status: HardwareComponentStatus;
  volts: number;
  lowCritical: number | null;
  highCritical: number | null;
}

export interface HardwarePowerSnapshot {
  status: HardwareComponentStatus;
  supplies: HardwarePowerSupply[];
  voltages: HardwareVoltage[];
}

export interface HardwareNetworkInterface {
  hwId: string;
  status: HardwareComponentStatus;
  /** Link up, or null when not reported. */
  up: boolean | null;
  speedMbps: number | null;
  /** Receive + transmit, `error_type=errors`. */
  errors: HardwareCounter;
  /** Receive + transmit, `error_type=crc`. */
  crc: HardwareCounter;
  /** Receive + transmit, `error_type=dropped`. Informational, never raises status. */
  dropped: HardwareCounter;
  carrierChanges: HardwareCounter;
}

export interface HardwareNetworkSnapshot {
  status: HardwareComponentStatus;
  interfaces: HardwareNetworkInterface[];
}

/** Full per-component snapshot of a host. */
export interface HardwareComponentSnapshots {
  disks: HardwareDisksSnapshot;
  memory: HardwareMemorySnapshot;
  cpu: HardwareCpuSnapshot;
  cooling: HardwareCoolingSnapshot;
  power: HardwarePowerSnapshot;
  network: HardwareNetworkSnapshot;
}

// ---------------------------------------------------------------------------
// Host summary / detail (API shapes)
// ---------------------------------------------------------------------------

/** Data of `hw.host.info`. */
export interface HardwareHostInfo {
  vendor: string | null;
  model: string | null;
  kernel: string | null;
  agentVersion: string | null;
}

export interface HardwareCollectorStatus {
  collector: HardwareCollector | string;
  ok: boolean;
}

/** One row of the host list. Dates are ISO strings. */
export interface HardwareHostSummary {
  id: string;
  hostName: string;
  projectId: string;
  status: HardwareStatus;
  components: Record<HardwareComponentKey, HardwareComponentStatus>;
  /** null until the agent reported `hw.host.info`. */
  isVirtual: boolean | null;
  info: HardwareHostInfo;
  lastSeenAt: string | null;
  statusChangedAt: string;
  muted: boolean;
  findingsCount: number;
}

/** GET /api/v1/hardware/hosts/:id. */
export interface HardwareHostDetail extends HardwareHostSummary {
  firstSeenAt: string;
  lastEvaluatedAt: string | null;
  snapshot: HardwareComponentSnapshots;
  findings: HardwareFinding[];
  collectors: HardwareCollectorStatus[];
}

/** GET /api/v1/hardware/hosts?projectId=. */
export interface HardwareHostListResponse {
  hosts: HardwareHostSummary[];
}

/** One 7 day trend line on the host detail page (hourly buckets). */
export interface HardwareSeries {
  /** Stable key, e.g. `memory.corrected:mc0` or `disk.reallocated_sector_count:sda`. */
  key: string;
  component: HardwareComponentKey;
  metric: string;
  hwId: string;
  label: string;
  unit: string;
  points: Array<{ time: string; value: number }>;
}

/** GET /api/v1/hardware/hosts/:id. */
export interface HardwareHostDetailResponse {
  host: HardwareHostDetail;
  series: HardwareSeries[];
}

/** One hardware event (log with service `hardware` for this host). */
export interface HardwareEvent {
  id: string;
  time: string;
  level: string;
  message: string;
  eventType: string | null;
  eventSource: string | null;
}

/** GET /api/v1/hardware/hosts/:id/events?limit= (last 7 days, newest first). */
export interface HardwareEventsResponse {
  events: HardwareEvent[];
}

/** PATCH /api/v1/hardware/hosts/:id body. */
export interface HardwareHostUpdateInput {
  muted: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<HardwareStatus, number> = {
  unknown: 0,
  ok: 1,
  stale: 2,
  warning: 3,
  critical: 4,
};

/** Worst of a list of statuses. `unknown` never beats a known status; empty = `unknown`. */
export function worstHardwareStatus<T extends HardwareStatus>(statuses: readonly T[]): T | 'unknown' {
  let worst: T | 'unknown' = 'unknown';
  for (const s of statuses) {
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  }
  return worst;
}

export function isHardwareMetric(name: string): boolean {
  return name.startsWith(HARDWARE_METRIC_PREFIX);
}
