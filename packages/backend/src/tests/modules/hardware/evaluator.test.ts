import { describe, it, expect } from 'vitest';
import {
  counterDelta,
  componentStatuses,
  evaluateHost,
  type HardwareAttributeValue,
  type HardwareHistoryEntry,
  type HardwareLatestPoint,
} from '../../../modules/hardware/evaluator.js';

// Pure unit tests, no database.

const NOW = new Date('2026-11-10T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

type Attrs = Record<string, HardwareAttributeValue>;

function pt(metric: string, value: number, attributes: Attrs = {}, time: Date = NOW): HardwareLatestPoint {
  return { metric, value, attributes: { 'host.name': 'srv1', ...attributes }, time };
}

/** History entry for a series; pass partial windows. */
function hist(
  metric: string,
  attributes: Attrs,
  w: { min24h?: number | null; max24h?: number | null; min7d?: number | null; max7d?: number | null }
): HardwareHistoryEntry {
  return {
    metric,
    attributes: { 'host.name': 'srv1', ...attributes },
    min24h: w.min24h ?? null,
    max24h: w.max24h ?? null,
    min7d: w.min7d ?? null,
    max7d: w.max7d ?? null,
  };
}

function run(latest: HardwareLatestPoint[], history: HardwareHistoryEntry[] = [], lastSeenAt: Date | null = NOW) {
  return evaluateHost({ latest, history, now: NOW, lastSeenAt });
}

const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => f.code);

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const disk = (extra: Attrs = {}): Attrs => ({
  'hw.type': 'physical_disk',
  'hw.id': 'sda',
  device: '/dev/sda',
  model: 'ST4000',
  serial: 'ZZ1',
  protocol: 'ata',
  ...extra,
});
const smart = (name: string, value: number, extra: Attrs = {}) =>
  pt('hw.physical_disk.smart', value, disk({ smart_attribute: name, ...extra }));
const smartHist = (name: string, w: Parameters<typeof hist>[2], extra: Attrs = {}) =>
  hist('hw.physical_disk.smart', { 'hw.id': 'sda', smart_attribute: name, ...extra }, w);

const nvme = (extra: Attrs = {}): Attrs => ({
  'hw.type': 'physical_disk',
  'hw.id': 'nvme0',
  device: '/dev/nvme0',
  model: 'WD',
  serial: 'N1',
  protocol: 'nvme',
  ...extra,
});

const memErr = (hwId: string, type: 'corrected' | 'uncorrected', value: number) =>
  pt('hw.memory.errors', value, { 'hw.type': 'memory', 'hw.id': hwId, error_type: type });
const memHist = (hwId: string, type: string, w: Parameters<typeof hist>[2]) =>
  hist('hw.memory.errors', { 'hw.id': hwId, error_type: type }, w);

const cpuTemp = (value: number, extra: Attrs = {}) =>
  pt('hw.temperature', value, { 'hw.type': 'cpu', 'hw.id': 'coretemp', sensor: 'Package id 0', ...extra });
const cpuLimit = (value: number, type: 'high' | 'critical') =>
  pt('hw.temperature.limit', value, { 'hw.type': 'cpu', 'hw.id': 'coretemp', sensor: 'Package id 0', limit_type: type });

const fan = (value: number, sensor = 'fan1') => pt('hw.fan.speed', value, { 'hw.type': 'fan', 'hw.id': 'bmc', sensor });
const fanLimit = (value: number, sensor = 'fan1') =>
  pt('hw.fan.speed.limit', value, { 'hw.type': 'fan', 'hw.id': 'bmc', sensor, limit_type: 'low.critical' });
const fanHist = (w: Parameters<typeof hist>[2], sensor = 'fan1') => hist('hw.fan.speed', { 'hw.id': 'bmc', sensor }, w);

const psu = (value: number, sensor = 'PS1 Status') =>
  pt('hw.power_supply.status', value, { 'hw.type': 'power_supply', 'hw.id': 'bmc', sensor });
const volt = (value: number, sensor = '12V') => pt('hw.voltage', value, { 'hw.type': 'voltage', 'hw.id': 'bmc', sensor });
const voltLimit = (value: number, type: 'low.critical' | 'high.critical', sensor = '12V') =>
  pt('hw.voltage.limit', value, { 'hw.type': 'voltage', 'hw.id': 'bmc', sensor, limit_type: type });

const netErr = (iface: string, type: 'errors' | 'crc' | 'dropped', direction: 'receive' | 'transmit', value: number) =>
  pt('hw.network.errors', value, { 'hw.type': 'network', 'hw.id': iface, direction, error_type: type });
const netErrHist = (iface: string, type: string, direction: string, w: Parameters<typeof hist>[2]) =>
  hist('hw.network.errors', { 'hw.id': iface, direction, error_type: type }, w);
const carrier = (iface: string, value: number) => pt('hw.network.carrier_changes', value, { 'hw.type': 'network', 'hw.id': iface });
const carrierHist = (iface: string, w: Parameters<typeof hist>[2]) => hist('hw.network.carrier_changes', { 'hw.id': iface }, w);

// ---------------------------------------------------------------------------
// counterDelta
// ---------------------------------------------------------------------------

