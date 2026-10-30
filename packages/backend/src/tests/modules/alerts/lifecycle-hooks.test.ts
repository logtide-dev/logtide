import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { baselineCalculator } from '../../../modules/alerts/baseline-calculator.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import { hooks, HookRejectionError } from '../../../hooks/index.js';
import type { AfterAlertTriggeredContext } from '../../../hooks/index.js';
import type { AlertEvaluationResult } from '../../../modules/alerts/types.js';
import { createTestAlertRule, createTestContext, createTestLog } from '../../helpers/factories.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';

let NOW: Date;
const plus = (t: Date, minutes: number) => new Date(t.getTime() + minutes * 60_000);
const minus = (t: Date, minutes: number) => new Date(t.getTime() - minutes * 60_000);
const run = (t: Date): Promise<AlertEvaluationResult[]> => alertsService.checkAlertRules({ now: t });
/** after-hooks are fire-and-forget: let pending handlers run. */
const settle = () => new Promise((r) => setTimeout(r, 20));

let captured: AfterAlertTriggeredContext[];
let openSpy: ReturnType<typeof vi.spyOn>;
let resolveSpy: ReturnType<typeof vi.spyOn>;

async function historyIds(ruleId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('alert_history')
    .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
    .select('alert_history.id')
    .where('alert_history.rule_id', '=', ruleId)
    .execute();
  return rows.map((r) => r.id);
}

async function errorLogs(projectId: string, count: number, time: Date) {
  for (let i = 0; i < count; i++) {
    await createTestLog({ projectId, level: 'error', message: 'Request failed', time });
  }
}

async function thresholdRule(o: Parameters<typeof createTestAlertRule>[0] = {}) {
  const ctx = await createTestContext();
  const rule = await createTestAlertRule({
    organizationId: ctx.organization.id,
    projectId: ctx.project.id,
    name: 'Error burst',
    threshold: 2,
    timeWindow: 5,
    level: ['error'],
    ...o,
  });
  return { ...ctx, rule };
}

beforeEach(() => {
  hooks.clear();
  const d = new Date();
  d.setMilliseconds(0);
  NOW = d;
  captured = [];
  hooks.register('afterAlertTriggered', async (ctx) => {
    captured.push({ ...ctx });
  });
  openSpy = vi
    .spyOn(incidentsService, 'openOrUpdateFromSource')
    .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });
  resolveSpy = vi.spyOn(incidentsService, 'resolveFromSource').mockResolvedValue({ id: INCIDENT_ID } as never);
});

afterEach(() => {
  hooks.clear();
  vi.restoreAllMocks();
});

