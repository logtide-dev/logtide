import { describe, it, expect } from 'vitest';
import type { MetricAlertConfig, MetricQueryResponse } from '@logtide/shared';
import {
  groupsFromResponse,
  metricAlertWindowRange,
  metricIncidentTitle,
  metricInstanceTitle,
  planMetricInstances,
  type MetricInstanceRow,
} from '../../../modules/alerts/metric-evaluator.js';
import { assertValidMetricConfig, parseMetricAlertConfig } from '../../../modules/alerts/metric-config.js';
import { AlertRuleInputError } from '../../../modules/alerts/validation.js';
import { alertNotificationJobKey } from '../../../queue/jobs/alert-evaluation.js';

const NOW = new Date('2026-11-25T10:07:30.000Z');
const plus = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function config(o: Partial<MetricAlertConfig> = {}): MetricAlertConfig {
  return {
    query: {
      projectIds: null,
      queries: [
        {
          id: 'A',
          metricName: 'system.cpu.utilization',
          aggregation: 'avg',
          filters: [],
          groupBy: [{ scope: 'resource', key: 'host.name' }],
        },
      ],
      formulas: [],
      interval: 'auto',
      compareTo: 'none',
      display: 'lines',
    },
    condition: 'above',
    threshold: 0.9,
    window: '5m',
    forEvaluations: 2,
    severity: 'high',
    ...o,
  };
}

const RULE = { snoozedUntil: null, renotifyMinutes: null };

function instance(o: Partial<MetricInstanceRow> = {}): MetricInstanceRow {
  return {
    group_key: 'host.name=web-1',
    labels: { 'host.name': 'web-1' },
    state: 'ok',
    consecutive_breaches: 0,
    last_value: null,
    last_triggered_at: null,
    last_notified_at: null,
    ...o,
  };
}

const web1 = (value: number | null) => ({ groupKey: 'host.name=web-1', labels: { 'host.name': 'web-1' }, value });

describe('metricAlertWindowRange', () => {
  it('ends at the start of the current minute and spans whole minutes', () => {
    const { from, to } = metricAlertWindowRange('5m', NOW);
    expect(to.toISOString()).toBe('2026-11-25T10:07:00.000Z');
    expect(from.toISOString()).toBe('2026-11-25T10:02:00.000Z');
    expect(metricAlertWindowRange('1h', NOW).from.toISOString()).toBe('2026-11-25T09:07:00.000Z');
  });
});

describe('groupsFromResponse', () => {
  const response = (o: Partial<MetricQueryResponse> = {}): MetricQueryResponse => ({
    interval: '1m',
    warnings: [],
    queries: [{ id: 'A', seriesTotal: 2, seriesShown: 2, metricType: 'gauge', unit: '1' }],
    series: [
      {
        id: 'A|host.name=web-1',
        queryId: 'A',
        labels: { 'host.name': 'web-1' },
        name: 'web-1',
        unit: '1',
        comparison: false,
        points: [
          { t: 'a', v: 0.8 },
          { t: 'b', v: null },
          { t: 'c', v: 1 },
        ],
        stats: { min: 0.8, avg: 0.9, max: 1, last: 1 },
      },
      {
        id: 'A|__other__',
        queryId: 'A',
        labels: { __other__: 'true' },
        name: 'other',
        unit: '1',
        comparison: false,
        points: [{ t: 'a', v: 5 }],
        stats: { min: 5, avg: 5, max: 5, last: 5 },
      },
      {
        id: 'A|host.name=web-2',
        queryId: 'A',
        labels: { 'host.name': 'web-2' },
        name: 'web-2',
        unit: '1',
        comparison: false,
        points: [{ t: 'a', v: null }],
        stats: { min: null, avg: null, max: null, last: null },
      },
    ],
    ...o,
  });

  it('averages the non-null buckets per group and skips the folded rest', () => {
    const result = groupsFromResponse(config(), response());
    expect(result).toMatchObject({ queryId: 'A', source: 'system.cpu.utilization', unit: '1' });
    expect(result.groups).toEqual([
      { groupKey: 'host.name=web-1', labels: { 'host.name': 'web-1' }, value: 0.9 },
      { groupKey: 'host.name=web-2', labels: { 'host.name': 'web-2' }, value: null },
    ]);
  });

  it('treats an unknown metric as no data and other errors as a failure', () => {
    const unknown = response({
      series: [],
      queries: [{ id: 'A', seriesTotal: 0, seriesShown: 0, metricType: null, unit: null, error: 'Unknown metric "x"' }],
    });
    expect(groupsFromResponse(config(), unknown).groups).toEqual([]);
    const broken = response({
      queries: [{ id: 'A', seriesTotal: 0, seriesShown: 0, metricType: null, unit: null, error: 'engine down' }],
    });
    expect(() => groupsFromResponse(config(), broken)).toThrow(/engine down/);
  });
});

