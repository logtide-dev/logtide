// Test fixtures shared by the hardware component and page tests.
import type {
  HardwareEvent,
  HardwareHostDetail,
  HardwareHostDetailResponse,
  HardwareHostSummary,
  HardwareSeries,
} from '@logtide/shared';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export function summary(over: Partial<HardwareHostSummary> = {}): HardwareHostSummary {
  return {
    id: 'h-ok',
    hostName: 'web-01',
    projectId: 'p1',
    status: 'ok',
    components: { disks: 'ok', memory: 'ok', cpu: 'ok', cooling: 'ok', power: 'ok', network: 'ok' },
    isVirtual: false,
    info: { vendor: 'Dell Inc.', model: 'PowerEdge R640', kernel: '6.8.0-45-generic', agentVersion: '1.0.0' },
    lastSeenAt: ago(30_000),
    statusChangedAt: ago(86_400_000),
    muted: false,
    findingsCount: 0,
    ...over,
  };
}

export const criticalHost = summary({
  id: 'h-crit',
  hostName: 'db-01',
  status: 'critical',
  components: { disks: 'critical', memory: 'warning', cpu: 'ok', cooling: 'ok', power: 'ok', network: 'ok' },
  findingsCount: 3,
});

export const vmHost = summary({
  id: 'h-vm',
  hostName: 'vm-07',
  status: 'unknown',
  isVirtual: true,
  info: { vendor: null, model: null, kernel: '6.1.0', agentVersion: '1.0.0' },
  components: {
    disks: 'unknown',
    memory: 'unknown',
    cpu: 'unknown',
    cooling: 'unknown',
    power: 'unknown',
    network: 'ok',
  },
});

export const staleHost = summary({
  id: 'h-stale',
  hostName: 'old-nas',
  status: 'stale',
  lastSeenAt: ago(3 * 3_600_000),
  muted: true,
});

export const hostList = [summary(), criticalHost, vmHost, staleHost];

const zero = { total: 0, delta24h: 0, delta7d: 0 };

