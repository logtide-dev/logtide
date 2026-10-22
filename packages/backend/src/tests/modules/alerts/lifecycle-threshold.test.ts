import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import type { AlertEvaluationResult } from '../../../modules/alerts/types.js';
import {
  createTestAlertRule,
  createTestContext,
  createTestLog,
  createTestOrganization,
  createTestProject,
} from '../../helpers/factories.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';

let NOW: Date;
const plus = (t: Date, minutes: number) => new Date(t.getTime() + minutes * 60_000);
const minus = (t: Date, minutes: number) => new Date(t.getTime() - minutes * 60_000);
const run = (t: Date): Promise<AlertEvaluationResult[]> => alertsService.checkAlertRules({ now: t });

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

async function errorLogs(projectId: string, count: number, time: Date, message = 'Request failed', metadata?: unknown) {
  for (let i = 0; i < count; i++) {
    await createTestLog({ projectId, level: 'error', message, time, metadata });
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
  const d = new Date();
  d.setMilliseconds(0);
  NOW = d;
  openSpy = vi
    .spyOn(incidentsService, 'openOrUpdateFromSource')
    .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });
  resolveSpy = vi.spyOn(incidentsService, 'resolveFromSource').mockResolvedValue({ id: INCIDENT_ID } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('threshold lifecycle: transitions', () => {
  it('notifies once on transition and stays quiet while firing', async () => {
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([
      expect.objectContaining({
        kind: 'triggered',
        rule_id: rule.id,
        log_count: 3,
        incident_id: INCIDENT_ID,
        firing_since: NOW.toISOString(),
        historyId: expect.any(String),
      }),
    ]);
    expect(await run(plus(NOW, 1))).toEqual([]);
    expect(await historyCount(rule.id)).toBe(1);

    const row = await getRuleRow(rule.id);
    expect(row).toMatchObject({ state: 'firing', last_triggered_at: NOW, last_notified_at: NOW });
    expect(row.last_evaluated_at).toEqual(plus(NOW, 1));
    // T2 opens the incident; steady firing (T5) does not call F4.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'alert', sourceId: rule.id, occurredAt: NOW })
    );
  });

  it('renotifies after renotify_minutes while still firing', async () => {
    const { rule, project } = await thresholdRule({ timeWindow: 120 });
    await setRuleLifecycle(rule.id, { renotify_minutes: 30 });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toHaveLength(1);
    expect(await run(plus(NOW, 10))).toEqual([]);
    const renotify = await run(plus(NOW, 31));
    expect(renotify).toEqual([
      expect.objectContaining({ kind: 'renotify', rule_id: rule.id, firing_since: NOW.toISOString() }),
    ]);
    expect(await historyCount(rule.id)).toBe(2);
    expect(await getRuleRow(rule.id)).toMatchObject({
      state: 'firing',
      last_triggered_at: NOW,
      last_notified_at: plus(NOW, 31),
    });
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it('resolves when the window no longer breaches', async () => {
    const { rule, project, organization } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toHaveLength(1);
    const resolved = await run(plus(NOW, 6));
    expect(resolved).toEqual([
      {
        kind: 'resolved',
        rule_id: rule.id,
        rule_name: 'Error burst',
        organization_id: organization.id,
        project_id: project.id,
        alert_type: 'threshold',
        log_count: 0,
        threshold: 2,
        time_window: 5,
        firing_since: NOW.toISOString(),
        resolved_at: plus(NOW, 6).toISOString(),
        incident_id: INCIDENT_ID,
      },
    ]);

    const row = await getRuleRow(rule.id);
    expect(row.state).toBe('ok');
    expect(row.last_triggered_at).toEqual(NOW);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith({
      organizationId: organization.id,
      source: 'alert',
      sourceId: rule.id,
      resolvedAt: plus(NOW, 6),
      reason: 'recovered',
    });
    // A resolution writes no history row.
    expect(await historyCount(rule.id)).toBe(1);
  });

  it('fires again after recovering', async () => {
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toHaveLength(1);
    expect(await run(plus(NOW, 6))).toEqual([expect.objectContaining({ kind: 'resolved' })]);
    await errorLogs(project.id, 3, plus(NOW, 7));
    expect(await run(plus(NOW, 8))).toEqual([
      expect.objectContaining({ kind: 'triggered', firing_since: plus(NOW, 8).toISOString() }),
    ]);
    expect(await historyCount(rule.id)).toBe(2);
  });

  it('counts every matching log in the sliding window, not only logs after the last trigger', async () => {
    const { rule, project } = await thresholdRule({ threshold: 3, timeWindow: 10 });
    await setRuleLifecycle(rule.id, { renotify_minutes: 5 });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([expect.objectContaining({ log_count: 3 })]);
    await errorLogs(project.id, 1, plus(NOW, 2));
    expect(await run(plus(NOW, 6))).toEqual([expect.objectContaining({ kind: 'renotify', log_count: 4 })]);
  });

  it('two concurrent evaluations produce one notification', async () => {
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    const [a, b] = await Promise.all([run(NOW), run(NOW)]);
    expect([...a, ...b]).toHaveLength(1);
    expect(await historyCount(rule.id)).toBe(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('two concurrent evaluations produce one renotify', async () => {
    const { rule, project } = await thresholdRule({ timeWindow: 120 });
    await setRuleLifecycle(rule.id, {
      state: 'firing',
      last_triggered_at: minus(NOW, 40),
      last_notified_at: minus(NOW, 40),
      renotify_minutes: 30,
    });
    await errorLogs(project.id, 3, minus(NOW, 1));

    const [a, b] = await Promise.all([run(NOW), run(NOW)]);
    expect([...a, ...b]).toEqual([expect.objectContaining({ kind: 'renotify' })]);
    expect(await historyCount(rule.id)).toBe(1);
  });

  it('a backfilled firing rule does not notify again on the first evaluation', async () => {
    const { rule, project } = await thresholdRule();
    await setRuleLifecycle(rule.id, {
      state: 'firing',
      last_triggered_at: minus(NOW, 2),
      last_notified_at: minus(NOW, 2),
    });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([]);
    expect(await historyCount(rule.id)).toBe(0);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('an organization-wide rule of an organization without projects resolves', async () => {
    const org = await createTestOrganization();
    const rule = await createTestAlertRule({ organizationId: org.id, projectId: null, threshold: 1 });
    await setRuleLifecycle(rule.id, {
      state: 'firing',
      last_triggered_at: minus(NOW, 10),
      last_notified_at: minus(NOW, 10),
    });

    expect(await run(NOW)).toEqual([
      expect.objectContaining({ kind: 'resolved', rule_id: rule.id, log_count: 0, project_id: null }),
    ]);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('does not evaluate disabled rules', async () => {
    const { rule, project } = await thresholdRule({ enabled: false });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([]);
    expect(await getRuleRow(rule.id)).toMatchObject({ state: 'ok', last_evaluated_at: null });
  });
});

describe('threshold lifecycle: query', () => {
  it('counts with the rule query', async () => {
    const { organization, project } = await thresholdRule({ threshold: 99 });
    const ruleA = await createTestAlertRule({
      organizationId: organization.id,
      projectId: project.id,
      name: 'Timeouts',
      threshold: 3,
      timeWindow: 5,
    });
    const ruleB = await createTestAlertRule({
      organizationId: organization.id,
      projectId: project.id,
      name: 'Everything but timeouts',
      threshold: 4,
      timeWindow: 5,
    });
    await setRuleLifecycle(ruleA.id, { query: 'timeout' });
    await setRuleLifecycle(ruleB.id, { query: '-timeout' });
    await errorLogs(project.id, 3, NOW, 'upstream timeout');
    await errorLogs(project.id, 3, NOW, 'payment declined');

    const results = await run(NOW);
    expect(results).toEqual([expect.objectContaining({ kind: 'triggered', rule_id: ruleA.id, log_count: 3 })]);
    expect((await getRuleRow(ruleB.id)).state).toBe('ok');
  });

  it('a metadata clause in the query scopes the count', async () => {
    const { organization, project } = await thresholdRule({ threshold: 99 });
    const prod = await createTestAlertRule({ organizationId: organization.id, projectId: project.id, threshold: 2 });
    const dev = await createTestAlertRule({ organizationId: organization.id, projectId: project.id, threshold: 4 });
    await setRuleLifecycle(prod.id, { query: 'env:prod' });
    await setRuleLifecycle(dev.id, { query: 'env:dev' });
    await errorLogs(project.id, 2, NOW, 'boom', { env: 'prod' });
    await errorLogs(project.id, 3, NOW, 'boom', { env: 'dev' });

    expect(await run(NOW)).toEqual([expect.objectContaining({ rule_id: prod.id, log_count: 2 })]);
  });

  it('a query that contradicts the rule levels never breaches', async () => {
    const { rule, project } = await thresholdRule({ threshold: 1 });
    await setRuleLifecycle(rule.id, { query: 'level:info' });
    await errorLogs(project.id, 3, NOW);
    await createTestLog({ projectId: project.id, level: 'info', message: 'hello', time: NOW });

    expect(await run(NOW)).toEqual([]);
    expect(await getRuleRow(rule.id)).toMatchObject({ state: 'ok', last_evaluated_at: NOW });
  });
});

describe('threshold lifecycle: snooze', () => {
  it('snoozed rule tracks state without notifying', async () => {
    const { rule, project } = await thresholdRule();
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([]);
    const row = await getRuleRow(rule.id);
    expect(row).toMatchObject({ state: 'firing', last_triggered_at: NOW, last_notified_at: null });
    expect(await historyCount(rule.id)).toBe(0);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('notifies once when the snooze ends while still firing', async () => {
    const { rule, project } = await thresholdRule({ timeWindow: 120 });
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([]);
    expect(await run(plus(NOW, 30))).toEqual([]);
    expect(await run(plus(NOW, 61))).toEqual([
      expect.objectContaining({ kind: 'triggered', firing_since: NOW.toISOString() }),
    ]);
    expect(await run(plus(NOW, 62))).toEqual([]);
    expect(await historyCount(rule.id)).toBe(1);
    expect(await getRuleRow(rule.id)).toMatchObject({ last_triggered_at: NOW, last_notified_at: plus(NOW, 61) });
  });

  it('a recovery during the snooze still sends alert.resolved and resolves the incident', async () => {
    const { rule, project } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([expect.objectContaining({ kind: 'triggered' })]);
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });

    // T10: notified episode, snoozed, recovered
    expect(await run(plus(NOW, 6))).toEqual([
      expect.objectContaining({ kind: 'resolved', rule_id: rule.id, firing_since: NOW.toISOString() }),
    ]);
    expect(resolveSpy).toHaveBeenCalledWith(expect.objectContaining({ sourceId: rule.id, reason: 'recovered' }));
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('a recovery of an episode that was never notified sends nothing but resolves the incident', async () => {
    const { rule, project } = await thresholdRule();
    await setRuleLifecycle(rule.id, { snoozed_until: plus(NOW, 60) });
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([]);
    // T10b
    expect(await run(plus(NOW, 6))).toEqual([]);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith(expect.objectContaining({ sourceId: rule.id, reason: 'recovered' }));
    expect((await getRuleRow(rule.id)).state).toBe('ok');
  });

  it('an expired snooze stored with microseconds does not block notifications', async () => {
    const { rule, project, organization } = await thresholdRule();
    await sql`UPDATE alert_rules SET snoozed_until = '2026-01-01T00:00:00.123456Z' WHERE id = ${rule.id} AND organization_id = ${organization.id}`.execute(db);
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([expect.objectContaining({ kind: 'triggered' })]);
  });

  it('a last notification stored with microseconds does not block a renotify', async () => {
    const { rule, project, organization } = await thresholdRule({ timeWindow: 120 });
    await setRuleLifecycle(rule.id, { renotify_minutes: 30 });
    const notifiedAt = minus(NOW, 45).toISOString().replace('Z', '456Z');
    await sql`UPDATE alert_rules SET state = 'firing', last_triggered_at = ${notifiedAt}::timestamptz, last_notified_at = ${notifiedAt}::timestamptz WHERE id = ${rule.id} AND organization_id = ${organization.id}`.execute(db);
    await errorLogs(project.id, 3, minus(NOW, 1));

    expect(await run(NOW)).toEqual([expect.objectContaining({ kind: 'renotify' })]);
    expect(await run(plus(NOW, 1))).toEqual([]);
  });
});

describe('threshold lifecycle: failures', () => {
  it('a rule that fails to evaluate is skipped without blocking others', async () => {
    const { organization, project, user } = await createTestContext();
    const otherProject = await createTestProject({ organizationId: organization.id, userId: user.id });
    const ruleA = await createTestAlertRule({ organizationId: organization.id, projectId: project.id, threshold: 2 });
    const ruleB = await createTestAlertRule({ organizationId: organization.id, projectId: otherProject.id, threshold: 2 });
    await errorLogs(project.id, 3, NOW);
    await errorLogs(otherProject.id, 3, NOW);

    const original = reservoir.count.bind(reservoir);
    vi.spyOn(reservoir, 'count').mockImplementation(async (params) => {
      if (params.projectId === project.id) throw new Error('engine unavailable');
      return original(params);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await run(NOW)).toEqual([expect.objectContaining({ rule_id: ruleB.id, kind: 'triggered' })]);
    expect(await getRuleRow(ruleA.id)).toMatchObject({ state: 'ok', last_evaluated_at: null });
    expect((await getRuleRow(ruleB.id)).last_evaluated_at).toEqual(NOW);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[Alerts] Rule ${ruleA.id} skipped, evaluation failed:`),
      expect.any(Error)
    );
  });

  it('a stored query that no longer parses is skipped', async () => {
    const { organization, project } = await createTestContext();
    const ruleA = await createTestAlertRule({ organizationId: organization.id, projectId: project.id, threshold: 2 });
    const ruleB = await createTestAlertRule({ organizationId: organization.id, projectId: project.id, threshold: 2 });
    await setRuleLifecycle(ruleA.id, { query: '(' });
    await errorLogs(project.id, 3, NOW);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await run(NOW)).toEqual([expect.objectContaining({ rule_id: ruleB.id })]);
    expect(await getRuleRow(ruleA.id)).toMatchObject({ state: 'ok', last_evaluated_at: null, last_triggered_at: null });
  });

  it('an incident failure does not block the notification', async () => {
    const { rule, project } = await thresholdRule();
    openSpy.mockRejectedValue(new Error('incidents unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await errorLogs(project.id, 3, NOW);

    expect(await run(NOW)).toEqual([
      expect.objectContaining({ kind: 'triggered', rule_id: rule.id, incident_id: null }),
    ]);
    expect((await getRuleRow(rule.id)).state).toBe('firing');
  });

  it('a rule disabled after the read loses the compare-and-set and sends nothing', async () => {
    const { rule, project, organization } = await thresholdRule();
    await errorLogs(project.id, 3, NOW);

    const original = reservoir.count.bind(reservoir);
    vi.spyOn(reservoir, 'count').mockImplementation(async (params) => {
      // Disable the rule between the read and the compare-and-set.
      await db.updateTable('alert_rules').set({ enabled: false }).where('id', '=', rule.id).where('organization_id', '=', organization.id).execute();
      return original(params);
    });

    expect(await run(NOW)).toEqual([]);
    expect(await historyCount(rule.id)).toBe(0);
    expect((await getRuleRow(rule.id)).state).toBe('ok');
    expect(openSpy).not.toHaveBeenCalled();
  });
});
