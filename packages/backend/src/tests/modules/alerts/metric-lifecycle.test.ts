import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../../../queue/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../queue/connection.js')>();
  return { ...actual, createQueue: vi.fn(() => ({ add })) };
});

import type { MetricAlertConfig, MetricQueryResponse, MetricSeries } from '@logtide/shared';
import { db } from '../../../database/index.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import { metricQueryService } from '../../../modules/metrics/query/service.js';
import type { AlertEvaluationResult } from '../../../modules/alerts/types.js';
import { createTestContext, createTestProject } from '../../helpers/factories.js';
import { getRuleRow } from './lifecycle-test-helpers.js';

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';

let NOW: Date;
const plus = (t: Date, minutes: number) => new Date(t.getTime() + minutes * 60_000);
const run = (t: Date): Promise<AlertEvaluationResult[]> => alertsService.checkAlertRules({ now: t });

let runSpy: ReturnType<typeof vi.spyOn>;
let openSpy: ReturnType<typeof vi.spyOn>;
let resolveSpy: ReturnType<typeof vi.spyOn>;
let retitleSpy: ReturnType<typeof vi.spyOn>;

/** Values per group for the next query runs: { 'web-1': 0.95 } or { '': 0.95 } when ungrouped. */
let values: Record<string, number | null> = {};

/** One point per minute of the queried range (the lead step included). */
function series(host: string, value: number | null, from: number, to: number): MetricSeries {
  const labels: Record<string, string> = host ? { 'host.name': host } : {};
  const points: MetricSeries['points'] = [];
  for (let t = from; t < to; t += 60_000) points.push({ t: new Date(t).toISOString(), v: value });
  return {
    id: `A|${host}`,
    queryId: 'A',
    labels,
    name: host || 'cpu',
    unit: '1',
    comparison: false,
    points,
    stats: { min: value, avg: value, max: value, last: value },
  };
}

function response(req?: { from: string; to: string }): MetricQueryResponse {
  const to = req ? Date.parse(req.to) : Date.now();
  const from = req ? Date.parse(req.from) : to - 2 * 60_000;
  return {
    interval: '1m',
    warnings: [],
    queries: [{ id: 'A', seriesTotal: 1, seriesShown: 1, metricType: 'gauge', unit: '1' }],
    series: Object.entries(values).map(([host, v]) => series(host, v, from, to)),
  };
}

