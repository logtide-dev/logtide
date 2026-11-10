/**
 * Hardware health evaluator.
 *
 * PURE: no database, no clock, no reservoir. The worker feeds it
 *  - `latest`: raw `hw.*` data points of the last ~15 min for one host
 *    (several points per series are fine, the newest wins), from
 *    `reservoir.queryMetrics`;
 *  - `history`: min/max over 24 h and 7 d per series of the cumulative
 *    counters, from `reservoir.aggregateMetrics` grouped by `host.name` plus the
 *    attributes listed in `HARDWARE_HISTORY_SERIES` (one aggregate call per
 *    window and per function, merged into one entry per series).
 *
 * Counter deltas are reset-safe: counters only grow, so a latest value below the
 * window max means the counter was reset (reboot, driver reload) inside the
 * window. In that case the latest value is the growth since the reset and is
 * used as the delta. Otherwise the delta is `latest - min`.
 */
import {
  HARDWARE_COMPONENT_KEYS,
  HARDWARE_COMPONENT_LABELS,
  HARDWARE_DEBOUNCE,
  HARDWARE_HISTORY_SERIES,
  HARDWARE_SMART_ATTRIBUTES,
  HARDWARE_STALE_AFTER_MS,
  HARDWARE_THRESHOLDS,
  worstHardwareStatus,
} from '@logtide/shared';
import type {
  HardwareCollectorStatus,
  HardwareComponentKey,
  HardwareComponentSnapshots,
  HardwareComponentStatus,
  HardwareCoolingSnapshot,
  HardwareCounter,
  HardwareCpuSnapshot,
  HardwareDisk,
  HardwareDisksSnapshot,
  HardwareFan,
  HardwareFinding,
  HardwareFindingCode,
  HardwareHostInfo,
  HardwareMemoryController,
  HardwareMemorySnapshot,
  HardwareMissingDevice,
  HardwareThermalSensor,
  HardwareNetworkInterface,
  HardwareNetworkSnapshot,
  HardwarePowerSnapshot,
  HardwareSmartAttribute,
  HardwareStatus,
} from '@logtide/shared';

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export type HardwareAttributeValue = string | number | boolean | null | undefined;

/** One raw data point of a `hw.*` metric (data-point attributes, incl. `hw.id`). */
export interface HardwareLatestPoint {
  metric: string;
  attributes: Record<string, HardwareAttributeValue>;
  value: number;
  time: Date;
}

/**
 * min/max of one cumulative series (or fan speed series) over 24 h and 7 d.
 * `attributes` needs at least the keys of `HARDWARE_HISTORY_SERIES[metric]`;
 * extra keys (e.g. `host.name`) are ignored. null = no point in that window.
 */
export interface HardwareHistoryEntry {
  metric: string;
  attributes: Record<string, HardwareAttributeValue>;
  min24h: number | null;
  max24h: number | null;
  min7d: number | null;
  max7d: number | null;
}

export interface EvaluateHostInput {
  latest: HardwareLatestPoint[];
  history: HardwareHistoryEntry[];
  now: Date;
  /** `last_seen_at` of the host registry row (updated at ingest), if known. */
  lastSeenAt: Date | null;
  /**
   * True when the latest window may miss points (truncated load): devices
   * that look gone and dead collectors are then not reported.
   */
  partial?: boolean;
}

