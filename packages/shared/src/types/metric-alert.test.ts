import { describe, it, expect } from 'vitest';
import {
  formatMetricAlertLabels,
  metricAlertBreaches,
  metricAlertGroupKey,
  metricAlertTarget,
} from './metric-alert.js';
import { alertResolvedDataSchema, alertTriggeredDataSchema } from '../schemas/webhook-events.js';

const q = (id: string, hidden?: boolean) => ({
  id,
  metricName: 'cpu',
  aggregation: 'avg' as const,
  filters: [],
  groupBy: [],
  ...(hidden ? { hidden } : {}),
});

describe('metricAlertTarget', () => {
  it('returns the only visible query', () => {
    expect(metricAlertTarget({ queries: [q('A')], formulas: [] })).toEqual({ kind: 'query', id: 'A' });
  });

  it('returns the only visible formula when its operands are hidden', () => {
    expect(
      metricAlertTarget({ queries: [q('A', true), q('B', true)], formulas: [{ id: 'F1', expression: 'A / B' }] })
    ).toEqual({ kind: 'formula', id: 'F1' });
  });

  it('returns null with zero or several visible items', () => {
    expect(metricAlertTarget({ queries: [q('A', true)], formulas: [] })).toBeNull();
    expect(metricAlertTarget({ queries: [q('A'), q('B')], formulas: [] })).toBeNull();
    expect(metricAlertTarget({ queries: [q('A')], formulas: [{ id: 'F1', expression: 'A * 2' }] })).toBeNull();
  });
});

describe('group keys and labels', () => {
  it('is order independent and empty when ungrouped', () => {
    expect(metricAlertGroupKey({})).toBe('');
    expect(metricAlertGroupKey({ b: '2', a: '1' })).toBe('a=1\nb=2');
    expect(formatMetricAlertLabels({ b: '2', a: '1' })).toBe('a=1, b=2');
  });
});

describe('metricAlertBreaches', () => {
  it('is strict in both directions', () => {
    expect(metricAlertBreaches('above', 91, 90)).toBe(true);
    expect(metricAlertBreaches('above', 90, 90)).toBe(false);
    expect(metricAlertBreaches('below', 9, 10)).toBe(true);
    expect(metricAlertBreaches('below', 10, 10)).toBe(false);
  });
});

describe('alert webhook schemas with metric fields', () => {
  const metric = {
    query_id: 'A',
    source: 'system.cpu.utilization',
    condition: 'above',
    threshold: 0.9,
    value: 0.95,
    unit: '1',
    window: '5m',
    for_evaluations: 3,
    labels: { 'host.name': 'web-1' },
    group_key: 'host.name=web-1',
  };

  it('accepts a metric alert.triggered payload', () => {
    const parsed = alertTriggeredDataSchema.parse({
      alert_name: 'CPU high',
      log_count: 0,
      threshold: 0.9,
      time_window: 5,
      baseline_metadata: null,
      link: 'https://example.com',
      alert_type: 'metric',
      metric,
    });
    expect(parsed.metric?.labels['host.name']).toBe('web-1');
  });

  it('accepts a metric alert.resolved payload with a null value', () => {
    const parsed = alertResolvedDataSchema.parse({
      alert_rule_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      alert_name: 'CPU high',
      alert_type: 'metric',
      title: 'Alert resolved: CPU high',
      message: 'back to normal',
      log_count: 0,
      threshold: 0.9,
      time_window: 5,
      firing_since: '2026-11-25T10:00:00.000Z',
      resolved_at: '2026-11-25T10:05:00.000Z',
      duration_seconds: 300,
      incident_id: null,
      link: 'https://example.com',
      metric: { ...metric, value: null },
    });
    expect(parsed.metric?.value).toBeNull();
  });

  it('rejects an unknown condition', () => {
    expect(() =>
      alertTriggeredDataSchema.parse({
        alert_name: 'x',
        log_count: 0,
        threshold: 1,
        time_window: 5,
        baseline_metadata: null,
        link: 'l',
        metric: { ...metric, condition: 'equal' },
      })
    ).toThrow();
  });
});