describe('afterAlertTriggered: threshold rules', () => {
  it('afterAlertTriggered fires once per notification across transition, steady firing and renotify', async () => {
    const { rule, project, organization } = await thresholdRule({ timeWindow: 120 });
    await setRuleLifecycle(rule.id, { renotify_minutes: 30 });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toHaveLength(1); // T2
    expect(await run(plus(NOW, 10))).toEqual([]); // T5
    expect(await run(plus(NOW, 31))).toEqual([expect.objectContaining({ kind: 'renotify' })]); // T4
    await settle();

    expect(captured).toHaveLength(2);
    const ids = await historyIds(rule.id);
    expect(ids).toHaveLength(2);
    expect(new Set(captured.map((c) => c.historyId))).toEqual(new Set(ids));
    for (const c of captured) {
      expect(c).toMatchObject({
        organizationId: organization.id,
        projectId: project.id,
        ruleId: rule.id,
        ruleName: 'Error burst',
        logCount: 3,
        baselineMetadata: null,
      });
    }
  });

  it('the hook context carries the history id of the returned notification', async () => {
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    const [result] = await run(NOW);
    await settle();

    expect(result.kind).toBe('triggered');
    expect(captured).toHaveLength(1);
    expect(captured[0].historyId).toBe(result.kind === 'resolved' ? null : result.historyId);
    expect(captured[0].ruleId).toBe(rule.id);
  });

  it('afterAlertTriggered does not fire for snoozed transitions or resolutions', async () => {
    // T3: breaching while snoozed -> firing without notification
    const { rule, project } = await thresholdRule();
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });
    await errorLogs(project.id, 3, NOW);
    expect(await run(NOW)).toEqual([]);
    expect((await getRuleRow(rule.id)).state).toBe('firing');

    // T10: an episode notified before the snooze recovers while snoozed ->
    // resolved notification, never a hook call
    await setRuleLifecycle(rule.id, { last_triggered_at: minus(NOW, 2), last_notified_at: minus(NOW, 2) });
    expect(await run(plus(NOW, 6))).toEqual([expect.objectContaining({ kind: 'resolved', rule_id: rule.id })]);
    await settle();

    expect(captured).toHaveLength(0);
    expect(await historyIds(rule.id)).toHaveLength(0);
  });

  it('a resolution outside a snooze fires no hook either', async () => {
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toHaveLength(1); // T2
    expect(await run(plus(NOW, 6))).toEqual([expect.objectContaining({ kind: 'resolved' })]); // T8
    await settle();

    expect(captured).toHaveLength(1);
    expect(captured[0].ruleId).toBe(rule.id);
  });

  it('the first notification after a snooze fires the hook once', async () => {
    const { rule, project } = await thresholdRule({ timeWindow: 120 });
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([]); // T3
    expect(await run(plus(NOW, 61))).toEqual([expect.objectContaining({ kind: 'triggered' })]); // T6
    expect(await run(plus(NOW, 62))).toEqual([]); // T5
    await settle();

    expect(captured).toHaveLength(1);
    expect(captured[0].historyId).toBe((await historyIds(rule.id))[0]);
  });

  it('a losing concurrent evaluator fires no hook', async () => {
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    const [a, b] = await Promise.all([run(NOW), run(NOW)]);
    await settle();

    expect([...a, ...b]).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].historyId).toBe((await historyIds(rule.id))[0]);
  });

  it('a hook that never settles does not block the evaluation', async () => {
    hooks.clear();
    hooks.register('afterAlertTriggered', () => new Promise<void>(() => {}));
    const { project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([expect.objectContaining({ kind: 'triggered' })]);
  });

  it('a failing hook does not drop the notification', async () => {
    hooks.clear();
    hooks.register('afterAlertTriggered', async () => {
      throw new Error('handler exploded');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([expect.objectContaining({ kind: 'triggered', rule_id: rule.id })]);
    await settle();
    expect(warn).toHaveBeenCalled();
    expect((await getRuleRow(rule.id)).state).toBe('firing');
  });

  it('without handlers the after phase is not run', async () => {
    hooks.clear();
    const runAfter = vi.spyOn(hooks, 'runAfter');
    const { project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toHaveLength(1);
    expect(runAfter).not.toHaveBeenCalled();
  });
});

describe('afterAlertTriggered: rate-of-change rules', () => {
  async function rocRule() {
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
    });
    return { ...ctx, rule };
  }

  beforeEach(() => {
    vi.spyOn(baselineCalculator, 'calculate').mockResolvedValue({ value: 10, samplesUsed: 5 });
    vi.spyOn(baselineCalculator, 'getCurrentHourlyRate').mockResolvedValue(100);
  });

  it('afterAlertTriggered fires once per rate-of-change notification', async () => {
    const { rule } = await rocRule();

    expect(await run(NOW)).toHaveLength(1); // R2
    expect(await run(plus(NOW, 5))).toEqual([]); // R4, in cooldown and still anomalous
    await settle();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ ruleId: rule.id, logCount: 100 });
    expect(captured[0].baselineMetadata).not.toBeNull();
    expect(captured[0].baselineMetadata).toMatchObject({ deviation_ratio: 10, baseline_value: 10, current_value: 100 });
  });

  it('a renotify after the cooldown fires the hook again', async () => {
    const { rule } = await rocRule();

    expect(await run(NOW)).toHaveLength(1); // R2
    expect(await run(plus(NOW, 61))).toEqual([expect.objectContaining({ kind: 'renotify' })]); // R5
    await settle();

    expect(captured).toHaveLength(2);
    expect(new Set(captured.map((c) => c.historyId))).toEqual(new Set(await historyIds(rule.id)));
  });

  it('a snoozed anomaly fires no hook', async () => {
    const { rule } = await rocRule();
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });

    expect(await run(NOW)).toEqual([]); // R3
    await settle();

    expect(captured).toHaveLength(0);
    expect((await getRuleRow(rule.id)).state).toBe('firing');
  });
});

describe('beforeAlertEvaluation', () => {
  it('a beforeAlertEvaluation rejection leaves state and last_evaluated_at untouched', async () => {
    const { rule, project } = await thresholdRule();
    const other = await thresholdRule({ name: 'Other rule' });
    hooks.register('beforeAlertEvaluation', async (ctx) => {
      if (ctx.ruleId === rule.id) throw new HookRejectionError('policy.rule_suspended', 'rule suspended by policy');
    });
    await errorLogs(project.id, 3, NOW);
    await errorLogs(other.project.id, 3, NOW);

    const results = await run(NOW);
    await settle();

    expect(results).toEqual([expect.objectContaining({ kind: 'triggered', rule_id: other.rule.id })]);
    const row = await getRuleRow(rule.id);
    expect(row.state).toBe('ok');
    expect(row.last_evaluated_at).toBeNull();
    expect(row.last_triggered_at).toBeNull();
    expect(await historyIds(rule.id)).toHaveLength(0);
    expect(captured.map((c) => c.ruleId)).toEqual([other.rule.id]);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect((await getRuleRow(other.rule.id)).last_evaluated_at).toEqual(NOW);
  });

  it('a rejected firing rule is not resolved while the hook rejects it', async () => {
    const { rule } = await thresholdRule();
    await setRuleLifecycle(rule.id, { state: 'firing', last_triggered_at: minus(NOW, 2), last_notified_at: minus(NOW, 2) });
    hooks.register('beforeAlertEvaluation', async () => {
      throw new HookRejectionError('policy.rule_suspended', 'rule suspended by policy');
    });

    // no breaching logs: without the hook this would be T8
    expect(await run(NOW)).toEqual([]);

    const row = await getRuleRow(rule.id);
    expect(row.state).toBe('firing');
    expect(row.last_evaluated_at).toBeNull();
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('a broken beforeAlertEvaluation hook skips the rule the same way', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rule, project } = await thresholdRule();
    hooks.register('beforeAlertEvaluation', async () => {
      throw new Error('hook crashed');
    });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([]);
    const row = await getRuleRow(rule.id);
    expect(row.state).toBe('ok');
    expect(row.last_evaluated_at).toBeNull();
    expect(log).toHaveBeenCalled();
  });
});