describe('planMetricInstances', () => {
  it('counts consecutive breaches before firing (forEvaluations)', () => {
    const [first] = planMetricInstances(config(), [web1(0.95)], [], RULE, NOW);
    expect(first.decision).toEqual({ type: 'none' });
    expect(first.next).toMatchObject({ state: 'ok', consecutive_breaches: 1, last_value: 0.95 });

    const [second] = planMetricInstances(
      config(),
      [web1(0.97)],
      [instance({ consecutive_breaches: 1, last_value: 0.95 })],
      RULE,
      NOW
    );
    expect(second.decision).toEqual({ type: 'fire', notification: 'triggered' });
    expect(second.next).toMatchObject({ state: 'firing', consecutive_breaches: 2, last_triggered_at: NOW, last_notified_at: NOW });
  });

  it('a non breaching run resets the counter and drops the row', () => {
    const [plan] = planMetricInstances(config(), [web1(0.5)], [instance({ consecutive_breaches: 1 })], RULE, NOW);
    expect(plan.decision).toEqual({ type: 'none' });
    expect(plan.next).toBeNull();
  });

  it('is strict on the threshold', () => {
    const [plan] = planMetricInstances(config({ forEvaluations: 1 }), [web1(0.9)], [], RULE, NOW);
    expect(plan.decision).toEqual({ type: 'none' });
    expect(plan.next).toBeNull();
  });

  it('supports below conditions', () => {
    const [plan] = planMetricInstances(config({ condition: 'below', threshold: 0.1, forEvaluations: 1 }), [web1(0.05)], [], RULE, NOW);
    expect(plan.decision).toEqual({ type: 'fire', notification: 'triggered' });
  });

  it('keeps firing while breaching, then resolves on the first good run', () => {
    const firing = instance({ state: 'firing', consecutive_breaches: 3, last_triggered_at: NOW, last_notified_at: NOW });
    const [steady] = planMetricInstances(config(), [web1(0.99)], [firing], RULE, plus(1));
    expect(steady.decision).toEqual({ type: 'none' });
    expect(steady.next).toMatchObject({ state: 'firing', consecutive_breaches: 4 });

    const [resolved] = planMetricInstances(config(), [web1(0.2)], [firing], RULE, plus(2));
    expect(resolved.decision).toEqual({ type: 'resolve', notification: 'resolved' });
    expect(resolved.next).toBeNull();
  });

  it('resolves a firing group that has no data any more', () => {
    const firing = instance({ state: 'firing', consecutive_breaches: 3, last_triggered_at: NOW, last_notified_at: NOW });
    const [plan] = planMetricInstances(config(), [], [firing], RULE, plus(1));
    expect(plan).toMatchObject({ groupKey: 'host.name=web-1', value: null, decision: { type: 'resolve', notification: 'resolved' } });
  });

  it('fires silently while snoozed and notifies once the snooze ends', () => {
    const snoozed = { snoozedUntil: plus(10), renotifyMinutes: null };
    const [silent] = planMetricInstances(config({ forEvaluations: 1 }), [web1(0.95)], [], snoozed, NOW);
    expect(silent.decision).toEqual({ type: 'fire', notification: null });
    expect(silent.next).toMatchObject({ state: 'firing', last_notified_at: null });

    const firing = instance({ state: 'firing', consecutive_breaches: 1, last_triggered_at: NOW });
    const [later] = planMetricInstances(config(), [web1(0.95)], [firing], RULE, plus(11));
    expect(later.decision).toEqual({ type: 'notify', notification: 'triggered' });
  });

  it('re-notifies after renotifyMinutes', () => {
    const firing = instance({ state: 'firing', consecutive_breaches: 5, last_triggered_at: NOW, last_notified_at: NOW });
    const rule = { snoozedUntil: null, renotifyMinutes: 30 };
    expect(planMetricInstances(config(), [web1(0.95)], [firing], rule, plus(29))[0].decision).toEqual({ type: 'none' });
    expect(planMetricInstances(config(), [web1(0.95)], [firing], rule, plus(30))[0].decision).toEqual({
      type: 'notify',
      notification: 'renotify',
    });
  });

  it('plans every group independently', () => {
    const plans = planMetricInstances(
      config({ forEvaluations: 1 }),
      [web1(0.95), { groupKey: 'host.name=web-2', labels: { 'host.name': 'web-2' }, value: 0.1 }],
      [],
      RULE,
      NOW
    );
    expect(plans.map((p) => [p.groupKey, p.decision.type])).toEqual([
      ['host.name=web-1', 'fire'],
      ['host.name=web-2', 'none'],
    ]);
  });
});

