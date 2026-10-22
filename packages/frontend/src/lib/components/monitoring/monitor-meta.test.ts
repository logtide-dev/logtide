import { describe, it, expect } from 'vitest';
import { errorCodeLabel, monitorStateTone, MONITOR_TYPE_OPTIONS } from './monitor-meta';
import { stateTone } from '$lib/utils/severity';

// Mirrors the backend ErrorCode union in modules/monitoring/types.ts.
const BACKEND_ERROR_CODES = [
  'timeout',
  'dns_error',
  'connection_refused',
  'ssl_error',
  'http_error',
  'no_heartbeat',
  'blocked',
  'cert_expiring',
  'cert_expired',
  'dns_mismatch',
  'dns_no_records',
  'unexpected',
];

describe('errorCodeLabel', () => {
  it('covers every backend ErrorCode with a readable label', () => {
    for (const code of BACKEND_ERROR_CODES) {
      const label = errorCodeLabel(code);
      expect(label).not.toBe(code);
      expect(label).not.toContain('_');
      expect(label).toMatch(/^[A-Z]/);
    }
    expect(errorCodeLabel('cert_expiring')).toBe('Certificate expires soon');
  });

  it('handles null and unknown codes', () => {
    expect(errorCodeLabel(null)).toBe('-');
    expect(errorCodeLabel('some_new_code')).toBe('Some new code');
  });
});

describe('monitorStateTone', () => {
  it('maps paused to disabled', () => {
    expect(monitorStateTone('up', false)).toEqual(stateTone('disabled'));
    expect(monitorStateTone('down', false)).toEqual(stateTone('disabled'));
  });

  it('maps up, down and unknown', () => {
    expect(monitorStateTone('up', true)).toEqual(stateTone('up'));
    expect(monitorStateTone('down', true)).toEqual(stateTone('down'));
    expect(monitorStateTone('unknown', true)).toEqual(stateTone('disabled'));
  });
});

describe('MONITOR_TYPE_OPTIONS', () => {
  it('offers the six types with the agreed labels', () => {
    expect(MONITOR_TYPE_OPTIONS.map((o) => o.label)).toEqual([
      'HTTP(S)',
      'TCP port',
      'Heartbeat (push)',
      'Log heartbeat',
      'SSL certificate',
      'DNS record',
    ]);
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes, hours and days', async () => {
    const { formatDuration } = await import('./monitor-meta');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(252)).toBe('4 min 12 s');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(7500)).toBe('2 h 5 min');
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe('3 d 4 h');
    expect(formatDuration(null)).toBe('-');
  });
});
