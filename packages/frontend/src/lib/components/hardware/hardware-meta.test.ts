import { describe, it, expect } from 'vitest';
import {
  buildAgentRunCommand,
  buildHardwareLogsUrl,
  collectorHint,
  componentTooltip,
  counterDeltaText,
  diskAttribute,
  diskTemperatureStatus,
  enduranceStatus,
  filterHosts,
  formatCelsius,
  formatFindingNumbers,
  formatLinkSpeed,
  formatMemorySize,
  formatUnitValue,
  isNoSensors,
  hardwareStatusLabel,
  hardwareStatusTone,
  seriesFor,
  seriesLatest,
  sortHosts,
  summarizeHosts,
} from './hardware-meta';
import { detail, diskSeries, hostList, memorySeries } from './hardware-fixtures';

describe('hardware-meta', () => {
  it('labels and tones every status', () => {
    expect(hardwareStatusLabel('ok')).toBe('OK');
    expect(hardwareStatusLabel('stale')).toBe('Stale');
    expect(hardwareStatusLabel('nonsense')).toBe('Unknown');
    expect(hardwareStatusTone('critical').badge).not.toBe(hardwareStatusTone('warning').badge);
    expect(hardwareStatusTone('stale').badge).toBe(hardwareStatusTone('unknown').badge);
  });

  it('summarizes, sorts and filters hosts', () => {
    expect(summarizeHosts(hostList)).toEqual({ total: 4, ok: 1, warning: 0, critical: 1, stale: 1 });
    expect(sortHosts(hostList).map((h) => h.hostName)).toEqual(['db-01', 'old-nas', 'vm-07', 'web-01']);
    expect(filterHosts(hostList, 'critical')).toHaveLength(1);
    expect(filterHosts(hostList, 'all')).toHaveLength(4);
  });

  it('describes component status for tooltips', () => {
    expect(componentTooltip('disks', 'critical')).toBe('Disks: critical');
    expect(componentTooltip('cooling', 'unknown')).toBe('Cooling: no data reported');
  });

  it('builds the exact agent command with the api url and a key placeholder', () => {
    const cmd = buildAgentRunCommand('https://api.example.com');
    expect(cmd).toBe(
      [
        'docker run -d --name logtide-hw-agent --restart unless-stopped --privileged \\',
        '  -e LOGTIDE_URL=https://api.example.com -e LOGTIDE_API_KEY=YOUR_API_KEY \\',
        '  -e HOST_ROOT=/host \\',
        '  -v /sys:/host/sys:ro -v /proc:/host/proc:ro -v /etc/hostname:/host/etc/hostname:ro \\',
        '  -v logtide-hw-agent-state:/var/lib/logtide-hw-agent \\',
        '  logtide/hw-agent:latest',
      ].join('\n')
    );
  });

  it('hints at why a collector is unavailable', () => {
    expect(collectorHint('ipmi')).toBe('No BMC or ipmitool');
    expect(collectorHint('whatever')).toBe('The collector reported a failure');
  });

  it('formats counters and deltas', () => {
    expect(counterDeltaText({ delta24h: 3, delta7d: 7 })).toBe('+3 in 24 h, +7 in 7 d');
    expect(counterDeltaText({ delta24h: 0, delta7d: 0 })).toBe('no change');
    expect(counterDeltaText({ delta24h: null, delta7d: null })).toBe('no history yet');
    expect(counterDeltaText({ delta24h: null, delta7d: 2 })).toBe('+2 in 7 d');
  });

  it('formats sizes, speeds and temperatures', () => {
    expect(formatMemorySize(64 * 1024 ** 3)).toBe('64 GB');
    expect(formatMemorySize(512 * 1024 ** 2)).toBe('512 MB');
    expect(formatMemorySize(null)).toBe('-');
    expect(formatLinkSpeed(10000)).toBe('10 Gb/s');
    expect(formatLinkSpeed(100)).toBe('100 Mb/s');
    expect(formatLinkSpeed(null)).toBe('-');
    expect(formatCelsius(41.5)).toBe('41.5 °C');
    expect(formatFindingNumbers(14, 10)).toBe('14 (threshold 10)');
    expect(formatFindingNumbers(undefined, 10)).toBeNull();
  });

  it('judges disk temperature and endurance with the shared thresholds', () => {
    expect(diskTemperatureStatus('ata', 54)).toBe('ok');
    expect(diskTemperatureStatus('ata', 55)).toBe('warning');
    expect(diskTemperatureStatus('ata', 65)).toBe('critical');
    expect(diskTemperatureStatus('nvme', 69)).toBe('ok');
    expect(diskTemperatureStatus('nvme', 70)).toBe('warning');
    expect(diskTemperatureStatus('nvme', 80)).toBe('critical');
    expect(diskTemperatureStatus(null, null)).toBe('unknown');
    expect(enduranceStatus(79)).toBe('ok');
    expect(enduranceStatus(80)).toBe('warning');
    expect(enduranceStatus(95)).toBe('critical');
    expect(enduranceStatus(null)).toBe('unknown');
  });

  it('finds a disk attribute', () => {
    const sda = detail().snapshot.disks.disks[0];
    expect(diskAttribute(sda, 'reallocated_sector_count')?.total).toBe(24);
    expect(diskAttribute(sda, 'power_on_hours')).toBeUndefined();
  });

  it('picks series of a component and formats the latest value', () => {
    expect(seriesFor([memorySeries, diskSeries], 'memory')).toEqual([memorySeries]);
    expect(seriesFor([{ ...memorySeries, points: [] }], 'memory')).toEqual([]);
    expect(seriesLatest(memorySeries)).toBe('7 errors');
    expect(seriesLatest({ points: [], unit: '' })).toBe('-');
  });

  it('maps OTLP units for display', () => {
    expect(formatUnitValue(44, 'Cel')).toBe('44 °C');
    expect(formatUnitValue(57.25, 'Cel')).toBe('57.3 °C');
    expect(formatUnitValue(512, 'By')).toBe('512 B');
    expect(formatUnitValue(1536, 'By')).toBe('1.5 KB');
    expect(formatUnitValue(8 * 1024 ** 3, 'By')).toBe('8 GB');
    expect(formatUnitValue(63.5, '%')).toBe('63.5%');
    expect(formatUnitValue(1200, 'rpm')).toBe('1,200 rpm');
    expect(formatUnitValue(12.1, 'V')).toBe('12.1 V');
    expect(formatUnitValue(3, '1')).toBe('3');
    expect(formatUnitValue(3, '')).toBe('3');
    expect(formatUnitValue(3, undefined)).toBe('3');
    expect(formatUnitValue(7, '{errors}')).toBe('7 errors');
    expect(formatUnitValue(Number.NaN, 'Cel')).toBe('-');
    expect(seriesLatest({ points: [{ ts: 1, value: 44 }] as never, unit: 'Cel' })).toBe('44 °C');
  });

  it('flags virtual hosts without sensors', () => {
    expect(isNoSensors({ status: 'unknown', isVirtual: true })).toBe(true);
    expect(isNoSensors({ status: 'unknown', isVirtual: false })).toBe(false);
    expect(isNoSensors({ status: 'ok', isVirtual: true })).toBe(false);
  });

  it('builds a logs link for the hardware service and one host', () => {
    const url = new URL(
      buildHardwareLogsUrl('p1', 'db-01', new Date('2026-11-10T12:00:00Z')),
      'http://x'
    );
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('service:hardware host:db-01');
    expect(url.search).toContain('p1');
  });
});