function config(o: Partial<MetricAlertConfig> = {}, grouped = false, projectIds: string[] | null = null): MetricAlertConfig {
  return {
    query: {
      projectIds,
      queries: [
        {
          id: 'A',
          metricName: 'system.cpu.utilization',
          aggregation: 'avg',
          filters: [],
          groupBy: grouped ? [{ scope: 'resource', key: 'host.name' }] : [],
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
    forEvaluations: 1,
    severity: 'critical',
    ...o,
  };
}

async function metricRule(cfg: MetricAlertConfig, o: { renotifyMinutes?: number | null } = {}) {
  const ctx = await createTestContext();
  const rule = await alertsService.createAlertRule({
    organizationId: ctx.organization.id,
    name: 'CPU high',
    level: [],
    threshold: 0,
    timeWindow: 0,
    alertType: 'metric',
    emailRecipients: [],
    metricConfig: cfg,
    renotifyMinutes: o.renotifyMinutes ?? null,
  });
  return { ...ctx, rule };
}

async function instances(ruleId: string, organizationId: string) {
  return db
    .selectFrom('alert_metric_instances')
    .selectAll()
    .where('rule_id', '=', ruleId)
    .where('organization_id', '=', organizationId)
    .orderBy('group_key')
    .execute();
}

async function history(ruleId: string) {
  return db
    .selectFrom('alert_history')
    .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
    .select(['alert_history.id', 'alert_history.metric_metadata', 'alert_history.log_count'])
    .where('alert_history.rule_id', '=', ruleId)
    .orderBy('alert_history.triggered_at')
    .execute();
}

beforeEach(() => {
  const d = new Date();
  d.setSeconds(30, 0);
  NOW = d;
  values = {};
  add.mockReset().mockResolvedValue(undefined);
  runSpy = vi.spyOn(metricQueryService, 'run').mockImplementation(async (req) => response(req));
  openSpy = vi
    .spyOn(incidentsService, 'openOrUpdateFromSource')
    .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });
  resolveSpy = vi.spyOn(incidentsService, 'resolveFromSource').mockResolvedValue({ id: INCIDENT_ID } as never);
  retitleSpy = vi.spyOn(incidentsService, 'setSeverityFromSource').mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('metric rule creation', () => {
  it('stores the definition with neutral log columns', async () => {
    const { rule, project } = await metricRule(config({}, false, null));
    expect(rule).toMatchObject({ alertType: 'metric', level: [], threshold: 0, timeWindow: 5, projectId: null });
    expect(rule.metricConfig).toMatchObject({ threshold: 0.9, window: '5m', severity: 'critical' });
    void project;
  });
});

describe('metric rule evaluation (ungrouped)', () => {
  it('queries the last full minutes of the window plus a lead step, every group, at 1 minute', async () => {
    const { rule, organization, project } = await metricRule(config());
    values = { '': 0.5 };
    await run(NOW);
    expect(runSpy).toHaveBeenCalledTimes(1);
    const req = runSpy.mock.calls[0][0] as Record<string, any>;
    const to = Math.floor(NOW.getTime() / 60_000) * 60_000;
    expect(req).toMatchObject({
      organizationId: organization.id,
      projectIds: [project.id],
      interval: '1m',
      compareTo: 'none',
      from: new Date(to - 6 * 60_000).toISOString(),
      to: new Date(to).toISOString(),
      internal: { unfoldedGroups: true },
    });
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('fires after N breaching runs, stays quiet while firing, resolves once', async () => {
    const { rule, organization } = await metricRule(config({ forEvaluations: 2 }));
    values = { '': 0.95 };

    expect(await run(NOW)).toEqual([]);
    expect(await instances(rule.id, organization.id)).toMatchObject([{ state: 'ok', consecutive_breaches: 1 }]);

    const fired = await run(plus(NOW, 1));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      kind: 'triggered',
      rule_id: rule.id,
      alert_type: 'metric',
      threshold: 0.9,
      time_window: 5,
      incident_id: INCIDENT_ID,
      metric: {
        query_id: 'A',
        source: 'system.cpu.utilization',
        value: 0.95,
        unit: '1',
        condition: 'above',
        labels: {},
        group_key: '',
      },
    });
    const rows = await history(rule.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].metric_metadata).toMatchObject({ value: 0.95, window: '5m' });
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'CPU high', severity: 'critical', sourceId: rule.id })
    );
    expect((await getRuleRow(rule.id)).state).toBe('firing');

    expect(await run(plus(NOW, 2))).toEqual([]);

    values = { '': 0.3 };
    const resolved = await run(plus(NOW, 3));
    expect(resolved).toEqual([
      expect.objectContaining({
        kind: 'resolved',
        alert_type: 'metric',
        incident_id: INCIDENT_ID,
        firing_since: plus(NOW, 1).toISOString(),
        metric: expect.objectContaining({ value: 0.3 }),
      }),
    ]);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
    expect(await instances(rule.id, organization.id)).toEqual([]);
  });

  it('a missing series is no data: the pending count is held, neither counted nor reset', async () => {
    const { rule, organization } = await metricRule(config({ forEvaluations: 2 }));
    values = { '': 0.95 };
    await run(NOW);
    values = {};
    expect(await run(plus(NOW, 1))).toEqual([]);
    expect(await instances(rule.id, organization.id)).toMatchObject([{ state: 'ok', consecutive_breaches: 1 }]);
    values = { '': 0.95 };
    expect(await run(plus(NOW, 2))).toEqual([expect.objectContaining({ kind: 'triggered' })]);
  });

  it('no data never resolves a firing rule by itself', async () => {
    const { rule, organization } = await metricRule(config(), { renotifyMinutes: 5 });
    values = { '': 0.95 };
    expect(await run(NOW)).toHaveLength(1);

    // Series gone, then present with null points: held, no re-notify either.
    values = {};
    for (let m = 1; m <= 12; m++) {
      if (m === 6) values = { '': null };
      expect(await run(plus(NOW, m))).toEqual([]);
    }
    expect((await getRuleRow(rule.id)).state).toBe('firing');
    expect(await instances(rule.id, organization.id)).toMatchObject([{ state: 'firing', last_value: 0.95 }]);
    expect(resolveSpy).not.toHaveBeenCalled();

    // Data back on the good side: resolves.
    values = { '': 0.1 };
    expect(await run(plus(NOW, 13))).toEqual([expect.objectContaining({ kind: 'resolved' })]);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('resolves a firing instance with reason no_data after 10 evaluations and 60 minutes, and the incident with it', async () => {
    const { rule, organization } = await metricRule(config());
    values = { '': 0.95 };
    expect(await run(NOW)).toHaveLength(1);

    values = {};
    // Streak starts at minute 6; the 10th run at minute 66 reaches 10 evaluations and 60 minutes.
    for (let i = 1; i <= 9; i++) {
      expect(await run(plus(NOW, i * 6))).toEqual([]);
    }
    expect(await instances(rule.id, organization.id)).toMatchObject([
      { state: 'firing', no_data_evaluations: 9 },
    ]);
    expect(resolveSpy).not.toHaveBeenCalled();

    const out = await run(plus(NOW, 66));
    expect(out).toEqual([
      expect.objectContaining({
        kind: 'resolved',
        incident_id: INCIDENT_ID,
        metric: expect.objectContaining({ reason: 'no_data', value: 0.95, group_key: '' }),
      }),
    ]);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
    expect(await instances(rule.id, organization.id)).toEqual([]);
  });

  it('does not resolve on no data before the time bound, however many runs', async () => {
    const { rule } = await metricRule(config());
    values = { '': 0.95 };
    await run(NOW);
    values = {};
    for (let m = 1; m <= 30; m++) expect(await run(plus(NOW, m))).toEqual([]);
    expect((await getRuleRow(rule.id)).state).toBe('firing');
  });

  it('data returning resets the no data streak', async () => {
    const { rule, organization } = await metricRule(config());
    values = { '': 0.95 };
    await run(NOW);
    values = {};
    for (let m = 1; m <= 5; m++) await run(plus(NOW, m));
    expect(await instances(rule.id, organization.id)).toMatchObject([{ no_data_evaluations: 5 }]);
    values = { '': 0.97 };
    await run(plus(NOW, 6));
    expect(await instances(rule.id, organization.id)).toMatchObject([{ state: 'firing', no_data_evaluations: 0, no_data_since: null }]);
  });

  it('clears a pending instance after the no data bound without notifying', async () => {
    const { rule, organization } = await metricRule(config({ forEvaluations: 2 }));
    values = { '': 0.95 };
    await run(NOW);
    values = {};
    for (let m = 1; m <= 10; m++) await run(plus(NOW, m * 7));
    expect(await instances(rule.id, organization.id)).toEqual([]);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('re-notifies on the rule interval', async () => {
    const { rule } = await metricRule(config(), { renotifyMinutes: 10 });
    values = { '': 0.95 };
    await run(NOW);
    expect(await run(plus(NOW, 5))).toEqual([]);
    const again = await run(plus(NOW, 10));
    expect(again).toEqual([expect.objectContaining({ kind: 'renotify', rule_id: rule.id })]);
    expect(await history(rule.id)).toHaveLength(2);
  });

  it('snoozed: fires silently, never suppresses the resolve of a notified episode', async () => {
    const { rule, organization } = await metricRule(config());
    values = { '': 0.95 };
    await alertsService.snoozeAlertRule(rule.id, organization.id, plus(NOW, 60));
    expect(await run(NOW)).toEqual([]);
    expect((await getRuleRow(rule.id)).state).toBe('firing');
    expect(await history(rule.id)).toHaveLength(0);

    // Not notified episode: resolves without a notification.
    values = { '': 0.1 };
    expect(await run(plus(NOW, 1))).toEqual([]);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('two concurrent evaluators apply a run only once', async () => {
    const { rule } = await metricRule(config());
    values = { '': 0.95 };
    const [a, b] = await Promise.all([run(NOW), run(NOW)]);
    expect([...a, ...b].filter((r) => r.rule_id === rule.id)).toHaveLength(1);
    expect(await history(rule.id)).toHaveLength(1);
  });

  it('a failing query skips the rule and keeps its state', async () => {
    const { rule } = await metricRule(config());
    runSpy.mockRejectedValueOnce(new Error('engine down'));
    expect(await run(NOW)).toEqual([]);
    const row = await getRuleRow(rule.id);
    expect(row.state).toBe('ok');
    expect(row.last_evaluated_at).toBeNull();
  });

  it('a query whose projects are all gone reads nothing and resolves', async () => {
    const ctx = await createTestContext();
    const other = await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id });
    const rule = await alertsService.createAlertRule({
      organizationId: ctx.organization.id,
      name: 'Gone',
      level: [],
      threshold: 0,
      timeWindow: 0,
      alertType: 'metric',
      emailRecipients: [],
      metricConfig: config({}, false, [other.id]),
    });
    expect(rule.projectId).toBe(other.id);
    await db
      .updateTable('projects')
      .set({ deleted_at: new Date() })
      .where('id', '=', other.id)
      .where('organization_id', '=', ctx.organization.id)
      .execute();
    values = { '': 0.95 };
    expect(await run(NOW)).toEqual([]);
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe('metric rule evaluation (grouped)', () => {
  it('each group is its own instance, labelled in the payload and the incident title', async () => {
    const { rule, organization } = await metricRule(config({}, true));
    values = { 'web-1': 0.95, 'web-2': 0.2 };

    const first = await run(NOW);
    expect(first).toEqual([
      expect.objectContaining({
        kind: 'triggered',
        metric: expect.objectContaining({ labels: { 'host.name': 'web-1' }, group_key: 'host.name=web-1' }),
      }),
    ]);
    expect(openSpy).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'CPU high (host.name=web-1)' }));

    values = { 'web-1': 0.95, 'web-2': 0.97 };
    const second = await run(plus(NOW, 1));
    expect(second).toEqual([
      expect.objectContaining({ kind: 'triggered', metric: expect.objectContaining({ group_key: 'host.name=web-2' }) }),
    ]);
    expect(retitleSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'CPU high (host.name=web-1; host.name=web-2)', severity: 'critical' })
    );
    expect((await instances(rule.id, organization.id)).map((i) => i.state)).toEqual(['firing', 'firing']);

    // web-1 recovers: its own resolve, the incident stays open with web-2.
    values = { 'web-1': 0.1, 'web-2': 0.97 };
    const third = await run(plus(NOW, 2));
    expect(third).toEqual([
      expect.objectContaining({ kind: 'resolved', metric: expect.objectContaining({ group_key: 'host.name=web-1' }) }),
    ]);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(retitleSpy).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'CPU high (host.name=web-2)' }));
    expect((await getRuleRow(rule.id)).state).toBe('firing');

    // web-2 disappears (no data): held, the incident stays open.
    values = { 'web-1': 0.1 };
    expect(await run(plus(NOW, 3))).toEqual([]);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect((await getRuleRow(rule.id)).state).toBe('firing');

    // web-2 comes back below the threshold: last instance resolves, so does the incident.
    values = { 'web-1': 0.1, 'web-2': 0.3 };
    const fifth = await run(plus(NOW, 4));
    expect(fifth).toEqual([
      expect.objectContaining({ kind: 'resolved', metric: expect.objectContaining({ group_key: 'host.name=web-2', value: 0.3 }) }),
    ]);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('below rules: the lowest groups get instances, ranked before any cap', async () => {
    const { rule, organization } = await metricRule(config({ condition: 'below', threshold: 0.05 }, true));
    values = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`h${String(i).padStart(2, '0')}`, i / 100]));
    const fired = await run(NOW);
    // 0.00 .. 0.04 breach (strictly below 0.05).
    expect(fired.map((r) => r.metric?.group_key).sort()).toEqual(
      ['h00', 'h01', 'h02', 'h03', 'h04'].map((h) => `host.name=${h}`)
    );
    expect(await instances(rule.id, organization.id)).toHaveLength(5);
  });

  it('a disable while the query runs: the run applies nothing and opens no incident', async () => {
    const { rule, organization } = await metricRule(config());
    values = { '': 0.95 };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const inQuery = new Promise<void>((r) => (started = r));
    runSpy.mockImplementationOnce(async (req) => {
      started();
      await gate;
      return response(req as { from: string; to: string });
    });

    const evaluation = run(NOW);
    await inQuery;
    await alertsService.updateAlertRule(rule.id, organization.id, { enabled: false });
    release();
    expect(await evaluation).toEqual([]);

    expect(openSpy).not.toHaveBeenCalled();
    expect(await instances(rule.id, organization.id)).toEqual([]);
    const row = await getRuleRow(rule.id);
    expect(row).toMatchObject({ state: 'ok', enabled: false });
  });

  it('a disable during the incident phase waits for it, then resolves; no incident is opened afterwards', async () => {
    const { rule, organization } = await metricRule(config());
    values = { '': 0.95 };
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let opening!: () => void;
    const inOpen = new Promise<void>((r) => (opening = r));
    openSpy.mockImplementation(async () => {
      opening();
      await gate;
      order.push('open');
      return { incident: { id: INCIDENT_ID } as never, created: true };
    });
    resolveSpy.mockImplementation(async () => {
      order.push('resolve');
      return { id: INCIDENT_ID } as never;
    });

    const evaluation = run(NOW);
    await inOpen;
    const disable = alertsService.updateAlertRule(rule.id, organization.id, { enabled: false });
    // The disable needs the rule row lock held by the incident phase.
    await new Promise((r) => setTimeout(r, 200));
    expect(order).toEqual([]);
    release();
    await Promise.all([evaluation, disable]);

    expect(order).toEqual(['open', 'resolve']);
    expect(await instances(rule.id, organization.id)).toEqual([]);
    expect(await getRuleRow(rule.id)).toMatchObject({ state: 'ok', enabled: false });

    // A later run of a disabled rule does nothing.
    expect(await run(plus(NOW, 1))).toEqual([]);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('deleting a firing rule resolves its incident first and queues the resolves', async () => {
    const { rule, organization } = await metricRule(config({}, true));
    values = { 'web-1': 0.95 };
    await run(NOW);
    expect(await alertsService.deleteAlertRule(rule.id, organization.id)).toBe(true);
    expect(resolveSpy).toHaveBeenCalledWith(expect.objectContaining({ sourceId: rule.id, reason: 'manual' }));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][1]).toMatchObject({ kind: 'resolved', metric: { group_key: 'host.name=web-1', value: 0.95 } });
    expect(await instances(rule.id, organization.id)).toEqual([]);
    expect(await alertsService.getAlertRule(rule.id, organization.id)).toBeNull();
  });

  it('disabling a firing rule queues one resolve per notified instance and forgets them', async () => {
    const { rule, organization } = await metricRule(config({}, true));
    values = { 'web-1': 0.95, 'web-2': 0.96 };
    await run(NOW);
    await alertsService.updateAlertRule(rule.id, organization.id, { enabled: false });

    expect(add).toHaveBeenCalledTimes(2);
    const jobs = add.mock.calls.map((c) => c[1]);
    expect(jobs.map((j) => j.metric.group_key).sort()).toEqual(['host.name=web-1', 'host.name=web-2']);
    expect(new Set(add.mock.calls.map((c) => c[2].jobKey)).size).toBe(2);
    expect(await instances(rule.id, organization.id)).toEqual([]);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });
});
