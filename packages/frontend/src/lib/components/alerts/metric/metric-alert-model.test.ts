import { describe, it, expect } from 'vitest';
import type { MetricExplorerQuery, MetricQueryResponse } from '@logtide/shared';
import {
  alertTargetOptions,
  buildMetricAlertQuery,
  defaultAlertTarget,
  formulaQueryRefs,
  instanceLabels,
  suggestThreshold,
  summarizeMetricRule,
  targetUnit,
  thresholdFromDisplay,
  thresholdToDisplay,
  thresholdUnitLabel,
} from './metric-alert-model';

const q = (id: string, metricName: string, extra: Record<string, unknown> = {}) => ({
  id,
  metricName,
  aggregation: 'avg' as const,
  filters: [],
  groupBy: [],
  ...extra,
});

function explorer(over: Partial<MetricExplorerQuery> = {}): MetricExplorerQuery {
  return {
    projectIds: ['p1'],
    queries: [q('A', 'http.errors'), q('B', 'http.requests')],
    formulas: [{ id: 'F1', expression: 'A / B * 100' }],
    interval: '5m',
    compareTo: '1d',
    display: 'split',
    ...over,
  };
}

describe('targets', () => {
  it('lists queries with a metric, then formulas whose operands exist', () => {
    const query = explorer({
      queries: [q('A', 'http.errors'), q('B', ''), q('C', 'cpu')],
      formulas: [
        { id: 'F1', expression: 'A / C' },
        { id: 'F2', expression: 'A / B' },
      ],
    });
    expect(alertTargetOptions(query).map((t) => [t.id, t.kind, t.label])).toEqual([
      ['A', 'query', 'A: http.errors'],
      ['C', 'query', 'C: cpu'],
      ['F1', 'formula', 'F1: A / C'],
    ]);
    expect(formulaQueryRefs('A / B * 100 + F')).toEqual(['A', 'B', 'F']);
  });

  it('preselects the visible formula, else the first visible query', () => {
    expect(defaultAlertTarget(explorer())).toBe('F1');
    expect(defaultAlertTarget(explorer({ formulas: [] }))).toBe('A');
    expect(defaultAlertTarget(explorer({ formulas: [], queries: [q('A', 'x', { hidden: true }), q('B', 'y')] }))).toBe('B');
    expect(defaultAlertTarget(explorer({ queries: [], formulas: [] }))).toBeNull();
  });
});

describe('buildMetricAlertQuery', () => {
  it('keeps only the watched query, visible, and resets display options', () => {
    const built = buildMetricAlertQuery(explorer(), 'B');
    expect(built).toEqual({
      projectIds: ['p1'],
      queries: [{ ...q('B', 'http.requests'), hidden: false }],
      formulas: [],
      interval: 'auto',
      compareTo: 'none',
      display: 'lines',
    });
  });

  it('keeps a formula visible with its operands hidden', () => {
    const built = buildMetricAlertQuery(explorer(), 'F1');
    expect(built.formulas).toEqual([{ id: 'F1', expression: 'A / B * 100', hidden: false }]);
    expect(built.queries.map((x) => [x.id, x.hidden])).toEqual([
      ['A', true],
      ['B', true],
    ]);
  });
});

describe('thresholds and units', () => {
  const response: MetricQueryResponse = {
    interval: '1m',
    warnings: [],
    queries: [{ id: 'A', seriesTotal: 2, seriesShown: 2, metricType: 'gauge', unit: '1' }],
    series: [
      {
        id: 'A|a',
        queryId: 'A',
        labels: {},
        name: 'a',
        unit: '1',
        comparison: false,
        points: [],
        stats: { min: 0.1, avg: 0.4, max: 0.72, last: 0.5 },
      },
      {
        id: 'A|b',
        queryId: 'A',
        labels: {},
        name: 'b',
        unit: '1',
        comparison: false,
        points: [],
        stats: { min: 0.05, avg: 0.3, max: 0.6, last: 0.2 },
      },
    ],
  };

  it('shows ratio utilization thresholds in percent and stores them raw', () => {
    expect(thresholdToDisplay(0.9, '1', 'system.cpu.utilization')).toBe(90);
    expect(thresholdFromDisplay(90, '1', 'system.cpu.utilization')).toBeCloseTo(0.9);
    expect(thresholdToDisplay(512, 'By', 'mem')).toBe(512);
    expect(thresholdUnitLabel('1', 'system.cpu.utilization')).toBe('%');
    expect(thresholdUnitLabel('By/s', 'net')).toBe('bytes/s');
  });

  it('suggests the extreme value of the watched item in display units', () => {
    expect(targetUnit(response, 'A')).toBe('1');
    expect(suggestThreshold(response, 'A', 'above', 'system.cpu.utilization')).toBe(72);
    expect(suggestThreshold(response, 'A', 'below', 'system.cpu.utilization')).toBe(5);
    expect(suggestThreshold(response, 'B', 'above', null)).toBeNull();
    expect(suggestThreshold(null, 'A', 'above', null)).toBeNull();
  });
});

describe('summaries', () => {
  it('describes a metric rule', () => {
    expect(
      summarizeMetricRule({
        query: buildMetricAlertQuery(explorer(), 'A'),
        condition: 'above',
        threshold: 0.9,
        window: '5m',
        forEvaluations: 3,
        severity: 'high',
        unit: '1',
      })
    ).toBe('http.errors above 0.9 (avg over 5 minutes, 3 checks)');
    expect(
      summarizeMetricRule({
        query: { ...buildMetricAlertQuery(explorer(), 'A'), queries: [{ ...q('A', 'system.cpu.utilization') }] },
        condition: 'below',
        threshold: 0.1,
        window: '1m',
        forEvaluations: 1,
        severity: 'low',
        unit: '1',
      })
    ).toBe('system.cpu.utilization below 10% (avg over 1 minute, 1 check)');
    expect(
      summarizeMetricRule({
        query: buildMetricAlertQuery(explorer(), 'F1'),
        condition: 'above',
        threshold: 5,
        window: '1h',
        forEvaluations: 2,
        severity: 'high',
      })
    ).toBe('A / B * 100 above 5 (avg over 60 minutes, 2 checks)');
  });

  it('formats instance labels', () => {
    expect(instanceLabels({ 'host.name': 'web-1' })).toBe('host.name=web-1');
    expect(instanceLabels({})).toBe('');
    expect(instanceLabels(null)).toBe('');
  });
});
