import { describe, it, expect } from 'vitest';
import {
  HARDWARE_COMPONENT_KEYS,
  HARDWARE_HISTORY_SERIES,
  HARDWARE_METRIC_NAMES,
  HARDWARE_SMART_ATTRIBUTES,
  HARDWARE_STALE_AFTER_MS,
  HARDWARE_THRESHOLDS,
  HARDWARE_FINDING_CODES,
  isHardwareMetric,
  worstHardwareStatus,
} from './hardware.js';
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_EVENT_LABELS } from './notification-channel.js';
import { NOTIFICATION_ROUTING_EVENT_TYPES } from './notification-routing.js';
import { PACK_CATEGORIES } from '../constants/sigma-constants.js';
import { INCIDENT_SOURCES } from '../constants/monitoring-constants.js';
import { getIncidentSourceLabel } from '../utils/severity.js';

describe('hardware health constants', () => {
  it('has the six components', () => {
    expect([...HARDWARE_COMPONENT_KEYS]).toEqual(['disks', 'memory', 'cpu', 'cooling', 'power', 'network']);
  });

  it('goes stale after 10 minutes', () => {
    expect(HARDWARE_STALE_AFTER_MS).toBe(600_000);
  });

  it('has unique hw.* metric names', () => {
    expect(new Set(HARDWARE_METRIC_NAMES).size).toBe(HARDWARE_METRIC_NAMES.length);
    for (const name of HARDWARE_METRIC_NAMES) expect(isHardwareMetric(name)).toBe(true);
    expect(isHardwareMetric('http.server.duration')).toBe(false);
  });

  it('only asks for history of known metrics, always keyed by hw.id', () => {
    for (const [metric, attrs] of Object.entries(HARDWARE_HISTORY_SERIES)) {
      expect(HARDWARE_METRIC_NAMES as readonly string[]).toContain(metric);
      expect(attrs[0]).toBe('hw.id');
    }
  });

  it('has unique finding codes prefixed by a component', () => {
    expect(new Set(HARDWARE_FINDING_CODES).size).toBe(HARDWARE_FINDING_CODES.length);
    for (const code of HARDWARE_FINDING_CODES) {
      expect(['disk', 'memory', 'cpu', 'cooling', 'power', 'network']).toContain(code.split('.')[0]);
    }
  });

  it('pins the thresholds of the design', () => {
    const t = HARDWARE_THRESHOLDS;
    expect(t.disk.reallocatedGrowthCriticalAtLeast7d).toBe(10);
    expect(t.disk.enduranceWarningAtLeast).toBe(80);
    expect(t.disk.enduranceCriticalAtLeast).toBe(95);
    expect(t.disk.temperature.hdd).toEqual({ warningAtLeast: 55, criticalAtLeast: 65 });
    expect(t.disk.temperature.nvme).toEqual({ warningAtLeast: 70, criticalAtLeast: 80 });
    expect(t.memory.correctedGrowthCriticalAtLeast24h).toBe(100);
    expect(t.cpu.temperatureHighFallback).toBe(85);
    expect(t.cpu.temperatureCriticalFallback).toBe(95);
    expect(t.network.carrierChangesAtLeast24h).toBe(5);
    expect(t.network.errorsAtLeast24h).toBe(100);
  });

  it('lists the SMART attributes of the contract', () => {
    expect(HARDWARE_SMART_ATTRIBUTES).toContain('reallocated_sector_count');
    expect(HARDWARE_SMART_ATTRIBUTES).toContain('udma_crc_error_count');
    expect(HARDWARE_SMART_ATTRIBUTES).toHaveLength(8);
  });
});

describe('worstHardwareStatus', () => {
  it('picks the worst known status', () => {
    expect(worstHardwareStatus(['ok', 'warning', 'ok'])).toBe('warning');
    expect(worstHardwareStatus(['warning', 'critical'])).toBe('critical');
  });

  it('does not let unknown hide a known status', () => {
    expect(worstHardwareStatus(['unknown', 'ok'])).toBe('ok');
  });

  it('is unknown for empty or all unknown', () => {
    expect(worstHardwareStatus([])).toBe('unknown');
    expect(worstHardwareStatus(['unknown', 'unknown'])).toBe('unknown');
  });
});

describe('hardware registration in shared enumerations', () => {
  it('adds the hardware pack category, incident source and event type', () => {
    expect(PACK_CATEGORIES).toContain('hardware');
    expect(INCIDENT_SOURCES).toContain('hardware');
    expect(NOTIFICATION_EVENT_TYPES).toContain('hardware');
    expect(NOTIFICATION_ROUTING_EVENT_TYPES).toContain('hardware');
    expect(NOTIFICATION_EVENT_LABELS.hardware).toBe('Hardware health');
    expect(getIncidentSourceLabel('hardware')).toBe('Hardware');
  });
});