describe('counterDelta', () => {
  it('is latest minus window min when the counter only grew', () => {
    expect(counterDelta(120, 100, 120)).toBe(20);
  });

  it('is zero for a flat counter', () => {
    expect(counterDelta(50, 50, 50)).toBe(0);
  });

  it('uses the latest value as delta after a counter reset', () => {
    // 100 -> reboot -> 5
    expect(counterDelta(5, 0, 100)).toBe(5);
    expect(counterDelta(5, 3, 100)).toBe(5);
  });

  it('is null without history', () => {
    expect(counterDelta(5, null, null)).toBeNull();
    expect(counterDelta(5, 1, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disks
// ---------------------------------------------------------------------------

describe('disks', () => {
  it('is ok for a healthy disk', () => {
    const r = run([
      pt('hw.physical_disk.smart_status', 1, disk()),
      smart('reallocated_sector_count', 0),
      smart('current_pending_sector', 0),
      pt('hw.temperature', 35, disk({ sensor: 'Temperature_Celsius' })),
    ]);
    expect(r.components.disks.status).toBe('ok');
    expect(r.findings).toEqual([]);
    expect(r.status).toBe('ok');
    const d = r.components.disks.disks[0];
    expect(d).toMatchObject({ hwId: 'sda', device: '/dev/sda', model: 'ST4000', serial: 'ZZ1', protocol: 'ata', smartStatus: true, temperature: 35 });
    expect(d.attributes.map((a) => a.attribute)).toEqual(['reallocated_sector_count', 'current_pending_sector']);
  });

  it('is unknown without disk data', () => {
    const r = run([pt('hw.host.info', 1, { 'hw.type': 'host' })]);
    expect(r.components.disks.status).toBe('unknown');
    expect(r.components.disks.disks).toEqual([]);
  });

  it('smart_status 0 is critical', () => {
    const r = run([pt('hw.physical_disk.smart_status', 0, disk())]);
    expect(codes(r)).toEqual(['disk.smart_failed']);
    expect(r.findings[0]).toMatchObject({ component: 'disks', hwId: 'sda', severity: 'critical' });
    expect(r.components.disks.disks[0].smartStatus).toBe(false);
    expect(r.status).toBe('critical');
  });

  describe('offline_uncorrectable', () => {
    it('> 0 is critical', () => {
      expect(codes(run([smart('offline_uncorrectable', 1)]))).toEqual(['disk.offline_uncorrectable']);
    });
    it('0 is fine', () => {
      expect(codes(run([smart('offline_uncorrectable', 0)]))).toEqual([]);
    });
  });

  describe('nvme critical_warning', () => {
    it('non zero bitmask is critical', () => {
      const r = run([pt('hw.physical_disk.critical_warning', 4, nvme())]);
      expect(codes(r)).toEqual(['disk.critical_warning']);
      expect(r.findings[0].value).toBe(4);
    });
    it('zero is fine', () => {
      expect(codes(run([pt('hw.physical_disk.critical_warning', 0, nvme())]))).toEqual([]);
    });
  });

  describe('available spare', () => {
    it('below threshold is critical', () => {
      const r = run([
        pt('hw.physical_disk.available_spare', 9, nvme()),
        pt('hw.physical_disk.available_spare_threshold', 10, nvme()),
      ]);
      expect(codes(r)).toEqual(['disk.spare_low']);
      expect(r.findings[0]).toMatchObject({ value: 9, threshold: 10 });
    });
    it('equal to threshold is fine', () => {
      const r = run([
        pt('hw.physical_disk.available_spare', 10, nvme()),
        pt('hw.physical_disk.available_spare_threshold', 10, nvme()),
      ]);
      expect(codes(r)).toEqual([]);
    });
    it('without threshold is not evaluated', () => {
      expect(codes(run([pt('hw.physical_disk.available_spare', 1, nvme())]))).toEqual([]);
    });
  });

  describe('endurance', () => {
    const e = (v: number) => run([pt('hw.physical_disk.endurance_utilization', v, nvme())]);
    it('79 is fine', () => expect(codes(e(79))).toEqual([]));
    it('80 is a warning', () => {
      const r = e(80);
      expect(codes(r)).toEqual(['disk.endurance_high']);
      expect(r.findings[0].severity).toBe('warning');
    });
    it('94 is still a warning', () => expect(codes(e(94))).toEqual(['disk.endurance_high']));
    it('95 is critical', () => {
      const r = e(95);
      expect(codes(r)).toEqual(['disk.endurance_critical']);
      expect(r.findings[0].severity).toBe('critical');
    });
  });

  describe('reallocated sectors', () => {
    it('0 is fine', () => {
      expect(codes(run([smart('reallocated_sector_count', 0)], [smartHist('reallocated_sector_count', { min7d: 0, max7d: 0 })]))).toEqual([]);
    });
    it('> 0 and stable is a warning', () => {
      const r = run([smart('reallocated_sector_count', 8)], [smartHist('reallocated_sector_count', { min7d: 8, max7d: 8 })]);
      expect(codes(r)).toEqual(['disk.reallocated']);
      expect(r.findings[0].severity).toBe('warning');
    });
    it('growth of 9 in 7d is still a warning', () => {
      const r = run([smart('reallocated_sector_count', 19)], [smartHist('reallocated_sector_count', { min7d: 10, max7d: 19 })]);
      expect(codes(r)).toEqual(['disk.reallocated']);
    });
    it('growth of 10 in 7d is critical (and replaces the plain warning)', () => {
      const r = run([smart('reallocated_sector_count', 20)], [smartHist('reallocated_sector_count', { min7d: 10, max7d: 20 })]);
      expect(codes(r)).toEqual(['disk.reallocated_growing']);
      expect(r.findings[0]).toMatchObject({ severity: 'critical', value: 10, threshold: 10 });
    });
    it('works without history (warning only)', () => {
      expect(codes(run([smart('reallocated_sector_count', 50)]))).toEqual(['disk.reallocated']);
    });
  });

  it('pending sectors > 0 is a warning, 0 is fine', () => {
    expect(codes(run([smart('current_pending_sector', 1)]))).toEqual(['disk.pending_sectors']);
    expect(codes(run([smart('current_pending_sector', 0)]))).toEqual([]);
  });

  it('reported_uncorrect > 0 is a warning, 0 is fine', () => {
    expect(codes(run([smart('reported_uncorrect', 3)]))).toEqual(['disk.reported_uncorrect']);
    expect(codes(run([smart('reported_uncorrect', 0)]))).toEqual([]);
  });

  describe('nvme media errors', () => {
    it('grew in 7d is a warning', () => {
      const r = run(
        [pt('hw.physical_disk.media_errors', 5, nvme())],
        [hist('hw.physical_disk.media_errors', { 'hw.id': 'nvme0' }, { min7d: 4, max7d: 5 })]
      );
      expect(codes(r)).toEqual(['disk.media_errors_growing']);
      expect(r.components.disks.disks[0].mediaErrors).toEqual({ total: 5, delta24h: null, delta7d: 1 });
    });
    it('stable (even if non zero) is fine', () => {
      const r = run(
        [pt('hw.physical_disk.media_errors', 5, nvme())],
        [hist('hw.physical_disk.media_errors', { 'hw.id': 'nvme0' }, { min7d: 5, max7d: 5 })]
      );
      expect(codes(r)).toEqual([]);
    });
    it('without history is fine', () => {
      expect(codes(run([pt('hw.physical_disk.media_errors', 5, nvme())]))).toEqual([]);
    });
  });

  describe('udma crc (cable)', () => {
    it('grew in 24h is a warning', () => {
      const r = run([smart('udma_crc_error_count', 12)], [smartHist('udma_crc_error_count', { min24h: 10, max24h: 12 })]);
      expect(codes(r)).toEqual(['disk.cable_errors']);
      expect(r.findings[0].value).toBe(2);
    });
    it('old, stable crc errors are fine', () => {
      const r = run([smart('udma_crc_error_count', 12)], [smartHist('udma_crc_error_count', { min24h: 12, max24h: 12, min7d: 5, max7d: 12 })]);
      expect(codes(r)).toEqual([]);
    });
  });

  describe('temperature', () => {
    const hddTemp = (v: number) => run([pt('hw.physical_disk.smart_status', 1, disk()), pt('hw.temperature', v, disk({ sensor: 't' }))]);
    const nvmeTemp = (v: number) => run([pt('hw.physical_disk.smart_status', 1, nvme()), pt('hw.temperature', v, nvme({ sensor: 'Composite' }))]);

    it('hdd 54 ok, 55 warning, 64 warning, 65 critical', () => {
      expect(codes(hddTemp(54))).toEqual([]);
      expect(codes(hddTemp(55))).toEqual(['disk.temperature_high']);
      expect(codes(hddTemp(64))).toEqual(['disk.temperature_high']);
      expect(codes(hddTemp(65))).toEqual(['disk.temperature_critical']);
    });
    it('nvme 69 ok, 70 warning, 79 warning, 80 critical', () => {
      expect(codes(nvmeTemp(69))).toEqual([]);
      expect(codes(nvmeTemp(70))).toEqual(['disk.temperature_high']);
      expect(codes(nvmeTemp(79))).toEqual(['disk.temperature_high']);
      expect(codes(nvmeTemp(80))).toEqual(['disk.temperature_critical']);
    });
    it('uses the hottest sensor of the disk', () => {
      const r = run([
        pt('hw.physical_disk.smart_status', 1, nvme()),
        pt('hw.temperature', 30, nvme({ sensor: 'Sensor 1' })),
        pt('hw.temperature', 72, nvme({ sensor: 'Composite' })),
      ]);
      expect(r.components.disks.disks[0].temperature).toBe(72);
      expect(codes(r)).toEqual(['disk.temperature_high']);
    });
  });

  it('keeps several disks apart and reports the worst', () => {
    const r = run([
      pt('hw.physical_disk.smart_status', 1, disk()),
      pt('hw.physical_disk.smart_status', 0, disk({ 'hw.id': 'sdb', device: '/dev/sdb' })),
    ]);
    expect(r.components.disks.disks.map((d) => [d.hwId, d.status])).toEqual([
      ['sda', 'ok'],
      ['sdb', 'critical'],
    ]);
    expect(r.components.disks.status).toBe('critical');
    expect(r.findings[0].hwId).toBe('sdb');
  });

  it('uses the newest point of a series', () => {
    const r = run([
      pt('hw.physical_disk.smart_status', 0, disk(), minutesAgo(10)),
      pt('hw.physical_disk.smart_status', 1, disk(), minutesAgo(1)),
    ]);
    expect(r.components.disks.disks[0].smartStatus).toBe(true);
    expect(r.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

describe('memory', () => {
  it('is unknown without EDAC data (size alone does not count)', () => {
    const r = run([pt('hw.memory.size', 16e9, { 'hw.type': 'memory' })]);
    expect(r.components.memory.status).toBe('unknown');
    expect(r.components.memory.sizeBytes).toBe(16e9);
  });

  it('is ok with zero errors', () => {
    const r = run([memErr('mc0', 'corrected', 0), memErr('mc0', 'uncorrected', 0)]);
    expect(r.components.memory.status).toBe('ok');
    expect(r.components.memory.controllers[0]).toMatchObject({ hwId: 'mc0', status: 'ok' });
  });

  describe('uncorrected', () => {
    it('> 0 since boot is critical', () => {
      const r = run([memErr('mc0', 'corrected', 0), memErr('mc0', 'uncorrected', 1)]);
      expect(codes(r)).toEqual(['memory.uncorrected']);
      expect(r.findings[0]).toMatchObject({ severity: 'critical', hwId: 'mc0', value: 1, threshold: 0 });
      expect(r.status).toBe('critical');
    });
    it('a reset back to 0 with no new errors is fine', () => {
      const r = run([memErr('mc0', 'uncorrected', 0)], [memHist('mc0', 'uncorrected', { min7d: 0, max7d: 3 })]);
      expect(codes(r)).toEqual([]);
    });
    it('after reset with new errors is critical', () => {
      const r = run([memErr('mc0', 'uncorrected', 2)], [memHist('mc0', 'uncorrected', { min7d: 0, max7d: 3 })]);
      expect(codes(r)).toEqual(['memory.uncorrected']);
    });
  });

  describe('corrected 24h', () => {
    const c = (latest: number, min24h: number, max24h = latest) =>
      run([memErr('mc0', 'corrected', latest)], [memHist('mc0', 'corrected', { min24h, max24h })]);

    it('no growth is fine even when the total is high', () => {
      expect(codes(c(500, 500))).toEqual([]);
    });
    it('growth of 1 is a warning', () => {
      const r = c(501, 500);
      expect(codes(r)).toEqual(['memory.corrected']);
      expect(r.findings[0]).toMatchObject({ severity: 'warning', value: 1, threshold: 0 });
    });
    it('growth of 99 is a warning', () => {
      expect(codes(c(199, 100))).toEqual(['memory.corrected']);
    });
    it('growth of 100 is critical', () => {
      const r = c(200, 100);
      expect(codes(r)).toEqual(['memory.corrected_surge']);
      expect(r.findings[0]).toMatchObject({ severity: 'critical', value: 100, threshold: 100 });
    });
    it('is not evaluated without history', () => {
      expect(codes(run([memErr('mc0', 'corrected', 1000)]))).toEqual([]);
    });
    it('exposes 24h and 7d deltas', () => {
      const r = run([memErr('mc0', 'corrected', 30)], [memHist('mc0', 'corrected', { min24h: 25, max24h: 30, min7d: 10, max7d: 30 })]);
      expect(r.components.memory.controllers[0].corrected).toEqual({ total: 30, delta24h: 5, delta7d: 20 });
    });
  });

  it('keeps controllers apart and attaches sizes by hw.id', () => {
    const r = run([
      memErr('mc0', 'corrected', 0),
      memErr('mc1', 'uncorrected', 2),
      pt('hw.memory.size', 8e9, { 'hw.type': 'memory', 'hw.id': 'mc0' }),
      pt('hw.memory.size', 8e9, { 'hw.type': 'memory', 'hw.id': 'mc1' }),
    ]);
    expect(r.components.memory.controllers.map((x) => [x.hwId, x.status, x.sizeBytes])).toEqual([
      ['mc0', 'ok', 8e9],
      ['mc1', 'critical', 8e9],
    ]);
    expect(r.components.memory.sizeBytes).toBe(16e9);
  });
});

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

describe('cpu', () => {
  it('is unknown without cpu data', () => {
    expect(run([]).components.cpu.status).toBe('unknown');
  });

  describe('temperature with sensor limits', () => {
    const t = (v: number) => run([cpuTemp(v), cpuLimit(80, 'high'), cpuLimit(100, 'critical')]);
    it('below high is ok', () => expect(codes(t(79))).toEqual([]));
    it('at high is a warning', () => {
      const r = t(80);
      expect(codes(r)).toEqual(['cpu.temperature_high']);
      expect(r.findings[0]).toMatchObject({ severity: 'warning', value: 80, threshold: 80 });
    });
    it('between high and critical stays a warning', () => expect(codes(t(99))).toEqual(['cpu.temperature_high']));
    it('at critical is critical', () => {
      const r = t(100);
      expect(codes(r)).toEqual(['cpu.temperature_critical']);
      expect(r.findings[0].severity).toBe('critical');
    });
    it('exposes the limits on the sensor', () => {
      expect(t(50).components.cpu.sensors[0]).toMatchObject({ high: 80, critical: 100, temperature: 50, status: 'ok' });
    });
  });

  describe('temperature fallback 85/95 without limits', () => {
    it('84 ok, 85 warning, 94 warning, 95 critical', () => {
      expect(codes(run([cpuTemp(84)]))).toEqual([]);
      expect(codes(run([cpuTemp(85)]))).toEqual(['cpu.temperature_high']);
      expect(codes(run([cpuTemp(94)]))).toEqual(['cpu.temperature_high']);
      expect(codes(run([cpuTemp(95)]))).toEqual(['cpu.temperature_critical']);
    });
    it('uses the fallback only for the missing limit', () => {
      // only a high limit of 70 reported: critical falls back to 95
      expect(codes(run([cpuTemp(75), cpuLimit(70, 'high')]))).toEqual(['cpu.temperature_high']);
      expect(codes(run([cpuTemp(95), cpuLimit(70, 'high')]))).toEqual(['cpu.temperature_critical']);
    });
  });

  it('limits only apply to the sensor they belong to', () => {
    const r = run([
      cpuTemp(90, { sensor: 'Core 0' }),
      pt('hw.temperature.limit', 99, { 'hw.type': 'cpu', 'hw.id': 'coretemp', sensor: 'Core 1', limit_type: 'high' }),
    ]);
    expect(codes(r)).toEqual(['cpu.temperature_high']); // fallback 85 applied to Core 0
  });

  it('ignores non cpu temperatures for the cpu component', () => {
    const r = run([pt('hw.temperature', 99, { 'hw.type': 'board', 'hw.id': 'acpitz', sensor: 'x' })]);
    expect(r.components.cpu.status).toBe('unknown');
    expect(r.findings).toEqual([]);
  });

  describe('throttling', () => {
    const th = (type: string, latest: number, w: Parameters<typeof hist>[2]) => [
      pt('hw.cpu.throttle_count', latest, { 'hw.type': 'cpu', 'hw.id': 'package0', throttle_type: type }),
      hist('hw.cpu.throttle_count', { 'hw.id': 'package0', throttle_type: type }, w),
    ];
    it('growth in 24h is a warning', () => {
      const [p, h] = th('core', 14, { min24h: 10, max24h: 14 });
      const r = run([p], [h]);
      expect(codes(r)).toEqual(['cpu.throttled']);
      expect(r.findings[0]).toMatchObject({ severity: 'warning', value: 4, hwId: 'package0' });
      expect(r.components.cpu.status).toBe('warning');
    });
    it('no growth is ok', () => {
      const [p, h] = th('core', 14, { min24h: 14, max24h: 14 });
      const r = run([p], [h]);
      expect(codes(r)).toEqual([]);
      expect(r.components.cpu.status).toBe('ok');
    });
    it('takes the max of core and package throttle types (they overlap)', () => {
      const [p1, h1] = th('core', 3, { min24h: 0, max24h: 3 });
      const [p2, h2] = th('package', 2, { min24h: 0, max24h: 2 });
      const r = run([p1, p2], [h1, h2]);
      expect(r.components.cpu.throttle).toEqual([{ hwId: 'package0', total: 3, delta24h: 3, delta7d: null }]);
    });
    it('is reset-safe', () => {
      // 5000 before reboot, 2 after
      const [p, h] = th('core', 2, { min24h: 0, max24h: 5000 });
      const r = run([p], [h]);
      expect(r.findings[0].value).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Cooling
// ---------------------------------------------------------------------------

describe('cooling', () => {
  it('is unknown without fans', () => {
    expect(run([]).components.cooling.status).toBe('unknown');
  });

  it('a healthy fan is ok', () => {
    const r = run([fan(3000), fanLimit(500)], [fanHist({ max24h: 3100 })]);
    expect(r.components.cooling.status).toBe('ok');
    expect(r.components.cooling.fans[0]).toMatchObject({ rpm: 3000, lowCritical: 500, max24h: 3100 });
  });

  describe('below low-critical limit', () => {
    it('499 < 500 is critical', () => {
      const r = run([fan(499), fanLimit(500)]);
      expect(codes(r)).toEqual(['cooling.fan_below_limit']);
      expect(r.findings[0]).toMatchObject({ severity: 'critical', value: 499, threshold: 500 });
    });
    it('exactly at the limit is fine', () => {
      expect(codes(run([fan(500), fanLimit(500)]))).toEqual([]);
    });
  });

  describe('stopped fan', () => {
    it('0 rpm after reporting rpm in the last 24h is critical', () => {
      const r = run([fan(0)], [fanHist({ max24h: 1800 })]);
      expect(codes(r)).toEqual(['cooling.fan_stopped']);
      expect(r.findings[0].severity).toBe('critical');
    });
    it('0 rpm that never spun is not a finding (empty header)', () => {
      expect(codes(run([fan(0)], [fanHist({ max24h: 0 })]))).toEqual([]);
    });
    it('0 rpm without history is not a finding', () => {
      expect(codes(run([fan(0)]))).toEqual([]);
    });
    it('a low limit takes precedence over the stopped code', () => {
      expect(codes(run([fan(0), fanLimit(300)], [fanHist({ max24h: 1800 })]))).toEqual(['cooling.fan_below_limit']);
    });
  });

  it('matches limits per sensor', () => {
    const r = run([fan(100, 'fan1'), fan(2000, 'fan2'), fanLimit(500, 'fan2')]);
    expect(codes(r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

describe('power', () => {
  it('is unknown without data', () => {
    expect(run([]).components.power.status).toBe('unknown');
  });

  it('psu status 0 is critical, 1 is ok', () => {
    const bad = run([psu(0)]);
    expect(codes(bad)).toEqual(['power.supply_failed']);
    expect(bad.findings[0].severity).toBe('critical');
    expect(bad.components.power.supplies[0]).toMatchObject({ ok: false, status: 'critical' });
    expect(codes(run([psu(1)]))).toEqual([]);
  });

  describe('voltage limits', () => {
    const v = (value: number) => run([volt(value), voltLimit(11.4, 'low.critical'), voltLimit(12.6, 'high.critical')]);
    it('inside the limits is ok (boundaries included)', () => {
      expect(codes(v(12))).toEqual([]);
      expect(codes(v(11.4))).toEqual([]);
      expect(codes(v(12.6))).toEqual([]);
    });
    it('below the low.critical limit is critical', () => {
      const r = v(11.3);
      expect(codes(r)).toEqual(['power.voltage_low']);
      expect(r.findings[0]).toMatchObject({ severity: 'critical', threshold: 11.4 });
      expect(r.components.power.status).toBe('critical');
    });
    it('above the high.critical limit is critical', () => {
      const r = v(12.7);
      expect(codes(r)).toEqual(['power.voltage_high']);
      expect(r.findings[0].severity).toBe('critical');
    });
    it('without limits nothing is evaluated', () => {
      expect(codes(run([volt(3)]))).toEqual([]);
    });
  });

  it('psu failure outranks a voltage warning', () => {
    const r = run([psu(0), volt(5, '12V'), voltLimit(11.4, 'low.critical')]);
    expect(r.components.power.status).toBe('critical');
    expect(r.findings.map((f) => f.code)).toEqual(['power.supply_failed', 'power.voltage_low']);
  });
});

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

describe('network', () => {
  it('is unknown without data', () => {
    expect(run([]).components.network.status).toBe('unknown');
  });

  it('reports link state and speed', () => {
    const r = run([pt('hw.network.up', 1, { 'hw.type': 'network', 'hw.id': 'eth0', speed_mbps: '2500' })]);
    expect(r.components.network.status).toBe('ok');
    expect(r.components.network.interfaces[0]).toMatchObject({ hwId: 'eth0', up: true, speedMbps: 2500 });
  });

  it('a down link alone does not raise status', () => {
    const r = run([pt('hw.network.up', 0, { 'hw.type': 'network', 'hw.id': 'eth0' })]);
    expect(r.components.network.interfaces[0].up).toBe(false);
    expect(r.components.network.status).toBe('ok');
  });

  describe('crc', () => {
    it('growth in 24h is a warning', () => {
      const r = run(
        [netErr('eth0', 'crc', 'receive', 3)],
        [netErrHist('eth0', 'crc', 'receive', { min24h: 2, max24h: 3 })]
      );
      expect(codes(r)).toEqual(['network.crc_errors']);
      expect(r.findings[0]).toMatchObject({ severity: 'warning', hwId: 'eth0', value: 1 });
    });
    it('stable is fine', () => {
      const r = run([netErr('eth0', 'crc', 'receive', 3)], [netErrHist('eth0', 'crc', 'receive', { min24h: 3, max24h: 3 })]);
      expect(codes(r)).toEqual([]);
    });
  });

  describe('carrier changes', () => {
    const c = (latest: number, min: number) => run([carrier('eth0', latest)], [carrierHist('eth0', { min24h: min, max24h: latest })]);
    it('4 in 24h is fine', () => expect(codes(c(14, 10))).toEqual([]));
    it('5 in 24h is a warning', () => {
      const r = c(15, 10);
      expect(codes(r)).toEqual(['network.link_flapping']);
      expect(r.findings[0]).toMatchObject({ value: 5, threshold: 5 });
    });
  });

  describe('packet errors', () => {
    const e = (rx: number, tx: number) =>
      run(
        [netErr('eth0', 'errors', 'receive', rx), netErr('eth0', 'errors', 'transmit', tx)],
        [
          netErrHist('eth0', 'errors', 'receive', { min24h: 0, max24h: rx }),
          netErrHist('eth0', 'errors', 'transmit', { min24h: 0, max24h: tx }),
        ]
      );
    it('99 total is fine', () => expect(codes(e(60, 39))).toEqual([]));
    it('100 total (sum of directions) is a warning', () => {
      const r = e(60, 40);
      expect(codes(r)).toEqual(['network.errors']);
      expect(r.findings[0].value).toBe(100);
    });
  });

  it('dropped packets never raise status', () => {
    const r = run(
      [netErr('eth0', 'dropped', 'receive', 100000)],
      [netErrHist('eth0', 'dropped', 'receive', { min24h: 0, max24h: 100000 })]
    );
    expect(r.findings).toEqual([]);
    expect(r.components.network.interfaces[0].dropped.delta24h).toBe(100000);
  });

  it('is reset-safe for the 24h window', () => {
    // 90 errors before a reboot, 4 after: delta is 4, not negative and not 90
    const r = run([netErr('eth0', 'errors', 'receive', 4)], [netErrHist('eth0', 'errors', 'receive', { min24h: 0, max24h: 90 })]);
    expect(r.components.network.interfaces[0].errors.delta24h).toBe(4);
    expect(r.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Host level
// ---------------------------------------------------------------------------

describe('host status', () => {
  it('a VM that only reports host info has all components unknown', () => {
    const r = run([
      pt('hw.host.info', 1, { 'hw.type': 'host', 'hw.virtual': 'true', 'hw.vendor': 'QEMU', 'hw.model': 'Standard PC', 'os.kernel': '6.1.0', 'agent.version': '1.0.0' }),
      pt('hw.agent.collector.status', 0, { 'hw.type': 'agent', collector: 'smart' }),
      pt('hw.agent.collector.status', 1, { 'hw.type': 'agent', collector: 'kmsg' }),
    ]);
    expect(r.isVirtual).toBe(true);
    expect(r.status).toBe('unknown');
    expect(componentStatuses(r.components)).toEqual({
      disks: 'unknown',
      memory: 'unknown',
      cpu: 'unknown',
      cooling: 'unknown',
      power: 'unknown',
      network: 'unknown',
    });
    expect(r.info).toEqual({ vendor: 'QEMU', model: 'Standard PC', kernel: '6.1.0', agentVersion: '1.0.0' });
    expect(r.collectors).toEqual([
      { collector: 'kmsg', ok: true },
      { collector: 'smart', ok: false },
    ]);
    expect(r.findings).toEqual([]);
  });

  it('parses hw.virtual false and booleans', () => {
    expect(run([pt('hw.host.info', 1, { 'hw.virtual': 'false' })]).isVirtual).toBe(false);
    expect(run([pt('hw.host.info', 1, { 'hw.virtual': true })]).isVirtual).toBe(true);
    expect(run([pt('hw.host.info', 1, {})]).isVirtual).toBeNull();
    expect(run([]).isVirtual).toBeNull();
  });

  it('a host with no data and never seen is unknown', () => {
    const r = run([], [], null);
    expect(r.status).toBe('unknown');
    expect(r.lastSeenAt).toBeNull();
  });

  it('unknown components do not hide ok ones', () => {
    const r = run([pt('hw.physical_disk.smart_status', 1, disk())]);
    expect(r.status).toBe('ok');
    expect(r.components.memory.status).toBe('unknown');
  });

  describe('worst-of aggregation', () => {
    it('warning beats ok', () => {
      const r = run([pt('hw.physical_disk.smart_status', 1, disk()), smart('current_pending_sector', 2), memErr('mc0', 'uncorrected', 0)]);
      expect(r.status).toBe('warning');
      expect(componentStatuses(r.components)).toMatchObject({ disks: 'warning', memory: 'ok' });
    });
    it('critical beats warning', () => {
      const r = run([smart('current_pending_sector', 2), memErr('mc0', 'uncorrected', 1)]);
      expect(r.status).toBe('critical');
      expect(componentStatuses(r.components)).toMatchObject({ disks: 'warning', memory: 'critical' });
    });
  });

  it('orders findings critical first, then by component', () => {
    const r = run([
      carrier('eth0', 10),
      smart('current_pending_sector', 2),
      memErr('mc0', 'uncorrected', 1),
      psu(0),
    ], [carrierHist('eth0', { min24h: 0, max24h: 10 })]);
    expect(r.findings.map((f) => f.code)).toEqual([
      'memory.uncorrected',
      'power.supply_failed',
      'disk.pending_sectors',
      'network.link_flapping',
    ]);
  });

  describe('stale', () => {
    it('is stale when last seen more than 10 minutes ago', () => {
      const r = run([], [], minutesAgo(10.1));
      expect(r.status).toBe('stale');
    });
    it('exactly 10 minutes is not stale yet', () => {
      const r = run([pt('hw.physical_disk.smart_status', 1, disk(), minutesAgo(10))], [], minutesAgo(10));
      expect(r.status).toBe('ok');
    });
    it('uses the newest of lastSeenAt and the newest data point', () => {
      // registry says 30 min ago (ingest throttle bug), data point is fresh
      const r = run([pt('hw.physical_disk.smart_status', 1, disk(), minutesAgo(1))], [], minutesAgo(30));
      expect(r.status).toBe('ok');
      expect(r.lastSeenAt?.getTime()).toBe(minutesAgo(1).getTime());
    });
    it('stale replaces the status but keeps last known component state', () => {
      const r = run([pt('hw.physical_disk.smart_status', 0, disk(), minutesAgo(14))], [], minutesAgo(14));
      expect(r.status).toBe('stale');
      expect(r.components.disks.status).toBe('critical');
      expect(r.findings).toHaveLength(1);
    });
  });

  it('ignores non finite values', () => {
    const r = run([pt('hw.physical_disk.smart_status', Number.NaN, disk())]);
    expect(r.components.disks.status).toBe('unknown');
  });

  it('ignores the host.name attribute when identifying series', () => {
    const r = run([
      { metric: 'hw.physical_disk.smart_status', value: 0, attributes: disk(), time: minutesAgo(5) },
      { metric: 'hw.physical_disk.smart_status', value: 1, attributes: { 'host.name': 'srv1', ...disk() }, time: minutesAgo(1) },
    ]);
    expect(r.components.disks.disks).toHaveLength(1);
    expect(r.components.disks.disks[0].smartStatus).toBe(true);
  });

  it('formats numbers with en-US grouping in messages', () => {
    const r = run([memErr('mc0', 'corrected', 5000)], [memHist('mc0', 'corrected', { min24h: 0, max24h: 5000 })]);
    expect(r.findings[0].message).toContain('5,000');
  });

  it('never uses em dashes in messages', () => {
    const r = run([
      pt('hw.physical_disk.smart_status', 0, disk()),
      smart('reallocated_sector_count', 40),
      memErr('mc0', 'uncorrected', 1),
      cpuTemp(99),
      psu(0),
    ]);
    for (const f of r.findings) expect(f.message).not.toContain('—');
  });
});

// ---------------------------------------------------------------------------
// Contract hardening (agent cross-review)
// ---------------------------------------------------------------------------

describe('disk identity', () => {
  it('temperature series without smart data never create a phantom disk', () => {
    const r = run([
      pt('hw.temperature', 99, { 'hw.type': 'physical_disk', 'hw.id': 'nvme0', sensor: 'hwmon' }),
      pt('hw.temperature', 99, { 'hw.type': 'physical_disk', 'hw.id': 'drivetemp-1', sensor: 'temp1' }),
    ]);
    expect(r.components.disks.disks).toEqual([]);
    expect(r.components.disks.status).toBe('unknown');
    expect(r.findings).toEqual([]);
  });

  it('a disk identified by serial keeps the device as attribute', () => {
    const r = run([pt('hw.physical_disk.smart_status', 0, disk({ 'hw.id': 'SER123', serial: 'SER123', device: '/dev/sdb' }))]);
    expect(r.components.disks.disks[0]).toMatchObject({ hwId: 'SER123', device: '/dev/sdb' });
    expect(r.findings[0].hwId).toBe('SER123');
  });
});

describe('series identity', () => {
  it('drifting non identity attributes do not split a series, newest wins', () => {
    const r = run([
      pt('hw.network.up', 1, { 'hw.type': 'network', 'hw.id': 'eth0', speed_mbps: '1000' }, minutesAgo(5)),
      pt('hw.network.up', 0, { 'hw.type': 'network', 'hw.id': 'eth0', speed_mbps: '100' }, minutesAgo(1)),
      pt('hw.physical_disk.smart_status', 1, disk({ model: 'A' }), minutesAgo(5)),
      pt('hw.physical_disk.smart_status', 0, disk({ model: 'B' }), minutesAgo(1)),
    ]);
    expect(r.components.network.interfaces).toHaveLength(1);
    expect(r.components.network.interfaces[0]).toMatchObject({ up: false, speedMbps: 100 });
    expect(r.components.disks.disks).toHaveLength(1);
    expect(r.components.disks.disks[0].smartStatus).toBe(false);
  });

  it('limit types stay separate series', () => {
    const r = run([cpuTemp(90), cpuLimit(80, 'high'), cpuLimit(100, 'critical')]);
    expect(r.components.cpu.sensors[0]).toMatchObject({ high: 80, critical: 100 });
  });
});

describe('vanished devices', () => {
  const alive = [pt('hw.memory.size', 8e9, { 'hw.type': 'memory' })];

  it('disk in the 24h history but not in latest: disk.missing warning, component not ok/unknown', () => {
    const r = run(alive, [hist('hw.physical_disk.smart_status', { 'hw.id': 'SER1' }, { min24h: 1, max24h: 1 })]);
    expect(codes(r)).toEqual(['disk.missing']);
    expect(r.findings[0]).toMatchObject({ component: 'disks', hwId: 'SER1', severity: 'warning' });
    expect(r.components.disks.status).toBe('warning');
    expect(r.components.disks.missing).toEqual([{ hwId: 'SER1', sensor: null, metric: 'hw.physical_disk.smart_status' }]);
    expect(r.status).toBe('warning');
  });

  it('a remaining healthy disk does not hide the missing one', () => {
    const r = run(
      [pt('hw.physical_disk.smart_status', 1, disk({ 'hw.id': 'A' }))],
      [hist('hw.physical_disk.smart_status', { 'hw.id': 'A' }, { min24h: 1, max24h: 1 }), hist('hw.physical_disk.smart_status', { 'hw.id': 'B' }, { min24h: 1, max24h: 1 })]
    );
    expect(codes(r)).toEqual(['disk.missing']);
    expect(r.components.disks.status).toBe('warning');
  });

  it('psu_missing', () => {
    const r = run(alive, [hist('hw.power_supply.status', { 'hw.id': 'bmc', sensor: 'PS2' }, { min24h: 1, max24h: 1 })]);
    expect(codes(r)).toEqual(['power.psu_missing']);
    expect(r.components.power.status).toBe('warning');
  });

  it('fan_missing', () => {
    const r = run(alive, [fanHist({ min24h: 2000, max24h: 2100 })]);
    expect(codes(r)).toEqual(['cooling.fan_missing']);
    expect(r.components.cooling.status).toBe('warning');
  });

  it('interface_missing', () => {
    const r = run(alive, [hist('hw.network.up', { 'hw.id': 'eth1' }, { min24h: 1, max24h: 1 })]);
    expect(codes(r)).toEqual(['network.interface_missing']);
    expect(r.components.network.status).toBe('warning');
  });

  it('is not reported when the series is still present', () => {
    const r = run([psu(1)], [hist('hw.power_supply.status', { 'hw.id': 'bmc', sensor: 'PS1 Status' }, { min24h: 1, max24h: 1 })]);
    expect(r.findings).toEqual([]);
  });

  it('is not reported when the history window has no data', () => {
    const r = run(alive, [hist('hw.power_supply.status', { 'hw.id': 'bmc', sensor: 'PS2' }, { min7d: 1, max7d: 1 })]);
    expect(r.findings).toEqual([]);
  });

  it('is not reported while the host is stale', () => {
    const r = run([], [hist('hw.power_supply.status', { 'hw.id': 'bmc', sensor: 'PS2' }, { min24h: 1, max24h: 1 })], minutesAgo(30));
    expect(r.status).toBe('stale');
    expect(r.findings).toEqual([]);
  });

  it('is not reported when the latest window has no point at all (no new information)', () => {
    const r = run([], [hist('hw.power_supply.status', { 'hw.id': 'bmc', sensor: 'PS2' }, { min24h: 1, max24h: 1 })]);
    expect(r.findings).toEqual([]);
    expect(r.components.power.missing).toEqual([]);
  });

  it('is not reported when the latest window is partial (truncated load)', () => {
    const r = evaluateHost({
      latest: alive,
      history: [hist('hw.power_supply.status', { 'hw.id': 'bmc', sensor: 'PS2' }, { min24h: 1, max24h: 1 })],
      now: NOW,
      lastSeenAt: NOW,
      partial: true,
    });
    expect(r.findings).toEqual([]);
  });
});

describe('collector down', () => {
  const smartDown = pt('hw.agent.collector.status', 0, { 'hw.type': 'agent', collector: 'smart' });

  it('collector 0 with component history: agent.collector_down, replaces the missing findings', () => {
    const r = run([smartDown], [hist('hw.physical_disk.smart_status', { 'hw.id': 'SER1' }, { min24h: 1, max24h: 1 })]);
    expect(codes(r)).toEqual(['agent.collector_down']);
    expect(r.findings[0]).toMatchObject({ component: 'disks', hwId: 'smart', severity: 'warning' });
    expect(r.components.disks.status).toBe('warning');
    expect(r.components.disks.missing).toEqual([]);
  });

  it('collector 0 without history (e.g. a VM) is no finding', () => {
    const r = run([smartDown]);
    expect(r.findings).toEqual([]);
    expect(r.components.disks.status).toBe('unknown');
  });

  it('collector ok does not raise anything', () => {
    const r = run([pt('hw.agent.collector.status', 1, { collector: 'smart' }), pt('hw.physical_disk.smart_status', 1, disk())], [
      hist('hw.physical_disk.smart_status', { 'hw.id': 'sda' }, { min24h: 1, max24h: 1 }),
    ]);
    expect(r.findings).toEqual([]);
  });

  describe('needs 3 minutes of zeros when the window shows when it went down', () => {
    const smart = (value: number, minutes: number) =>
      pt('hw.agent.collector.status', value, { 'hw.type': 'agent', collector: 'smart' }, minutesAgo(minutes));
    const history = [hist('hw.physical_disk.smart_status', { 'hw.id': 'SER1' }, { min24h: 1, max24h: 1 })];

    it('down for 2 minutes after reporting ok: not yet, and its devices are not missing either', () => {
      const r = run([smart(1, 3), smart(0, 2), smart(0, 1), smart(0, 0)], history);
      expect(codes(r)).toEqual([]);
    });

    it('down for 3 minutes after reporting ok: collector_down', () => {
      const r = run([smart(1, 4), smart(0, 3), smart(0, 2), smart(0, 1), smart(0, 0)], history);
      expect(codes(r)).toEqual(['agent.collector_down']);
    });

    it('flapping back to 1 resets the run', () => {
      const r = run([smart(0, 6), smart(0, 5), smart(1, 1), smart(0, 0)], history);
      expect(codes(r)).toEqual([]);
    });

    it('skipped on a partial window', () => {
      const r = evaluateHost({ latest: [smart(0, 0)], history, now: NOW, lastSeenAt: NOW, partial: true });
      expect(codes(r)).toEqual([]);
    });
  });

  it('ipmi down affects cooling and power', () => {
    const r = run(
      [pt('hw.agent.collector.status', 0, { collector: 'ipmi' })],
      [fanHist({ min24h: 1000, max24h: 2000 }), hist('hw.power_supply.status', { 'hw.id': 'bmc', sensor: 'PS1' }, { min24h: 1, max24h: 1 })]
    );
    expect(r.findings.map((f) => f.component).sort()).toEqual(['cooling', 'power']);
    expect(r.components.cooling.status).toBe('warning');
    expect(r.components.power.status).toBe('warning');
  });
});

describe('memory scopes', () => {
  const dimm = (hwId: string, type: 'corrected' | 'uncorrected', value: number, extra: Attrs = {}) =>
    pt('hw.memory.errors', value, { 'hw.type': 'memory', 'hw.id': hwId, error_type: type, scope: 'dimm', controller: hwId.split('/')[0], ...extra });
  const ctrl = (hwId: string, type: 'corrected' | 'uncorrected', value: number) =>
    pt('hw.memory.errors', value, { 'hw.type': 'memory', 'hw.id': hwId, error_type: type, scope: 'controller' });

  it('ignores controller points when dimm points exist for that controller', () => {
    const r = run([ctrl('mc0', 'uncorrected', 3), dimm('mc0/dimm0', 'uncorrected', 0), dimm('mc0/dimm1', 'uncorrected', 0)]);
    expect(r.findings).toEqual([]);
    expect(r.components.memory.controllers.map((c) => c.hwId)).toEqual(['mc0/dimm0', 'mc0/dimm1']);
  });

  it('keeps controller points of controllers without dimm data', () => {
    const r = run([ctrl('mc1', 'uncorrected', 1), dimm('mc0/dimm0', 'uncorrected', 0)]);
    expect(codes(r)).toEqual(['memory.uncorrected']);
    expect(r.findings[0].hwId).toBe('mc1');
  });

  it('flags the offending dimm with its label and keeps dimms apart in history', () => {
    const r = run(
      [
        dimm('mc0/dimm0', 'corrected', 150, { dimm_label: 'DIMM_A1' }),
        dimm('mc0/dimm1', 'corrected', 150, { dimm_label: 'DIMM_B1' }),
      ],
      [
        hist('hw.memory.errors', { 'hw.id': 'mc0/dimm0', scope: 'dimm', error_type: 'corrected' }, { min24h: 0, max24h: 150 }),
        hist('hw.memory.errors', { 'hw.id': 'mc0/dimm1', scope: 'dimm', error_type: 'corrected' }, { min24h: 150, max24h: 150 }),
      ]
    );
    expect(codes(r)).toEqual(['memory.corrected_surge']);
    expect(r.findings[0].hwId).toBe('mc0/dimm0');
    expect(r.findings[0].message).toContain('DIMM_A1');
    const c = r.components.memory.controllers;
    expect(c[0]).toMatchObject({ scope: 'dimm', controller: 'mc0', dimmLabel: 'DIMM_A1', status: 'critical' });
    expect(c[1].status).toBe('ok');
  });
});

describe('generic temperatures (board, memory, gpu, other)', () => {
  const board = (v: number, type = 'board') => pt('hw.temperature', v, { 'hw.type': type, 'hw.id': 'acpitz', sensor: 'temp1' });
  const lim = (v: number, t: 'high' | 'critical') =>
    pt('hw.temperature.limit', v, { 'hw.type': 'board', 'hw.id': 'acpitz', sensor: 'temp1', limit_type: t });

  it('critical limit reached is critical, high limit reached is a warning', () => {
    expect(codes(run([board(70), lim(70, 'high'), lim(90, 'critical')]))).toEqual(['cooling.temperature_high']);
    const r = run([board(90), lim(70, 'high'), lim(90, 'critical')]);
    expect(codes(r)).toEqual(['cooling.temperature_critical']);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.components.cooling.status).toBe('critical');
  });

  it('below limits is ok and makes cooling known', () => {
    const r = run([board(40), lim(70, 'high')]);
    expect(r.findings).toEqual([]);
    expect(r.components.cooling.status).toBe('ok');
    expect(r.components.cooling.temperatures[0]).toMatchObject({ type: 'board', temperature: 40, high: 70, critical: null });
  });

  it('without limits there is no finding', () => {
    expect(run([board(120)]).findings).toEqual([]);
  });

  it('works for memory, gpu and other types and ignores cpu/disk temperatures here', () => {
    const r = run([board(95, 'gpu'), board(10, 'memory'), cpuTemp(50)]);
    expect(r.components.cooling.temperatures.map((t) => t.type).sort()).toEqual(['gpu', 'memory']);
  });
});

describe('voltage warning limits', () => {
  it('low / high are warnings, low.critical / high.critical are critical', () => {
    const lim = (v: number, t: string) => pt('hw.voltage.limit', v, { 'hw.type': 'voltage', 'hw.id': 'bmc', sensor: '12V', limit_type: t });
    const r = run([volt(11.5), lim(11.7, 'low'), lim(11.0, 'low.critical')]);
    expect(r.findings[0]).toMatchObject({ code: 'power.voltage_low', severity: 'warning', threshold: 11.7 });
    const r2 = run([volt(10.9), lim(11.7, 'low'), lim(11.0, 'low.critical')]);
    expect(r2.findings[0]).toMatchObject({ severity: 'critical', threshold: 11 });
    const r3 = run([volt(12.8), lim(12.6, 'high'), lim(13.0, 'high.critical')]);
    expect(r3.findings[0]).toMatchObject({ code: 'power.voltage_high', severity: 'warning' });
  });
});
