import { describe, it, expect } from 'vitest';
import {
  healthState,
  parseSizeToBytes,
  formatDurationMs,
  formatUpdatedAgo,
  sortRows,
  aggregateStaleness,
} from './system-health';

describe('system-health helpers', () => {
  it('maps health status', () => {
    expect(healthState('healthy').label).toBe('Healthy');
    expect(healthState('degraded').state).toBe('acknowledged');
    expect(healthState('down').state).toBe('down');
    expect(healthState('not_configured').label).toBe('Not configured');
    expect(healthState(undefined).label).toBe('Unknown');
  });

  it('parses pretty sizes', () => {
    expect(parseSizeToBytes('8192 bytes')).toBe(8192);
    expect(parseSizeToBytes('1 kB')).toBe(1024);
    expect(parseSizeToBytes('1.5 MB')).toBe(1.5 * 1024 ** 2);
    expect(parseSizeToBytes('2 GB')).toBe(2 * 1024 ** 3);
    expect(parseSizeToBytes('nope')).toBe(0);
    expect(parseSizeToBytes(null)).toBe(0);
  });

  it('formats durations', () => {
    expect(formatDurationMs(850)).toBe('850ms');
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(125000)).toBe('2m 5s');
    expect(formatDurationMs(null)).toBe('-');
  });

  it('formats updated-ago', () => {
    expect(formatUpdatedAgo(1)).toBe('just now');
    expect(formatUpdatedAgo(12)).toBe('12s ago');
    expect(formatUpdatedAgo(130)).toBe('2m ago');
    expect(formatUpdatedAgo(7300)).toBe('2h ago');
  });

  it('sorts rows without mutating', () => {
    const rows = [{ n: 2 }, { n: 10 }, { n: 1 }];
    const acc = { n: (r: { n: number }) => r.n };
    expect(sortRows(rows, { key: 'n', dir: 'asc' }, acc).map((r) => r.n)).toEqual([1, 2, 10]);
    expect(sortRows(rows, { key: 'n', dir: 'desc' }, acc).map((r) => r.n)).toEqual([10, 2, 1]);
    expect(rows.map((r) => r.n)).toEqual([2, 10, 1]);
    expect(sortRows(rows, undefined, acc)).toBe(rows);
    expect(sortRows(rows, { key: 'x', dir: 'asc' }, acc)).toBe(rows);
  });

  it('classifies aggregate staleness', () => {
    const now = Date.parse('2026-01-02T00:00:00Z');
    expect(aggregateStaleness(null, now).tone).toBe('bad');
    expect(aggregateStaleness('2026-01-01T23:30:00Z', now)).toEqual({ label: '30m ago', tone: 'ok' });
    expect(aggregateStaleness('2026-01-01T12:00:00Z', now).tone).toBe('warn');
    expect(aggregateStaleness('2025-12-29T00:00:00Z', now)).toEqual({ label: '4d ago', tone: 'bad' });
  });
});
