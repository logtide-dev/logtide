import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'crypto';

const queueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({ add: queueAdd })),
}));

import { processSigmaDetection } from '../../../queue/jobs/sigma-detection.js';
import { sigmaExceptionsService } from '../../../modules/sigma/exceptions-service.js';
import { db } from '../../../database/index.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';

const DETECTION = { selection: { 'message|contains': 'boom' }, condition: 'selection' };
const COND_API = [{ field: 'service', operator: 'equals', values: ['api'] }];

function logEntry(service: string, message = 'boom happened') {
  return { id: crypto.randomUUID(), message, level: 'error', service, time: new Date() };
}

async function setup() {
  const ctx = await createTestContext();
  const rule = await createTestSigmaRule({
    organizationId: ctx.organization.id,
    projectId: ctx.project.id,
    title: `Boom ${crypto.randomUUID()}`,
    logsource: {},
    detection: DETECTION,
    emailRecipients: ['ops@example.com'],
  });
  return { ...ctx, orgId: ctx.organization.id, rule };
}

async function addException(
  orgId: string,
  ruleId: string,
  opts: { conditions?: unknown; expiresAt?: Date | null } = {}
) {
  return db
    .insertInto('sigma_rule_exceptions')
    .values({
      organization_id: orgId,
      sigma_rule_id: ruleId,
      conditions: JSON.stringify(opts.conditions ?? COND_API),
      expires_at: opts.expiresAt ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function run(s: { orgId: string; project: { id: string } }, logs: any[]) {
  await processSigmaDetection({
    data: { logs, organizationId: s.orgId, projectId: s.project.id },
  });
}

const events = (orgId: string) =>
  db.selectFrom('detection_events').selectAll().where('organization_id', '=', orgId).execute();

const ruleRow = (id: string) =>
  db.selectFrom('sigma_rules').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

describe('sigma detection job with exceptions', () => {
  beforeEach(() => {
    queueAdd.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suppressed match creates no detection_events row and queues no notification', async () => {
    const s = await setup();
    await addException(s.orgId, s.rule.id);

    await run(s, [logEntry('api')]);

    expect(await events(s.orgId)).toHaveLength(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect((await ruleRow(s.rule.id)).last_fired_at).toBeNull();
  });

  it('unmatched exception leaves the detection event', async () => {
    const s = await setup();
    await addException(s.orgId, s.rule.id);

    await run(s, [logEntry('web')]);

    expect(await events(s.orgId)).toHaveLength(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('expired exception does not suppress', async () => {
    const s = await setup();
    const ex = await addException(s.orgId, s.rule.id, { expiresAt: new Date(Date.now() - 3600_000) });

    await run(s, [logEntry('api')]);

    expect(await events(s.orgId)).toHaveLength(1);
    const after = await db
      .selectFrom('sigma_rule_exceptions')
      .select(['hit_count'])
      .where('id', '=', ex.id)
      .executeTakeFirstOrThrow();
    expect(Number(after.hit_count)).toBe(0);
  });

  it('exception on another rule does not suppress', async () => {
    const s = await setup();
    const other = await createTestSigmaRule({ organizationId: s.orgId, logsource: {} });
    await addException(s.orgId, other.id);

    await run(s, [logEntry('api')]);

    expect(await events(s.orgId)).toHaveLength(1);
  });

  it('exception of another organization with the same field does not suppress', async () => {
    const s = await setup();
    const otherOrg = await createTestContext();
    // Row claims another organization while pointing at this org's rule.
    await addException(otherOrg.organization.id, s.rule.id);

    await run(s, [logEntry('api')]);

    expect(await events(s.orgId)).toHaveLength(1);
  });

  it('partial suppression: one of two matching logs suppressed creates one event', async () => {
    const s = await setup();
    await addException(s.orgId, s.rule.id);

    await run(s, [logEntry('api'), logEntry('web')]);

    const rows = await events(s.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].service).toBe('web');
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0][1]).toMatchObject({ rule_id: s.rule.id, log_count: 1 });
  });

  it('last_fired_at set only for rules with kept matches', async () => {
    const s = await setup();
    const quiet = await createTestSigmaRule({
      organizationId: s.orgId,
      projectId: s.project.id,
      logsource: {},
      detection: { selection: { 'message|contains': 'whisper' }, condition: 'selection' },
    });
    await addException(s.orgId, quiet.id, { conditions: [{ field: 'service', operator: 'equals', values: ['api'] }] });

    await run(s, [logEntry('api', 'boom and whisper')]);

    expect((await ruleRow(s.rule.id)).last_fired_at).not.toBeNull();
    expect((await ruleRow(quiet.id)).last_fired_at).toBeNull();
    const rows = await events(s.orgId);
    expect(rows.map((r) => r.sigma_rule_id)).toEqual([s.rule.id]);
  });

  it('hit_count and last_hit_at incremented on the exception', async () => {
    const s = await setup();
    const ex = await addException(s.orgId, s.rule.id);

    await run(s, [logEntry('api'), logEntry('api'), logEntry('web')]);

    const after = await db
      .selectFrom('sigma_rule_exceptions')
      .selectAll()
      .where('id', '=', ex.id)
      .executeTakeFirstOrThrow();
    expect(Number(after.hit_count)).toBe(2);
    expect(after.last_hit_at).not.toBeNull();
    expect(await events(s.orgId)).toHaveLength(1);
  });

  it('exception loading failure still creates events', async () => {
    const s = await setup();
    await addException(s.orgId, s.rule.id);
    vi.spyOn(sigmaExceptionsService, 'loadActiveForRules').mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await run(s, [logEntry('api')]);

    expect(await events(s.orgId)).toHaveLength(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('unsuppressed match sets last_fired_at and keeps the notification payload', async () => {
    const s = await setup();

    await run(s, [logEntry('api')]);

    expect((await ruleRow(s.rule.id)).last_fired_at).not.toBeNull();
    expect(queueAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({
        historyId: null,
        rule_id: s.rule.id,
        organization_id: s.orgId,
        project_id: s.project.id,
        log_count: 1,
        threshold: 1,
        time_window: 1,
        email_recipients: ['ops@example.com'],
        webhook_url: null,
      })
    );
  });
});