export interface EvaluateHostResult {
  /** Worst component, or `stale` / `unknown` (see below). */
  status: HardwareStatus;
  components: HardwareComponentSnapshots;
  findings: HardwareFinding[];
  /** null until `hw.host.info` was seen. */
  isVirtual: boolean | null;
  info: HardwareHostInfo;
  collectors: HardwareCollectorStatus[];
  /** Newest of `lastSeenAt` and the newest data point, null when neither exists. */
  lastSeenAt: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T = HARDWARE_THRESHOLDS;

function attr(attrs: Record<string, HardwareAttributeValue>, key: string): string | null {
  const v = attrs[key];
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? null : s;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * Attributes that identify a series, per metric. Other attributes (speed_mbps,
 * model, os.kernel...) may drift between points and must not split a series.
 */
const SENSOR_IDENTITY = ['hw.type', 'hw.id', 'sensor'];
const SERIES_IDENTITY: Record<string, readonly string[]> = {
  'hw.host.info': [],
  'hw.agent.collector.status': ['collector'],
  'hw.physical_disk.smart_status': ['hw.id'],
  'hw.physical_disk.smart': ['hw.id', 'smart_attribute'],
  'hw.physical_disk.endurance_utilization': ['hw.id'],
  'hw.physical_disk.available_spare': ['hw.id'],
  'hw.physical_disk.available_spare_threshold': ['hw.id'],
  'hw.physical_disk.media_errors': ['hw.id'],
  'hw.physical_disk.critical_warning': ['hw.id'],
  'hw.temperature': SENSOR_IDENTITY,
  'hw.temperature.limit': [...SENSOR_IDENTITY, 'limit_type'],
  'hw.fan.speed': ['hw.id', 'sensor'],
  'hw.fan.speed.limit': ['hw.id', 'sensor', 'limit_type'],
  'hw.voltage': ['hw.id', 'sensor'],
  'hw.voltage.limit': ['hw.id', 'sensor', 'limit_type'],
  'hw.power_supply.status': ['hw.id', 'sensor'],
  'hw.memory.errors': ['hw.id', 'scope', 'error_type'],
  'hw.memory.size': ['hw.id'],
  'hw.cpu.throttle_count': ['hw.id', 'throttle_type'],
  'hw.network.errors': ['hw.id', 'direction', 'error_type'],
  'hw.network.carrier_changes': ['hw.id'],
  'hw.network.up': ['hw.id'],
};

function seriesKey(metric: string, attrs: Record<string, HardwareAttributeValue>): string {
  const keys = SERIES_IDENTITY[metric] ?? Object.keys(attrs).filter((k) => k !== 'host.name').sort();
  return `${metric}\u0000${keys.map((k) => attr(attrs, k) ?? '').join('\u0001')}`;
}

/** Which collector feeds which component, and which history metrics prove the component had data. */
const COLLECTOR_COMPONENTS: Record<string, HardwareComponentKey[]> = {
  smart: ['disks'],
  edac: ['memory'],
  net: ['network'],
  thermal: ['cpu'],
  hwmon: ['cooling'],
  ipmi: ['cooling', 'power'],
};
const COMPONENT_HISTORY_METRICS: Record<HardwareComponentKey, readonly string[]> = {
  disks: ['hw.physical_disk.smart_status', 'hw.physical_disk.smart', 'hw.physical_disk.media_errors'],
  memory: ['hw.memory.errors'],
  cpu: ['hw.cpu.throttle_count'],
  cooling: ['hw.fan.speed'],
  power: ['hw.power_supply.status'],
  network: ['hw.network.up', 'hw.network.errors', 'hw.network.carrier_changes'],
};

function historyKey(metric: string, attrs: Record<string, HardwareAttributeValue>): string | null {
  const keys = HARDWARE_HISTORY_SERIES[metric];
  if (!keys) return null;
  return `${metric}\u0000${keys.map((k) => attr(attrs, k) ?? '').join('\u0001')}`;
}

/** Reset-safe growth of a cumulative counter over one window. */
export function counterDelta(latest: number, min: number | null, max: number | null): number | null {
  if (min === null || max === null) return null;
  if (latest < max) return Math.max(latest, 0); // counter was reset inside the window
  return Math.max(latest - min, 0);
}

function sumCounters(counters: HardwareCounter[]): HardwareCounter {
  const sumNullable = (vals: (number | null)[]): number | null => {
    const known = vals.filter((v): v is number => v !== null);
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
  };
  return {
    total: counters.reduce((a, c) => a + c.total, 0),
    delta24h: sumNullable(counters.map((c) => c.delta24h)),
    delta7d: sumNullable(counters.map((c) => c.delta7d)),
  };
}

function maxCounters(counters: HardwareCounter[]): HardwareCounter {
  const maxNullable = (vals: (number | null)[]): number | null => {
    const known = vals.filter((v): v is number => v !== null);
    return known.length === 0 ? null : Math.max(...known);
  };
  return {
    total: Math.max(...counters.map((c) => c.total)),
    delta24h: maxNullable(counters.map((c) => c.delta24h)),
    delta7d: maxNullable(counters.map((c) => c.delta7d)),
  };
}

const EMPTY_COUNTER: HardwareCounter ={ total: 0, delta24h: null, delta7d: null };

function worstComponentStatus(statuses: HardwareComponentStatus[]): HardwareComponentStatus {
  return worstHardwareStatus(statuses) as HardwareComponentStatus;
}

// ---------------------------------------------------------------------------
// Evaluation context
// ---------------------------------------------------------------------------

class Context {
  readonly points: HardwareLatestPoint[];
  private readonly historyIndex = new Map<string, { min24h: number | null; max24h: number | null; min7d: number | null; max7d: number | null }>();
  /** Identity attributes of every history series, by key. */
  private readonly historyAttrs = new Map<string, { metric: string; attributes: Record<string, HardwareAttributeValue> }>();
  readonly findings: HardwareFinding[] = [];

  constructor(latest: HardwareLatestPoint[], history: HardwareHistoryEntry[]) {
    // Keep the newest point per series, ignore non-finite values.
    const newest = new Map<string, HardwareLatestPoint>();
    for (const p of latest) {
      if (!Number.isFinite(p.value)) continue;
      const k = seriesKey(p.metric, p.attributes);
      const cur = newest.get(k);
      if (!cur || p.time.getTime() >= cur.time.getTime()) newest.set(k, p);
    }
    this.points = [...newest.values()];

    const merge = (a: number | null, b: number | null, fn: (x: number, y: number) => number): number | null =>
      a === null ? b : b === null ? a : fn(a, b);
    for (const h of history) {
      const k = historyKey(h.metric, h.attributes);
      if (!k) continue;
      const cur = this.historyIndex.get(k);
      this.historyAttrs.set(k, { metric: h.metric, attributes: h.attributes });
      this.historyIndex.set(
        k,
        cur
          ? {
              min24h: merge(cur.min24h, h.min24h, Math.min),
              max24h: merge(cur.max24h, h.max24h, Math.max),
              min7d: merge(cur.min7d, h.min7d, Math.min),
              max7d: merge(cur.max7d, h.max7d, Math.max),
            }
          : { min24h: h.min24h, max24h: h.max24h, min7d: h.min7d, max7d: h.max7d }
      );
    }
  }

  byMetric(metric: string): HardwareLatestPoint[] {
    return this.points.filter((p) => p.metric === metric);
  }

  history(p: HardwareLatestPoint) {
    const k = historyKey(p.metric, p.attributes);
    return k ? this.historyIndex.get(k) ?? null : null;
  }

  /** True when any history series of these metrics saw data in the last 24 h. */
  hadData(metrics: readonly string[]): boolean {
    for (const [k, a] of this.historyAttrs) {
      if (!metrics.includes(a.metric)) continue;
      const h = this.historyIndex.get(k)!;
      if (h.min24h !== null || h.max24h !== null) return true;
    }
    return false;
  }

  /** History series of a metric seen in the last 24 h that have no point in the latest data. */
  vanished(metric: string): Array<{ hwId: string; sensor: string | null }> {
    const present = new Set(this.byMetric(metric).map((p) => historyKey(p.metric, p.attributes)));
    const out: Array<{ hwId: string; sensor: string | null }> = [];
    for (const [k, a] of this.historyAttrs) {
      if (a.metric !== metric || present.has(k)) continue;
      const h = this.historyIndex.get(k)!;
      if (h.min24h === null && h.max24h === null) continue;
      out.push({ hwId: attr(a.attributes, 'hw.id') ?? '', sensor: attr(a.attributes, 'sensor') });
    }
    return out.sort((x, y) => (x.hwId + (x.sensor ?? '')).localeCompare(y.hwId + (y.sensor ?? '')));
  }

  counter(p: HardwareLatestPoint): HardwareCounter {
    const h = this.history(p);
    return {
      total: p.value,
      delta24h: h ? counterDelta(p.value, h.min24h, h.max24h) : null,
      delta7d: h ? counterDelta(p.value, h.min7d, h.max7d) : null,
    };
  }

  add(f: HardwareFinding): void {
    this.findings.push(f);
  }
}

function hwIdOf(p: HardwareLatestPoint): string {
  return attr(p.attributes, 'hw.id') ?? attr(p.attributes, 'device') ?? attr(p.attributes, 'sensor') ?? '';
}

function sensorOf(p: HardwareLatestPoint): string {
  return attr(p.attributes, 'sensor') ?? '';
}

function sensorKey(p: HardwareLatestPoint): string {
  return `${hwIdOf(p)}\u0000${sensorOf(p)}`;
}

function statusFromFindings(findings: HardwareFinding[]): HardwareComponentStatus {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.length > 0) return 'warning';
  return 'ok';
}

function finding(
  component: HardwareComponentKey,
  hwId: string,
  severity: HardwareFinding['severity'],
  code: HardwareFindingCode,
  message: string,
  value?: number,
  threshold?: number
): HardwareFinding {
  const f: HardwareFinding = { component, hwId, severity, code, message };
  if (value !== undefined) f.value = value;
  if (threshold !== undefined) f.threshold = threshold;
  return f;
}

// ---------------------------------------------------------------------------
// Disks
// ---------------------------------------------------------------------------

function evaluateDisks(ctx: Context): HardwareDisksSnapshot {
  // A disk exists only if the smart collector reported it. Temperature series
  // of hw.ids without smart data (e.g. hwmon drivetemp chips) never create one.
  const ids = new Set<string>();
  for (const p of ctx.points) if (p.metric.startsWith('hw.physical_disk.')) ids.add(hwIdOf(p));
  const diskPoints = ctx.points.filter(
    (p) =>
      p.metric.startsWith('hw.physical_disk.') ||
      (p.metric === 'hw.temperature' && attr(p.attributes, 'hw.type') === 'physical_disk' && ids.has(hwIdOf(p)))
  );

  const disks: HardwareDisk[] = [];
  for (const hwId of [...ids].sort()) {
    const own = diskPoints.filter((p) => hwIdOf(p) === hwId);
    const first = (metric: string) => own.find((p) => p.metric === metric);
    const idPoint = first('hw.physical_disk.smart_status') ?? own[0];
    const protocol = attr(idPoint.attributes, 'protocol') ?? own.map((p) => attr(p.attributes, 'protocol')).find((v) => v) ?? null;
    const device = attr(idPoint.attributes, 'device') ?? own.map((p) => attr(p.attributes, 'device')).find((v) => v) ?? hwId;
    const model = own.map((p) => attr(p.attributes, 'model')).find((v) => v) ?? null;
    const serial = own.map((p) => attr(p.attributes, 'serial')).find((v) => v) ?? null;

    const smartPoint = first('hw.physical_disk.smart_status');
    const smartStatus = smartPoint ? smartPoint.value !== 0 : null;

    const attributes = own
      .filter((p) => p.metric === 'hw.physical_disk.smart')
      .map((p) => ({ name: attr(p.attributes, 'smart_attribute') as HardwareSmartAttribute | null, counter: ctx.counter(p) }))
      .filter((a): a is { name: HardwareSmartAttribute; counter: HardwareCounter } => a.name !== null)
      .sort(
        (a, b) =>
          HARDWARE_SMART_ATTRIBUTES.indexOf(a.name) - HARDWARE_SMART_ATTRIBUTES.indexOf(b.name)
      )
      .map((a) => ({ attribute: a.name, ...a.counter }));
    const attrOf = (name: HardwareSmartAttribute) => attributes.find((a) => a.attribute === name);

    const endurance = first('hw.physical_disk.endurance_utilization')?.value ?? null;
    const spare = first('hw.physical_disk.available_spare')?.value ?? null;
    const spareThreshold = first('hw.physical_disk.available_spare_threshold')?.value ?? null;
    const mediaPoint = first('hw.physical_disk.media_errors');
    const mediaErrors = mediaPoint ? ctx.counter(mediaPoint) : null;
    const criticalWarning = first('hw.physical_disk.critical_warning')?.value ?? null;
    const temps = own.filter((p) => p.metric === 'hw.temperature').map((p) => p.value);
    const temperature = temps.length > 0 ? Math.max(...temps) : null;

    const found: HardwareFinding[] = [];
    const add = (f: HardwareFinding) => found.push(f);
    const name = device;
    const d = T.disk;

    if (smartStatus === false) {
      add(finding('disks', hwId, 'critical', 'disk.smart_failed', `${name} failed its SMART overall health check`, 0, 1));
    }
    const offline = attrOf('offline_uncorrectable');
    if (offline && offline.total > d.offlineUncorrectableAbove) {
      add(finding('disks', hwId, 'critical', 'disk.offline_uncorrectable', `${name} has ${fmt(offline.total)} offline uncorrectable sectors`, offline.total, d.offlineUncorrectableAbove));
    }
    if (criticalWarning !== null && criticalWarning !== 0) {
      add(finding('disks', hwId, 'critical', 'disk.critical_warning', `${name} reports an NVMe critical warning (flags 0x${Math.trunc(criticalWarning).toString(16)})`, criticalWarning, 0));
    }
    if (spare !== null && spareThreshold !== null && spare < spareThreshold) {
      add(finding('disks', hwId, 'critical', 'disk.spare_low', `${name} available spare is ${fmt(spare)}%, below its ${fmt(spareThreshold)}% threshold`, spare, spareThreshold));
    }
    if (endurance !== null && endurance >= d.enduranceCriticalAtLeast) {
      add(finding('disks', hwId, 'critical', 'disk.endurance_critical', `${name} has used ${fmt(endurance)}% of its rated endurance`, endurance, d.enduranceCriticalAtLeast));
    } else if (endurance !== null && endurance >= d.enduranceWarningAtLeast) {
      add(finding('disks', hwId, 'warning', 'disk.endurance_high', `${name} has used ${fmt(endurance)}% of its rated endurance`, endurance, d.enduranceWarningAtLeast));
    }

    const realloc = attrOf('reallocated_sector_count');
    if (realloc && realloc.delta7d !== null && realloc.delta7d >= d.reallocatedGrowthCriticalAtLeast7d) {
      add(finding('disks', hwId, 'critical', 'disk.reallocated_growing', `${name} reallocated ${fmt(realloc.delta7d)} sectors in the last 7 days (${fmt(realloc.total)} in total)`, realloc.delta7d, d.reallocatedGrowthCriticalAtLeast7d));
    } else if (realloc && realloc.total > d.reallocatedAbove) {
      add(finding('disks', hwId, 'warning', 'disk.reallocated', `${name} has ${fmt(realloc.total)} reallocated sectors`, realloc.total, d.reallocatedAbove));
    }
    const pending = attrOf('current_pending_sector');
    if (pending && pending.total > d.pendingAbove) {
      add(finding('disks', hwId, 'warning', 'disk.pending_sectors', `${name} has ${fmt(pending.total)} sectors pending reallocation`, pending.total, d.pendingAbove));
    }
    const reported = attrOf('reported_uncorrect');
    if (reported && reported.total > d.reportedUncorrectAbove) {
      add(finding('disks', hwId, 'warning', 'disk.reported_uncorrect', `${name} reported ${fmt(reported.total)} uncorrectable read errors`, reported.total, d.reportedUncorrectAbove));
    }
    if (mediaErrors && mediaErrors.delta7d !== null && mediaErrors.delta7d > d.mediaErrorsGrowthAbove7d) {
      add(finding('disks', hwId, 'warning', 'disk.media_errors_growing', `${name} logged ${fmt(mediaErrors.delta7d)} new media errors in the last 7 days`, mediaErrors.delta7d, d.mediaErrorsGrowthAbove7d));
    }
    const crc = attrOf('udma_crc_error_count');
    if (crc && crc.delta24h !== null && crc.delta24h > d.udmaCrcGrowthAbove24h) {
      add(finding('disks', hwId, 'warning', 'disk.cable_errors', `${name} logged ${fmt(crc.delta24h)} new UDMA CRC errors in the last 24 hours, check the cable`, crc.delta24h, d.udmaCrcGrowthAbove24h));
    }
    if (temperature !== null) {
      const limits = protocol === 'nvme' ? d.temperature.nvme : d.temperature.hdd;
      if (temperature >= limits.criticalAtLeast) {
        add(finding('disks', hwId, 'critical', 'disk.temperature_critical', `${name} is at ${fmt(temperature)} °C (critical at ${fmt(limits.criticalAtLeast)} °C)`, temperature, limits.criticalAtLeast));
      } else if (temperature >= limits.warningAtLeast) {
        add(finding('disks', hwId, 'warning', 'disk.temperature_high', `${name} is at ${fmt(temperature)} °C (warning at ${fmt(limits.warningAtLeast)} °C)`, temperature, limits.warningAtLeast));
      }
    }

    found.forEach((f) => ctx.add(f));
    disks.push({
      hwId,
      device,
      model,
      serial,
      protocol,
      status: statusFromFindings(found),
      smartStatus,
      attributes,
      endurance,
      spare,
      spareThreshold,
      mediaErrors,
      criticalWarning,
      temperature,
    });
  }

  return {
    status: disks.length === 0 ? 'unknown' : worstComponentStatus(disks.map((x) => x.status)),
    disks,
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function evaluateMemory(ctx: Context): HardwareMemorySnapshot {
  const allErrorPoints = ctx.byMetric('hw.memory.errors');
  const scopeOf = (p: HardwareLatestPoint) => (attr(p.attributes, 'scope') === 'dimm' ? 'dimm' : 'controller');
  const controllerOf = (p: HardwareLatestPoint) => attr(p.attributes, 'controller') ?? hwIdOf(p).split('/')[0];
  // When DIMM-level points exist for a controller, its controller-level points are redundant.
  const withDimms = new Set(allErrorPoints.filter((p) => scopeOf(p) === 'dimm').map(controllerOf));
  const errorPoints = allErrorPoints.filter((p) => scopeOf(p) === 'dimm' || !withDimms.has(hwIdOf(p)));
  const sizePoints = ctx.byMetric('hw.memory.size');
  const ids = [...new Set(errorPoints.map(hwIdOf))].sort();
  const m = T.memory;

  const controllers: HardwareMemoryController[] = ids.map((hwId) => {
    const own = errorPoints.filter((p) => hwIdOf(p) === hwId);
    const scope = scopeOf(own[0]);
    const dimmLabel = own.map((p) => attr(p.attributes, 'dimm_label')).find((v) => v) ?? null;
    const name = scope === 'dimm' ? `DIMM ${dimmLabel ?? hwId}` : `Memory controller ${hwId}`;
    const of = (type: string) => own.filter((p) => attr(p.attributes, 'error_type') === type).map((p) => ctx.counter(p));
    const corrected = of('corrected').length > 0 ? sumCounters(of('corrected')) : EMPTY_COUNTER;
    const uncorrected = of('uncorrected').length > 0 ? sumCounters(of('uncorrected')) : EMPTY_COUNTER;
    const size = sizePoints.filter((p) => hwIdOf(p) === hwId);
    const sizeBytes = size.length > 0 ? size.reduce((a, p) => a + p.value, 0) : null;

    const found: HardwareFinding[] = [];
    const uncorrected7d = uncorrected.delta7d ?? 0;
    if (uncorrected.total > m.uncorrectedAbove || uncorrected7d > m.uncorrectedGrowthAbove7d) {
      const v = Math.max(uncorrected.total, uncorrected7d);
      found.push(finding('memory', hwId, 'critical', 'memory.uncorrected', `${name} logged ${fmt(v)} uncorrectable errors`, v, m.uncorrectedAbove));
    }
    const c24 = corrected.delta24h;
    if (c24 !== null && c24 >= m.correctedGrowthCriticalAtLeast24h) {
      found.push(finding('memory', hwId, 'critical', 'memory.corrected_surge', `${name} logged ${fmt(c24)} corrected errors in the last 24 hours, a DIMM is degrading fast`, c24, m.correctedGrowthCriticalAtLeast24h));
    } else if (c24 !== null && c24 > m.correctedGrowthWarningAbove24h) {
      found.push(finding('memory', hwId, 'warning', 'memory.corrected', `${name} logged ${fmt(c24)} corrected errors in the last 24 hours`, c24, m.correctedGrowthWarningAbove24h));
    }
    found.forEach((f) => ctx.add(f));
    return {
      hwId,
      status: statusFromFindings(found),
      corrected,
      uncorrected,
      sizeBytes,
      scope,
      controller: controllerOf(own[0]),
      dimmLabel,
    };
  });

  return {
    status: controllers.length === 0 ? 'unknown' : worstComponentStatus(controllers.map((c) => c.status)),
    sizeBytes: sizePoints.length > 0 ? sizePoints.reduce((a, p) => a + p.value, 0) : null,
    controllers,
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

function evaluateCpu(ctx: Context): HardwareCpuSnapshot {
  const c = T.cpu;
  const temps = ctx.byMetric('hw.temperature').filter((p) => attr(p.attributes, 'hw.type') === 'cpu');
  const limits = ctx.byMetric('hw.temperature.limit');
  const limitOf = (p: HardwareLatestPoint, type: string): number | null => {
    const l = limits.find((x) => sensorKey(x) === sensorKey(p) && attr(x.attributes, 'limit_type') === type);
    return l ? l.value : null;
  };

  const sensors = temps
    .map((p) => {
      const high = limitOf(p, 'high');
      const critical = limitOf(p, 'critical');
      const highLimit = high ?? c.temperatureHighFallback;
      const critLimit = critical ?? c.temperatureCriticalFallback;
      const hwId = hwIdOf(p);
      const label = sensorOf(p) ? `${hwId} ${sensorOf(p)}`.trim() : hwId;
      const found: HardwareFinding[] = [];
      if (p.value >= critLimit) {
        found.push(finding('cpu', hwId, 'critical', 'cpu.temperature_critical', `CPU sensor ${label} is at ${fmt(p.value)} °C (critical at ${fmt(critLimit)} °C)`, p.value, critLimit));
      } else if (p.value >= highLimit) {
        found.push(finding('cpu', hwId, 'warning', 'cpu.temperature_high', `CPU sensor ${label} is at ${fmt(p.value)} °C (high at ${fmt(highLimit)} °C)`, p.value, highLimit));
      }
      found.forEach((f) => ctx.add(f));
      return { hwId, sensor: sensorOf(p), status: statusFromFindings(found), temperature: p.value, high, critical };
    })
    .sort((a, b) => (a.hwId + a.sensor).localeCompare(b.hwId + b.sensor));

  const throttlePoints = ctx.byMetric('hw.cpu.throttle_count');
  const throttleIds = [...new Set(throttlePoints.map(hwIdOf))].sort();
  const throttle = throttleIds.map((hwId) => {
    // core and package events overlap, so take the larger instead of summing
    const sum = maxCounters(throttlePoints.filter((p) => hwIdOf(p) === hwId).map((p) => ctx.counter(p)));
    if (sum.delta24h !== null && sum.delta24h > c.throttleGrowthAbove24h) {
      ctx.add(finding('cpu', hwId, 'warning', 'cpu.throttled', `CPU ${hwId} was thermally throttled ${fmt(sum.delta24h)} times in the last 24 hours`, sum.delta24h, c.throttleGrowthAbove24h));
    }
    return { hwId, ...sum };
  });

  const throttleStatus = (hwId: string): HardwareComponentStatus =>
    ctx.findings.some((f) => f.component === 'cpu' && f.code === 'cpu.throttled' && f.hwId === hwId) ? 'warning' : 'ok';
  const statuses = [...sensors.map((s) => s.status), ...throttle.map((t) => throttleStatus(t.hwId))];

  return {
    status: statuses.length === 0 ? 'unknown' : worstComponentStatus(statuses),
    sensors,
    throttle,
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Cooling
// ---------------------------------------------------------------------------

function evaluateCooling(ctx: Context): HardwareCoolingSnapshot {
  const limits = ctx.byMetric('hw.fan.speed.limit');
  const fans: HardwareFan[] = ctx
    .byMetric('hw.fan.speed')
    .map((p) => {
      const hwId = hwIdOf(p);
      const sensor = sensorOf(p);
      const label = sensor ? `${hwId} ${sensor}`.trim() : hwId;
      const lim = limits.find((x) => sensorKey(x) === sensorKey(p) && attr(x.attributes, 'limit_type') === 'low.critical');
      const lowCritical = lim ? lim.value : null;
      const max24h = ctx.history(p)?.max24h ?? null;
      const found: HardwareFinding[] = [];
      if (lowCritical !== null && p.value < lowCritical) {
        found.push(finding('cooling', hwId, 'critical', 'cooling.fan_below_limit', `Fan ${label} runs at ${fmt(p.value)} rpm, below its ${fmt(lowCritical)} rpm limit`, p.value, lowCritical));
      } else if (p.value <= T.cooling.stoppedAtMostRpm && max24h !== null && max24h > T.cooling.stoppedAtMostRpm) {
        found.push(finding('cooling', hwId, 'critical', 'cooling.fan_stopped', `Fan ${label} stopped (it ran at up to ${fmt(max24h)} rpm in the last 24 hours)`, p.value, T.cooling.stoppedAtMostRpm));
      }
      found.forEach((f) => ctx.add(f));
      return { hwId, sensor, status: statusFromFindings(found), rpm: p.value, lowCritical, max24h };
    })
    .sort((a, b) => (a.hwId + a.sensor).localeCompare(b.hwId + b.sensor));

  // Board, memory, GPU and other temperatures: only judged against their own limits.
  const tempLimits = ctx.byMetric('hw.temperature.limit');
  const temperatures: HardwareThermalSensor[] = ctx
    .byMetric('hw.temperature')
    .filter((p) => {
      const t = attr(p.attributes, 'hw.type');
      return t !== 'cpu' && t !== 'physical_disk';
    })
    .map((p) => {
      const hwId = hwIdOf(p);
      const sensor = sensorOf(p);
      const label = sensor ? `${hwId} ${sensor}`.trim() : hwId;
      const limit = (type: string) => {
        const l = tempLimits.find((x) => sensorKey(x) === sensorKey(p) && attr(x.attributes, 'limit_type') === type);
        return l ? l.value : null;
      };
      const high = limit('high');
      const critical = limit('critical');
      const found: HardwareFinding[] = [];
      if (critical !== null && p.value >= critical) {
        found.push(finding('cooling', hwId, 'critical', 'cooling.temperature_critical', `Sensor ${label} is at ${fmt(p.value)} °C (critical at ${fmt(critical)} °C)`, p.value, critical));
      } else if (high !== null && p.value >= high) {
        found.push(finding('cooling', hwId, 'warning', 'cooling.temperature_high', `Sensor ${label} is at ${fmt(p.value)} °C (high at ${fmt(high)} °C)`, p.value, high));
      }
      found.forEach((f) => ctx.add(f));
      return { hwId, sensor, type: attr(p.attributes, 'hw.type') ?? 'other', status: statusFromFindings(found), temperature: p.value, high, critical };
    })
    .sort((a, b) => (a.hwId + a.sensor).localeCompare(b.hwId + b.sensor));

  const statuses = [...fans.map((f) => f.status), ...temperatures.map((t) => t.status)];
  return {
    status: statuses.length === 0 ? 'unknown' : worstComponentStatus(statuses),
    fans,
    temperatures,
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

function evaluatePower(ctx: Context): HardwarePowerSnapshot {
  const supplies = ctx
    .byMetric('hw.power_supply.status')
    .map((p) => {
      const hwId = hwIdOf(p);
      const sensor = sensorOf(p);
      const label = sensor || hwId;
      const ok = p.value !== 0;
      if (!ok) {
        ctx.add(finding('power', hwId, 'critical', 'power.supply_failed', `Power supply ${label} reports a failure`, 0, 1));
      }
      return { hwId, sensor, status: (ok ? 'ok' : 'critical') as HardwareComponentStatus, ok };
    })
    .sort((a, b) => (a.hwId + a.sensor).localeCompare(b.hwId + b.sensor));

  const limits = ctx.byMetric('hw.voltage.limit');
  const voltages = ctx
    .byMetric('hw.voltage')
    .map((p) => {
      const hwId = hwIdOf(p);
      const sensor = sensorOf(p);
      const label = sensor ? `${hwId} ${sensor}`.trim() : hwId;
      const find = (type: string) => {
        const l = limits.find((x) => sensorKey(x) === sensorKey(p) && attr(x.attributes, 'limit_type') === type);
        return l ? l.value : null;
      };
      const low = find('low');
      const high = find('high');
      const lowCritical = find('low.critical');
      const highCritical = find('high.critical');
      let status: HardwareComponentStatus = 'ok';
      const flag = (severity: 'warning' | 'critical', code: 'power.voltage_low' | 'power.voltage_high', limit: number) => {
        status = severity;
        const dir = code === 'power.voltage_low' ? 'below' : 'above';
        ctx.add(finding('power', hwId, severity, code, `Voltage ${label} is ${fmt(p.value)} V, ${dir} its ${severity === 'critical' ? 'critical ' : ''}limit of ${fmt(limit)} V`, p.value, limit));
      };
      if (lowCritical !== null && p.value < lowCritical) flag('critical', 'power.voltage_low', lowCritical);
      else if (highCritical !== null && p.value > highCritical) flag('critical', 'power.voltage_high', highCritical);
      else if (low !== null && p.value < low) flag('warning', 'power.voltage_low', low);
      else if (high !== null && p.value > high) flag('warning', 'power.voltage_high', high);
      return { hwId, sensor, status, volts: p.value, low, high, lowCritical, highCritical };
    })
    .sort((a, b) => (a.hwId + a.sensor).localeCompare(b.hwId + b.sensor));

  const statuses = [...supplies.map((s) => s.status), ...voltages.map((v) => v.status)];
  return {
    status: statuses.length === 0 ? 'unknown' : worstComponentStatus(statuses),
    supplies,
    voltages,
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function evaluateNetwork(ctx: Context): HardwareNetworkSnapshot {
  const n = T.network;
  const errorPoints = ctx.byMetric('hw.network.errors');
  const carrierPoints = ctx.byMetric('hw.network.carrier_changes');
  const upPoints = ctx.byMetric('hw.network.up');
  const ids = [...new Set([...errorPoints, ...carrierPoints, ...upPoints].map(hwIdOf))].sort();

  const interfaces: HardwareNetworkInterface[] = ids.map((hwId) => {
    const errs = errorPoints.filter((p) => hwIdOf(p) === hwId);
    const of = (type: string): HardwareCounter => {
      const cs = errs.filter((p) => attr(p.attributes, 'error_type') === type).map((p) => ctx.counter(p));
      return cs.length > 0 ? sumCounters(cs) : EMPTY_COUNTER;
    };
    const errors = of('errors');
    const crc = of('crc');
    const dropped = of('dropped');
    const carrier = carrierPoints.filter((p) => hwIdOf(p) === hwId).map((p) => ctx.counter(p));
    const carrierChanges = carrier.length > 0 ? sumCounters(carrier) : EMPTY_COUNTER;
    const upPoint = upPoints.find((p) => hwIdOf(p) === hwId);
    const speed = upPoint ? Number(attr(upPoint.attributes, 'speed_mbps')) : NaN;

    const found: HardwareFinding[] = [];
    if (crc.delta24h !== null && crc.delta24h > n.crcGrowthAbove24h) {
      found.push(finding('network', hwId, 'warning', 'network.crc_errors', `Interface ${hwId} logged ${fmt(crc.delta24h)} CRC errors in the last 24 hours, check the cable`, crc.delta24h, n.crcGrowthAbove24h));
    }
    if (carrierChanges.delta24h !== null && carrierChanges.delta24h >= n.carrierChangesAtLeast24h) {
      found.push(finding('network', hwId, 'warning', 'network.link_flapping', `Interface ${hwId} changed link state ${fmt(carrierChanges.delta24h)} times in the last 24 hours`, carrierChanges.delta24h, n.carrierChangesAtLeast24h));
    }
    if (errors.delta24h !== null && errors.delta24h >= n.errorsAtLeast24h) {
      found.push(finding('network', hwId, 'warning', 'network.errors', `Interface ${hwId} logged ${fmt(errors.delta24h)} packet errors in the last 24 hours`, errors.delta24h, n.errorsAtLeast24h));
    }
    found.forEach((f) => ctx.add(f));
    return {
      hwId,
      status: statusFromFindings(found),
      up: upPoint ? upPoint.value !== 0 : null,
      speedMbps: Number.isFinite(speed) ? speed : null,
      errors,
      crc,
      dropped,
      carrierChanges,
    };
  });

  return {
    status: interfaces.length === 0 ? 'unknown' : worstComponentStatus(interfaces.map((i) => i.status)),
    interfaces,
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

function parseBool(v: string | null): boolean | null {
  if (v === null) return null;
  const s = v.toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}

/**
 * A collector reporting 0 is confirmed down once it has reported 0 for
 * HARDWARE_DEBOUNCE.collectorDownAfterMs since its last non zero point. When
 * the window holds no non zero point, when it went down is unknown and the
 * host status debounce is the only guard.
 */
function collectorDownLongEnough(latest: HardwareLatestPoint[], collector: string, now: Date): boolean {
  const points = latest
    .filter((p) => p.metric === 'hw.agent.collector.status' && attr(p.attributes, 'collector') === collector && Number.isFinite(p.value))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  let lastUp = -1;
  points.forEach((p, i) => {
    if (p.value !== 0) lastUp = i;
  });
  if (lastUp === -1) return true;
  const firstDown = points[lastUp + 1];
  if (!firstDown) return false;
  return now.getTime() - firstDown.time.getTime() >= HARDWARE_DEBOUNCE.collectorDownAfterMs;
}

/** Per-component status map, handy for the host list. */
export function componentStatuses(components: HardwareComponentSnapshots): Record<HardwareComponentKey, HardwareComponentStatus> {
  const out = {} as Record<HardwareComponentKey, HardwareComponentStatus>;
  for (const key of HARDWARE_COMPONENT_KEYS) out[key] = components[key].status;
  return out;
}

export function evaluateHost(input: EvaluateHostInput): EvaluateHostResult {
  const ctx = new Context(input.latest, input.history);

  const components: HardwareComponentSnapshots = {
    disks: evaluateDisks(ctx),
    memory: evaluateMemory(ctx),
    cpu: evaluateCpu(ctx),
    cooling: evaluateCooling(ctx),
    power: evaluatePower(ctx),
    network: evaluateNetwork(ctx),
  };

  // Host info and collectors.
  const infoPoint = ctx.byMetric('hw.host.info').sort((a, b) => b.time.getTime() - a.time.getTime())[0];
  const info: HardwareHostInfo = {
    vendor: infoPoint ? attr(infoPoint.attributes, 'hw.vendor') : null,
    model: infoPoint ? attr(infoPoint.attributes, 'hw.model') : null,
    kernel: infoPoint ? attr(infoPoint.attributes, 'os.kernel') : null,
    agentVersion: infoPoint ? attr(infoPoint.attributes, 'agent.version') : null,
  };
  const isVirtual = infoPoint ? parseBool(attr(infoPoint.attributes, 'hw.virtual')) : null;
  const collectors: HardwareCollectorStatus[] = ctx
    .byMetric('hw.agent.collector.status')
    .map((p) => ({ collector: attr(p.attributes, 'collector') ?? '', ok: p.value !== 0 }))
    .filter((c) => c.collector !== '')
    .sort((a, b) => a.collector.localeCompare(b.collector));

  // Staleness: newest of the registry timestamp and the newest data point.
  const times = [...ctx.points.map((p) => p.time.getTime()), ...(input.lastSeenAt ? [input.lastSeenAt.getTime()] : [])];
  const lastSeenMs = times.length > 0 ? Math.max(...times) : null;
  const lastSeenAt = lastSeenMs === null ? null : new Date(lastSeenMs);

  const stale = lastSeenMs !== null && input.now.getTime() - lastSeenMs > HARDWARE_STALE_AFTER_MS;

  // Gone devices and dead collectors are only judged on a complete, non
  // empty latest window: no point at all (or a truncated load) is no new
  // information, not proof that everything vanished.
  const complete = !input.partial && ctx.points.length > 0;

  // Collector reporting 0 now although its component had data in the last 24 h.
  const downComponents = new Set<HardwareComponentKey>();
  const confirmedDown = new Set<HardwareComponentKey>();
  if (lastSeenMs !== null && !stale && complete) {
    for (const c of collectors) {
      if (c.ok) continue;
      const confirmed = collectorDownLongEnough(input.latest, c.collector, input.now);
      for (const comp of COLLECTOR_COMPONENTS[c.collector] ?? []) {
        if (!ctx.hadData(COMPONENT_HISTORY_METRICS[comp])) continue;
        // Its devices are not "missing" while the collector reports 0, even
        // before the down state is confirmed.
        downComponents.add(comp);
        if (!confirmed) continue;
        confirmedDown.add(comp);
        ctx.add(finding(comp, c.collector, 'warning', 'agent.collector_down', `The ${c.collector} collector of the agent stopped reporting, ${HARDWARE_COMPONENT_LABELS[comp].toLowerCase()} data is missing`));
      }
    }

    // Devices seen in the last 24 h that disappeared from the latest data.
    const missing = (comp: HardwareComponentKey, metric: string, code: HardwareFindingCode, noun: string): HardwareMissingDevice[] => {
      if (downComponents.has(comp)) return [];
      const list = ctx.vanished(metric);
      for (const m of list) {
        const label = m.sensor ? `${m.hwId} ${m.sensor}`.trim() : m.hwId;
        ctx.add(finding(comp, m.hwId, 'warning', code, `${noun} ${label} was reporting in the last 24 hours but is gone`));
      }
      return list.map((m) => ({ hwId: m.hwId, sensor: m.sensor, metric }));
    };
    components.disks.missing = missing('disks', 'hw.physical_disk.smart_status', 'disk.missing', 'Disk');
    components.power.missing = missing('power', 'hw.power_supply.status', 'power.psu_missing', 'Power supply');
    components.cooling.missing = missing('cooling', 'hw.fan.speed', 'cooling.fan_missing', 'Fan');
    components.network.missing = missing('network', 'hw.network.up', 'network.interface_missing', 'Interface');

    // A component with a missing device or a dead collector is never ok or unknown.
    const raise = (comp: HardwareComponentKey) => {
      const c = components[comp];
      if (c.status === 'ok' || c.status === 'unknown') c.status = 'warning';
    };
    for (const comp of HARDWARE_COMPONENT_KEYS) if ((components[comp].missing ?? []).length > 0) raise(comp);
    confirmedDown.forEach(raise);
  }

  const findings = [...ctx.findings].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    const ca = HARDWARE_COMPONENT_KEYS.indexOf(a.component);
    const cb = HARDWARE_COMPONENT_KEYS.indexOf(b.component);
    if (ca !== cb) return ca - cb;
    return a.hwId.localeCompare(b.hwId) || a.code.localeCompare(b.code);
  });

  let status: HardwareStatus;
  if (lastSeenMs === null) {
    status = 'unknown';
  } else if (stale) {
    status = 'stale';
  } else {
    status = worstHardwareStatus(HARDWARE_COMPONENT_KEYS.map((k) => components[k].status));
  }

  return { status, components, findings, isVirtual, info, collectors, lastSeenAt };
}