export function detail(over: Partial<HardwareHostDetail> = {}): HardwareHostDetail {
  return {
    ...criticalHost,
    firstSeenAt: ago(30 * 86_400_000),
    lastEvaluatedAt: ago(60_000),
    findings: [
      {
        component: 'disks',
        hwId: 'sda',
        severity: 'critical',
        code: 'disk.reallocated_growing',
        message: 'Disk sda reallocated 14 sectors in the last 7 days',
        value: 14,
        threshold: 10,
      },
      {
        component: 'memory',
        hwId: 'mc0',
        severity: 'warning',
        code: 'memory.corrected',
        message: 'Memory controller mc0 corrected 3 errors in the last 24 hours',
        value: 3,
        threshold: 0,
      },
      {
        component: 'disks',
        hwId: 'sdb',
        severity: 'warning',
        code: 'disk.temperature_high',
        message: 'Disk sdb is at 58 C',
      },
    ],
    collectors: [
      { collector: 'smart', ok: true },
      { collector: 'edac', ok: true },
      { collector: 'ipmi', ok: false },
    ],
    snapshot: {
      disks: {
        status: 'critical',
        missing: [{ hwId: 'sdc', sensor: null, metric: 'hw.physical_disk.smart_status' }],
        disks: [
          {
            hwId: 'sda',
            device: '/dev/sda',
            model: 'ST4000NM0035',
            serial: 'ZC1ABC',
            protocol: 'ata',
            status: 'critical',
            smartStatus: false,
            attributes: [
              { attribute: 'reallocated_sector_count', total: 24, delta24h: 4, delta7d: 14 },
              { attribute: 'current_pending_sector', total: 2, delta24h: 0, delta7d: 2 },
              { attribute: 'offline_uncorrectable', total: 0, delta24h: 0, delta7d: 0 },
            ],
            endurance: null,
            spare: null,
            spareThreshold: null,
            mediaErrors: null,
            criticalWarning: null,
            temperature: 41,
          },
          {
            hwId: 'nvme0',
            device: '/dev/nvme0n1',
            model: 'Samsung 980 PRO',
            serial: null,
            protocol: 'nvme',
            status: 'warning',
            smartStatus: true,
            attributes: [],
            endurance: 83,
            spare: 96,
            spareThreshold: 10,
            mediaErrors: zero,
            criticalWarning: 0,
            temperature: 52,
          },
        ],
      },
      memory: {
        status: 'warning',
        sizeBytes: 64 * 1024 ** 3,
        controllers: [
          {
            hwId: 'mc0',
            status: 'warning',
            corrected: { total: 7, delta24h: 3, delta7d: 7 },
            uncorrected: zero,
            sizeBytes: 32 * 1024 ** 3,
          },
          {
            hwId: 'mc1-dimm0',
            status: 'ok',
            scope: 'dimm',
            controller: 'mc1',
            dimmLabel: 'DIMM_B1',
            corrected: zero,
            uncorrected: zero,
            sizeBytes: 32 * 1024 ** 3,
          },
        ],
      },
      cpu: {
        status: 'ok',
        sensors: [{ hwId: 'coretemp-isa-0000', sensor: 'Package id 0', status: 'ok', temperature: 54, high: 90, critical: 100 }],
        throttle: [{ hwId: 'cpu0', total: 0, delta24h: 0, delta7d: 0 }],
      },
      cooling: {
        status: 'ok',
        fans: [{ hwId: 'ipmi', sensor: 'Fan1', status: 'ok', rpm: 5400, lowCritical: 1200, max24h: 5600 }],
        temperatures: [
          { hwId: 'ipmi', sensor: 'Inlet Temp', type: 'board', status: 'ok', temperature: 24, high: 42, critical: 47 },
        ],
      },
      power: {
        status: 'ok',
        supplies: [
          { hwId: 'ipmi', sensor: 'PS1 Status', status: 'ok', ok: true },
          { hwId: 'ipmi', sensor: 'PS2 Status', status: 'ok', ok: true },
        ],
        voltages: [
          { hwId: 'ipmi', sensor: '12V', status: 'ok', volts: 12.06, low: 11.4, high: 12.6, lowCritical: 10.8, highCritical: 13.2 },
        ],
      },
      network: {
        status: 'ok',
        interfaces: [
          {
            hwId: 'eth0',
            status: 'ok',
            up: true,
            speedMbps: 10000,
            errors: zero,
            crc: zero,
            dropped: { total: 4, delta24h: 1, delta7d: 4 },
            carrierChanges: { total: 1, delta24h: 0, delta7d: 0 },
          },
          {
            hwId: 'eth1',
            status: 'ok',
            up: false,
            speedMbps: null,
            errors: zero,
            crc: zero,
            dropped: zero,
            carrierChanges: zero,
          },
        ],
      },
    },
    ...over,
  };
}

export const memorySeries: HardwareSeries = {
  key: 'memory.corrected:mc0',
  component: 'memory',
  metric: 'hw.memory.errors',
  hwId: 'mc0',
  label: 'mc0 corrected errors',
  unit: 'errors',
  points: [
    { time: ago(3 * 3_600_000), value: 1 },
    { time: ago(2 * 3_600_000), value: 4 },
    { time: ago(3_600_000), value: 7 },
  ],
};

export const diskSeries: HardwareSeries = {
  key: 'disk.reallocated_sector_count:sda',
  component: 'disks',
  metric: 'hw.physical_disk.smart',
  hwId: 'sda',
  label: 'sda reallocated sectors',
  unit: 'sectors',
  points: [
    { time: ago(2 * 3_600_000), value: 10 },
    { time: ago(3_600_000), value: 24 },
  ],
};

export function detailResponse(over: Partial<HardwareHostDetail> = {}): HardwareHostDetailResponse {
  return { host: detail(over), series: [memorySeries, diskSeries] };
}

export const events: HardwareEvent[] = [
  {
    id: 'e1',
    time: ago(3_600_000),
    level: 'error',
    message: 'EDAC MC0: 1 CE memory read error on CPU_SrcID#0_Ha#0_Chan#1_DIMM#0',
    eventType: 'memory_ecc',
    eventSource: 'kmsg',
  },
  {
    id: 'e2',
    time: ago(7_200_000),
    level: 'warn',
    message: 'ata1.00: failed command: READ FPDMA QUEUED',
    eventType: 'disk_io',
    eventSource: 'kmsg',
  },
];
