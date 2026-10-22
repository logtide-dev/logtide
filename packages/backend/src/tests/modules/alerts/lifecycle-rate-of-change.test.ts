import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { baselineCalculator } from '../../../modules/alerts/baseline-calculator.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import type { AlertEvaluationResult } from '../../../modules/alerts/types.js';
import { createTestAlertRule, createTestContext } from '../../helpers/factories.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';

let NOW: Date;
const plus = (t: Date, minutes: number) => new Date(t.getTime() + minutes * 60_000);
const run = (t: Date): Promise<AlertEvaluationResult[]> => alertsService.checkAlertRules({ now: t });

let calculate: ReturnType<typeof vi.spyOn>;
let rate: ReturnType<typeof vi.spyOn>;
let openSpy: ReturnType<typeof vi.spyOn>;
let resolveSpy: ReturnType<typeof vi.spyOn>;

async function historyCount(ruleId: string): Promise<number> {
  const row = await db
    .selectFrom('alert_history')
    .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('alert_history.rule_id', '=', ruleId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

async function rocRule(o: Parameters<typeof createTestAlertRule>[0] = {}) {
  const ctx = await createTestContext();
  const rule = await createTestAlertRule({
    organizationId: ctx.organization.id,
    projectId: ctx.project.id,
    name: 'Error spike',
    alertType: 'rate_of_change',
    baselineType: 'rolling_7d_avg',
    deviationMultiplier: 3,
    minBaselineValue: 1,
    cooldownMinutes: 60,
    sustainedMinutes: 1,
    level: ['error'],
    ...o,
  });
  return { ...ctx, rule };
}

beforeEach(() => {
  const d = new Date();
  d.setMilliseconds(0);
  NOW = d;
  calculate = vi.spyOn(baselineCalculator, 'calculate').mockResolvedValue({ value: 10, samplesUsed: 5 });
  rate = vi.spyOn(baselineCalculator, 'getCurrentHourlyRate').mockResolvedValue(100);
  openSpy = vi
    .spyOn(incidentsService, 'openOrUpdateFromSource')
    .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });
  resolveSpy = vi.spyOn(incidentsService, 'resolveFromSource').mockResolvedValue({ id: INCIDENT_ID } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rate-of-change lifecycle', () => {
  it('an anomaly moves an ok rule to firing and notifies', async () => {
    const { rule } = await rocRule();

    expect(await run(NOW)).toEqual([
      expect.objectContaining({
        kind: 'triggered',
        rule_id: rule.id,
        log_count: 100,
        firing_since: NOW.toISOString(),
        incident_id: INCIDENT_ID,
        baseline_metadata: expect.objectContaining({
          deviation_ratio: 10,
          baseline_value: 10,
          current_value: 100,
          evaluation_time: NOW.toISOString(),
        }),
      }),
    ]);
    expect(await getRuleRow(rule.id)).toMatchObject({ state: 'firing', last_triggered_at: NOW, last_notified_at: NOW });
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: rule.id,
        metadata: expect.objectContaining({ alertType: 'rate_of_change', baselineMetadata: expect.objectContaining({ deviation_ratio: 10 }) }),
      })
    );
    const history = await db
      .selectFrom('alert_history')
      .select(['baseline_metadata'])
      .where('rule_id', '=', rule.id)
      .executeTakeFirstOrThrow();
    expect(history.baseline_metadata).toMatchObject({ deviation_ratio: 10 });
  });

  it('the cooldown suppresses a second notification while the anomaly persists', async () => {
    const { rule } = await rocRule();

    expect(await run(NOW)).toHaveLength(1);
    expect(await run(plus(NOW, 5))).toEqual([]);
    expect(await historyCount(rule.id)).toBe(1);
    expect((await getRuleRow(rule.id)).state).toBe('firing');
  });

  it('notifies again after the cooldown when still anomalous', async () => {
    const { rule } = await rocRule();

    expect(await run(NOW)).toHaveLength(1);
    expect(await run(plus(NOW, 5))).toEqual([]);
    expect(await run(plus(NOW, 61))).toEqual([
      expect.objectContaining({ kind: 'renotify', rule_id: rule.id, firing_since: NOW.toISOString() }),
    ]);
    expect(await historyCount(rule.id)).toBe(2);
  });

  it('a recovery inside the cooldown resolves the rule', async () => {
    const { rule, organization } = await rocRule();

    expect(await run(NOW)).toHaveLength(1);
    rate.mockResolvedValue(5);
    expect(await run(plus(NOW, 5))).toEqual([
      expect.objectContaining({
        kind: 'resolved',
        rule_id: rule.id,
        alert_type: 'rate_of_change',
        log_count: 5,
        firing_since: NOW.toISOString(),
        resolved_at: plus(NOW, 5).toISOString(),
        incident_id: INCIDENT_ID,
      }),
    ]);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
    expect(resolveSpy).toHaveBeenCalledWith({
      organizationId: organization.id,
      source: 'alert',
      sourceId: rule.id,
      resolvedAt: plus(NOW, 5),
      reason: 'recovered',
    });
  });

  it('an ok rule inside the cooldown runs no baseline queries', async () => {
    await rocRule();

    expect(await run(NOW)).toHaveLength(1);
    rate.mockResolvedValue(5);
    expect(await run(plus(NOW, 5))).toEqual([expect.objectContaining({ kind: 'resolved' })]);

    const calculateCalls = calculate.mock.calls.length;
    const rateCalls = rate.mock.calls.length;
    rate.mockResolvedValue(100);
    expect(await run(plus(NOW, 10))).toEqual([]);
    expect(calculate.mock.calls.length).toBe(calculateCalls);
    expect(rate.mock.calls.length).toBe(rateCalls);
  });

  it('a snoozed anomaly tracks state without notifying', async () => {
    const { rule } = await rocRule();
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });

    expect(await run(NOW)).toEqual([]);
    expect(await getRuleRow(rule.id)).toMatchObject({ state: 'firing', last_triggered_at: NOW, last_notified_at: null });
    expect(await historyCount(rule.id)).toBe(0);
    expect(openSpy).toHaveBeenCalledTimes(1);

    // Still anomalous while snoozed (no history row, so no cooldown): quiet.
    expect(await run(plus(NOW, 1))).toEqual([]);
    // Snooze over, still anomalous: the episode's first notification.
    expect(await run(plus(NOW, 61))).toEqual([expect.objectContaining({ kind: 'triggered', firing_since: NOW.toISOString() })]);
    expect(await historyCount(rule.id)).toBe(1);
  });

  it('a recovery of a snoozed episode that never notified sends nothing but resolves the incident', async () => {
    const { rule } = await rocRule();
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });

    expect(await run(NOW)).toEqual([]);
    rate.mockResolvedValue(5);
    expect(await run(plus(NOW, 1))).toEqual([]);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it('a recovery while snoozed still sends the resolve of a notified episode', async () => {
    const { rule } = await rocRule();

    expect(await run(NOW)).toHaveLength(1);
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });
    rate.mockResolvedValue(5);
    expect(await run(plus(NOW, 2))).toEqual([expect.objectContaining({ kind: 'resolved', rule_id: rule.id })]);
  });

  it('sustained checks still gate the first trigger', async () => {
    const { rule } = await rocRule({ sustainedMinutes: 3 });

    expect(await run(NOW)).toEqual([]);
    expect(await run(plus(NOW, 1))).toEqual([]);
    expect(await run(plus(NOW, 2))).toEqual([expect.objectContaining({ kind: 'triggered', rule_id: rule.id })]);
    expect((await getRuleRow(rule.id)).last_triggered_at).toEqual(plus(NOW, 2));
  });

  it('a lost baseline counts as recovered', async () => {
    const { rule } = await rocRule();

    expect(await run(NOW)).toHaveLength(1);
    calculate.mockResolvedValue(null);
    expect(await run(plus(NOW, 2))).toEqual([
      expect.objectContaining({ kind: 'resolved', rule_id: rule.id, log_count: 0 }),
    ]);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('a baseline below min_baseline_value counts as recovered', async () => {
    const { rule } = await rocRule({ minBaselineValue: 50 });
    await setRuleLifecycle(rule.id, { state: 'firing', last_triggered_at: plus(NOW, -10), last_notified_at: plus(NOW, -10) });

    expect(await run(NOW)).toEqual([expect.objectContaining({ kind: 'resolved', rule_id: rule.id })]);
  });

  it('two concurrent evaluations produce one notification', async () => {
    const { rule } = await rocRule();

    const [a, b] = await Promise.all([run(NOW), run(NOW)]);
    expect([...a, ...b]).toHaveLength(1);
    expect(await historyCount(rule.id)).toBe(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('an ok rule without anomaly stays quiet and records the evaluation', async () => {
    const { rule } = await rocRule();
    rate.mockResolvedValue(12);

    expect(await run(NOW)).toEqual([]);
    expect(await getRuleRow(rule.id)).toMatchObject({ state: 'ok', last_evaluated_at: NOW });
    expect(openSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