describe('titles', () => {
  it('names the instance and the firing groups', () => {
    expect(metricInstanceTitle('CPU high', {})).toBe('CPU high');
    expect(metricInstanceTitle('CPU high', { 'host.name': 'web-1' })).toBe('CPU high (host.name=web-1)');
    expect(metricIncidentTitle('CPU high', [{}])).toBe('CPU high');
    expect(
      metricIncidentTitle('CPU high', [
        { 'host.name': 'd' },
        { 'host.name': 'a' },
        { 'host.name': 'c' },
        { 'host.name': 'b' },
      ])
    ).toBe('CPU high (host.name=a; host.name=b; host.name=c +1 more)');
  });
});

describe('metric config validation', () => {
  it('accepts a single visible formula over hidden operands', () => {
    const c = config();
    const parsed = parseMetricAlertConfig({
      ...c,
      query: {
        ...c.query,
        queries: [
          { ...c.query.queries[0], id: 'A', hidden: true },
          { ...c.query.queries[0], id: 'B', hidden: true },
        ],
        formulas: [{ id: 'F1', expression: 'A / B * 100' }],
      },
    });
    expect(parsed.severity).toBe('high');
  });

  it('rejects zero or several visible items', () => {
    const c = config();
    expect(() =>
      assertValidMetricConfig({ ...c, query: { ...c.query, queries: [c.query.queries[0], { ...c.query.queries[0], id: 'B' }] } })
    ).toThrow(AlertRuleInputError);
    expect(() =>
      assertValidMetricConfig({ ...c, query: { ...c.query, queries: [{ ...c.query.queries[0], hidden: true }] } })
    ).toThrow(/exactly one visible/);
  });

  it('rejects formulas over unknown queries and dashboard variables', () => {
    const c = config();
    expect(() =>
      assertValidMetricConfig({
        ...c,
        query: { ...c.query, queries: [{ ...c.query.queries[0], hidden: true }], formulas: [{ id: 'F1', expression: 'A + B' }] },
      })
    ).toThrow(/unknown query B/);
    expect(() =>
      assertValidMetricConfig({
        ...c,
        query: {
          ...c.query,
          queries: [{ ...c.query.queries[0], filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['$host'] }] }],
        },
      })
    ).toThrow(/variables/);
  });

  it('rejects bad window, evaluations and threshold shapes', () => {
    expect(() => parseMetricAlertConfig({ ...config(), window: '2m' })).toThrow();
    expect(() => parseMetricAlertConfig({ ...config(), forEvaluations: 11 })).toThrow();
    expect(() => parseMetricAlertConfig({ ...config(), forEvaluations: 0 })).toThrow();
    expect(() => parseMetricAlertConfig({ ...config(), threshold: Number.NaN })).toThrow();
  });
});

describe('alertNotificationJobKey for metric instances', () => {
  const base = {
    kind: 'resolved' as const,
    rule_id: 'r1',
    rule_name: 'CPU',
    organization_id: 'o',
    project_id: null,
    alert_type: 'metric' as const,
    log_count: 0,
    threshold: 0.9,
    time_window: 5,
    firing_since: NOW.toISOString(),
    resolved_at: NOW.toISOString(),
    incident_id: null,
  };
  const metric = (groupKey: string) => ({
    query_id: 'A',
    source: 'cpu',
    condition: 'above' as const,
    threshold: 0.9,
    value: 0.1,
    unit: null,
    window: '5m' as const,
    for_evaluations: 1,
    labels: {},
    group_key: groupKey,
  });

  it('gives every group of an episode its own colon free resolve key', () => {
    const a = alertNotificationJobKey({ ...base, metric: metric('host.name=a') });
    const b = alertNotificationJobKey({ ...base, metric: metric('host.name=b') });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^alert-resolved-r1-\d+-[0-9a-f]{16}$/);
    expect(alertNotificationJobKey({ ...base, metric: metric('') })).toBe(`alert-resolved-r1-${NOW.getTime()}`);
  });
});
