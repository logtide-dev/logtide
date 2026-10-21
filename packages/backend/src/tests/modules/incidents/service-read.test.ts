import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import {
  createTestContext,
  createTestAlertRule,
  createTestProject,
  createTestSigmaRule,
  createTestUser,
} from '../../helpers/factories.js';
import { addOrgMember, createTestMonitor, insertIncident } from './fixtures.js';

let emailSeq = 0;
async function newUser(name: string) {
  emailSeq += 1;
  return createTestUser({ email: `read-${emailSeq}-${Date.now()}@example.com`, name });
}

async function setIncident(id: string, organizationId: string, values: Record<string, unknown>) {
  await db
    .updateTable('incidents')
    .set(values)
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .execute();
}

async function insertDetection(input: {
  organizationId: string;
  projectId: string | null;
  sigmaRuleId: string;
  incidentId: string | null;
}) {
  await db
    .insertInto('detection_events')
    .values({
      time: new Date(),
      organization_id: input.organizationId,
      project_id: input.projectId,
      sigma_rule_id: input.sigmaRuleId,
      log_id: crypto.randomUUID(),
      severity: 'high',
      rule_title: 'Rule',
      rule_description: null,
      mitre_tactics: null,
      mitre_techniques: null,
      service: 'api',
      log_level: 'error',
      log_message: 'boom',
      trace_id: null,
      matched_fields: null,
      incident_id: input.incidentId,
    })
    .execute();
}

async function insertHistory(input: {
  incidentId: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt?: Date;
}) {
  await db
    .insertInto('incident_history')
    .values({
      incident_id: input.incidentId,
      user_id: null,
      action: input.action,
      field_name: null,
      old_value: null,
      new_value: null,
      metadata: input.metadata,
      ...(input.createdAt && { created_at: input.createdAt }),
    })
    .execute();
}

/** One incident per source, the manual one assigned to a member. */
async function seedEverySource() {
  const ctx = await createTestContext();
  const organizationId = ctx.organization.id;
  const member = await newUser('Member One');
  await addOrgMember(organizationId, member.id);
  const rule = await createTestAlertRule({ organizationId, projectId: ctx.project.id, name: 'High errors' });
  const monitor = await createTestMonitor({ organizationId, projectId: ctx.project.id, name: 'API health' });

  const sigma = await insertIncident({ organizationId, projectId: ctx.project.id, source: 'sigma', title: 'sigma', severity: 'critical' });
  const alert = await insertIncident({ organizationId, projectId: ctx.project.id, source: 'alert', title: 'alert', alertRuleId: rule.id, severity: 'high', status: 'investigating' });
  const mon = await insertIncident({ organizationId, projectId: ctx.project.id, source: 'monitor', title: 'monitor', monitorId: monitor.id, severity: 'medium' });
  const assigned = await insertIncident({ organizationId, source: 'manual', title: 'assigned', assigneeId: member.id, severity: 'low' });

  return { ...ctx, organizationId, member, rule, monitor, incidents: { sigma, alert, monitor: mon, assigned } };
}

describe('IncidentsService read side', () => {
  it('lists incidents of every source with joined refs', async () => {
    const s = await seedEverySource();
    const { incidents, total } = await incidentsService.list({ organizationId: s.organizationId });
    const byTitle = (t: string) => incidents.find((i) => i.title === t)!;

    expect(total).toBe(4);
    expect(incidents).toHaveLength(4);
    expect(byTitle('alert').sourceRef).toEqual({ kind: 'alert', id: s.rule.id, name: 'High errors' });
    expect(byTitle('alert').alertRuleId).toBe(s.rule.id);
    expect(byTitle('monitor').sourceRef).toEqual({ kind: 'monitor', id: s.monitor.id, name: 'API health' });
    expect(byTitle('monitor').monitorId).toBe(s.monitor.id);
    expect(byTitle('assigned').assignee).toEqual({ id: s.member.id, name: s.member.name, email: s.member.email });
    expect(byTitle('assigned').project).toBeNull();
    expect(byTitle('sigma').project).toEqual({ id: s.project.id, name: s.project.name });
    expect(byTitle('sigma').sourceRef).toBeNull();
    expect(byTitle('sigma').lastEventAt).toBeInstanceOf(Date);
  });

  it('never joins an assignee who is not a member of the organization', async () => {
    const ctx = await createTestContext();
    const outsider = await newUser('Outsider');
    const inc = await insertIncident({ organizationId: ctx.organization.id, assigneeId: outsider.id });
    const item = await incidentsService.getItem(inc.id, ctx.organization.id);
    expect(item!.assigneeId).toBe(outsider.id);
    expect(item!.assignee).toBeNull();
  });

  it('filters by source, status and severity arrays', async () => {
    const s = await seedEverySource();
    const org = s.organizationId;

    const bySource = await incidentsService.list({ organizationId: org, source: ['alert', 'monitor'] });
    expect(bySource.total).toBe(2);
    expect(bySource.incidents.map((i) => i.title).sort()).toEqual(['alert', 'monitor']);

    const open = await incidentsService.list({ organizationId: org, status: ['open'] });
    expect(open.total).toBe(3);
    expect(open.incidents.some((i) => i.status === 'investigating')).toBe(false);

    const sev = await incidentsService.list({ organizationId: org, severity: ['critical', 'low'] });
    expect(sev.incidents.map((i) => i.title).sort()).toEqual(['assigned', 'sigma']);

    const combined = await incidentsService.list({
      organizationId: org,
      source: ['alert', 'sigma'],
      status: ['open', 'investigating'],
      severity: ['high'],
    });
    expect(combined.incidents.map((i) => i.title)).toEqual(['alert']);
  });

  it('filters unassigned with assigneeId null and a user with their id', async () => {
    const s = await seedEverySource();
    const unassigned = await incidentsService.list({ organizationId: s.organizationId, assigneeId: null });
    expect(unassigned.total).toBe(3);
    expect(unassigned.incidents.every((i) => i.assigneeId === null)).toBe(true);

    const mine = await incidentsService.list({ organizationId: s.organizationId, assigneeId: s.member.id });
    expect(mine.incidents.map((i) => i.title)).toEqual(['assigned']);

    const anyone = await incidentsService.list({ organizationId: s.organizationId, assigneeId: undefined });
    expect(anyone.total).toBe(4);
  });

  it('filters by several projects', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    const p2 = await createTestProject({ organizationId: org, userId: ctx.user.id });
    const p3 = await createTestProject({ organizationId: org, userId: ctx.user.id });
    await insertIncident({ organizationId: org, projectId: ctx.project.id, title: 'p1' });
    await insertIncident({ organizationId: org, projectId: p2.id, title: 'p2' });
    await insertIncident({ organizationId: org, projectId: p3.id, title: 'p3' });
    await insertIncident({ organizationId: org, projectId: null, title: 'org-wide' });

    const res = await incidentsService.list({ organizationId: org, projectIds: [ctx.project.id, p2.id] });
    expect(res.total).toBe(2);
    expect(res.incidents.map((i) => i.title).sort()).toEqual(['p1', 'p2']);
  });

  it('filters by ruleId through detection_events', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    const ruleA = await createTestSigmaRule({ organizationId: a.organization.id });
    const otherRule = await createTestSigmaRule({ organizationId: a.organization.id });

    const matching = await insertIncident({ organizationId: a.organization.id, title: 'matching' });
    const other = await insertIncident({ organizationId: a.organization.id, title: 'other rule' });
    const spoofed = await insertIncident({ organizationId: a.organization.id, title: 'spoofed' });
    await insertIncident({ organizationId: a.organization.id, title: 'no detections' });

    await insertDetection({ organizationId: a.organization.id, projectId: a.project.id, sigmaRuleId: ruleA.id, incidentId: matching.id });
    await insertDetection({ organizationId: a.organization.id, projectId: a.project.id, sigmaRuleId: ruleA.id, incidentId: matching.id });
    await insertDetection({ organizationId: a.organization.id, projectId: a.project.id, sigmaRuleId: otherRule.id, incidentId: other.id });
    // a detection row of another organization pointing at an A incident never matches
    await insertDetection({ organizationId: b.organization.id, projectId: b.project.id, sigmaRuleId: ruleA.id, incidentId: spoofed.id });

    const res = await incidentsService.list({ organizationId: a.organization.id, ruleId: ruleA.id });
    expect(res.total).toBe(1);
    expect(res.incidents.map((i) => i.title)).toEqual(['matching']);
  });

  it('listSourceEvents maps created and source_event history rows, newest first', async () => {
    const s = await seedEverySource();
    const other = await createTestContext();
    const t1 = new Date('2026-10-21T10:00:00.000Z');
    const t2 = new Date('2026-10-21T10:05:00.000Z');
    const alertId = s.incidents.alert.id;

    await insertHistory({
      incidentId: alertId,
      action: 'created',
      metadata: { source: 'alert', sourceId: s.rule.id, occurredAt: t1.toISOString(), data: { logCount: 12 } },
      createdAt: t1,
    });
    await insertHistory({
      incidentId: alertId,
      action: 'source_event',
      metadata: { source: 'alert', sourceId: s.rule.id, occurredAt: t2.toISOString(), data: { summary: '12 errors in 5 minutes' } },
      createdAt: t2,
    });
    await insertHistory({ incidentId: alertId, action: 'status_change', metadata: { reason: 'manual' } });
    await insertHistory({ incidentId: alertId, action: 'source_event', metadata: null });

    const events = await incidentsService.listSourceEvents(alertId, s.organizationId);
    expect(events).toHaveLength(2);
    expect(events![0]).toMatchObject({
      kind: 'alert_trigger',
      time: t2.toISOString(),
      summary: '12 errors in 5 minutes',
      detail: { summary: '12 errors in 5 minutes' },
    });
    expect(events![1]).toMatchObject({
      kind: 'alert_trigger',
      time: t1.toISOString(),
      summary: 'Alert triggered',
      detail: { logCount: 12 },
    });
    expect(typeof events![0].id).toBe('string');

    await insertHistory({
      incidentId: s.incidents.monitor.id,
      action: 'created',
      metadata: { source: 'monitor', sourceId: s.monitor.id, occurredAt: t1.toISOString(), data: null },
    });
    const monitorEvents = await incidentsService.listSourceEvents(s.incidents.monitor.id, s.organizationId);
    expect(monitorEvents).toEqual([
      { id: expect.any(String), kind: 'monitor_check', time: t1.toISOString(), summary: 'Monitor check failed' },
    ]);

    expect(await incidentsService.listSourceEvents(s.incidents.sigma.id, s.organizationId)).toEqual([]);
    expect(await incidentsService.listSourceEvents(alertId, other.organization.id)).toBeNull();
  });

  it('keeps the service and technique filters of the SIEM list', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    const a = await insertIncident({ organizationId: org, title: 'api' });
    const b = await insertIncident({ organizationId: org, title: 'worker' });
    await setIncident(a.id, org, { affected_services: ['api', 'web'], mitre_techniques: ['T1110'] });
    await setIncident(b.id, org, { affected_services: ['worker'], mitre_techniques: ['T1059'] });

    expect((await incidentsService.list({ organizationId: org, service: 'web' })).incidents.map((i) => i.title)).toEqual(['api']);
    expect((await incidentsService.list({ organizationId: org, technique: 'T1059' })).incidents.map((i) => i.title)).toEqual(['worker']);
  });

  it('sorts by last_event_at desc by default and by severity rank', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    const base = Date.parse('2026-10-20T00:00:00.000Z');
    const specs = [
      { title: 'low', severity: 'low', minutes: 50 },
      { title: 'critical', severity: 'critical', minutes: 10 },
      { title: 'info', severity: 'informational', minutes: 40 },
      { title: 'high', severity: 'high', minutes: 30 },
      { title: 'medium', severity: 'medium', minutes: 20 },
    ] as const;
    for (const s of specs) {
      await insertIncident({
        organizationId: org,
        title: s.title,
        severity: s.severity,
        lastEventAt: new Date(base + s.minutes * 60_000),
        createdAt: new Date(base - s.minutes * 60_000),
      });
    }

    const byLastEvent = await incidentsService.list({ organizationId: org });
    expect(byLastEvent.incidents.map((i) => i.title)).toEqual(['low', 'info', 'high', 'medium', 'critical']);

    const ascLastEvent = await incidentsService.list({ organizationId: org, order: 'asc' });
    expect(ascLastEvent.incidents.map((i) => i.title)).toEqual(['critical', 'medium', 'high', 'info', 'low']);

    const bySeverity = await incidentsService.list({ organizationId: org, sort: 'severity' });
    expect(bySeverity.incidents.map((i) => i.severity)).toEqual(['critical', 'high', 'medium', 'low', 'informational']);

    const bySeverityAsc = await incidentsService.list({ organizationId: org, sort: 'severity', order: 'asc' });
    expect(bySeverityAsc.incidents.map((i) => i.severity)).toEqual(['informational', 'low', 'medium', 'high', 'critical']);

    const byCreated = await incidentsService.list({ organizationId: org, sort: 'created_at' });
    expect(byCreated.incidents.map((i) => i.title)).toEqual(['critical', 'medium', 'high', 'info', 'low']);
  });

  it('breaks severity ties by last event', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    await insertIncident({ organizationId: org, title: 'older', severity: 'high', lastEventAt: new Date('2026-10-20T00:00:00.000Z') });
    await insertIncident({ organizationId: org, title: 'newer', severity: 'high', lastEventAt: new Date('2026-10-21T00:00:00.000Z') });
    const res = await incidentsService.list({ organizationId: org, sort: 'severity' });
    expect(res.incidents.map((i) => i.title)).toEqual(['newer', 'older']);
  });

  it('paginates with limit and offset while total counts all matches', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    const base = Date.parse('2026-10-20T00:00:00.000Z');
    for (let i = 0; i < 7; i++) {
      await insertIncident({ organizationId: org, title: `n${i}`, lastEventAt: new Date(base + i * 60_000) });
    }

    const page1 = await incidentsService.list({ organizationId: org, limit: 3 });
    const page3 = await incidentsService.list({ organizationId: org, limit: 3, offset: 6 });
    expect(page1.total).toBe(7);
    expect(page1.incidents.map((i) => i.title)).toEqual(['n6', 'n5', 'n4']);
    expect(page3.total).toBe(7);
    expect(page3.incidents.map((i) => i.title)).toEqual(['n0']);

    const defaults = await incidentsService.list({ organizationId: org });
    expect(defaults.incidents).toHaveLength(7);
  });

  it('returns a null sourceRef after the alert rule is deleted', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    const rule = await createTestAlertRule({ organizationId: org, name: 'Doomed' });
    const inc = await insertIncident({ organizationId: org, source: 'alert', alertRuleId: rule.id });
    await db.deleteFrom('alert_rules').where('id', '=', rule.id).where('organization_id', '=', org).execute();

    const item = await incidentsService.getItem(inc.id, org);
    expect(item).toMatchObject({ source: 'alert', alertRuleId: null, sourceRef: null });
  });

  it('never resolves a sourceRef to a rule or monitor of another organization', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    const ruleB = await createTestAlertRule({ organizationId: b.organization.id, name: 'B rule' });
    const monitorB = await createTestMonitor({ organizationId: b.organization.id, projectId: b.project.id, name: 'B monitor' });
    const inc1 = await insertIncident({ organizationId: a.organization.id, source: 'alert', alertRuleId: ruleB.id });
    const inc2 = await insertIncident({ organizationId: a.organization.id, source: 'monitor', monitorId: monitorB.id });

    const items = await incidentsService.listByIds(a.organization.id, [inc1.id, inc2.id]);
    expect(items.map((i) => i.sourceRef)).toEqual([null, null]);
  });

  it('getItem returns null for an unknown id and for another organization', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    const inc = await insertIncident({ organizationId: a.organization.id });
    expect(await incidentsService.getItem(crypto.randomUUID(), a.organization.id)).toBeNull();
    expect(await incidentsService.getItem(inc.id, b.organization.id)).toBeNull();
    expect((await incidentsService.getItem(inc.id, a.organization.id))!.id).toBe(inc.id);
  });

  it('listByIds keeps the input order and drops missing and foreign ids', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    const x = await insertIncident({ organizationId: a.organization.id, title: 'x' });
    const y = await insertIncident({ organizationId: a.organization.id, title: 'y' });
    const foreign = await insertIncident({ organizationId: b.organization.id, title: 'foreign' });

    const items = await incidentsService.listByIds(a.organization.id, [y.id, crypto.randomUUID(), foreign.id, x.id]);
    expect(items.map((i) => i.title)).toEqual(['y', 'x']);
    expect(await incidentsService.listByIds(a.organization.id, [])).toEqual([]);
  });

  it('listUpdatedSince returns only rows updated after the cursor, oldest first', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    const org = a.organization.id;
    const cursor = new Date('2026-10-21T10:00:00.000Z');
    await insertIncident({ organizationId: org, title: 'before', updatedAt: new Date('2026-10-21T09:59:59.000Z') });
    await insertIncident({ organizationId: org, title: 'at', updatedAt: cursor });
    await insertIncident({ organizationId: org, title: 'late', updatedAt: new Date('2026-10-21T10:00:30.000Z') });
    await insertIncident({ organizationId: org, title: 'early', updatedAt: new Date('2026-10-21T10:00:10.000Z') });
    await insertIncident({ organizationId: b.organization.id, title: 'foreign', updatedAt: new Date('2026-10-21T10:00:20.000Z') });

    const rows = await incidentsService.listUpdatedSince({ organizationId: org, since: cursor });
    expect(rows.map((r) => r.title)).toEqual(['early', 'late']);
    expect(rows[0].assignee).toBeNull();

    const limited = await incidentsService.listUpdatedSince({ organizationId: org, since: cursor, limit: 1 });
    expect(limited.map((r) => r.title)).toEqual(['early']);
  });

  it('listUpdatedSince honours sources and projectId', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    const p2 = await createTestProject({ organizationId: org, userId: ctx.user.id });
    const since = new Date('2026-10-21T10:00:00.000Z');
    const later = new Date('2026-10-21T10:01:00.000Z');
    await insertIncident({ organizationId: org, projectId: ctx.project.id, source: 'sigma', title: 'sigma p1', updatedAt: later });
    await insertIncident({ organizationId: org, projectId: ctx.project.id, source: 'alert', title: 'alert p1', updatedAt: later });
    await insertIncident({ organizationId: org, projectId: p2.id, source: 'alert', title: 'alert p2', updatedAt: later });

    const alerts = await incidentsService.listUpdatedSince({ organizationId: org, since, sources: ['alert'] });
    expect(alerts.map((r) => r.title).sort()).toEqual(['alert p1', 'alert p2']);

    const p1Alerts = await incidentsService.listUpdatedSince({ organizationId: org, since, sources: ['alert'], projectId: ctx.project.id });
    expect(p1Alerts.map((r) => r.title)).toEqual(['alert p1']);
  });

  it('listComments and listHistory return null for an unknown incident', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    expect(await incidentsService.listComments(crypto.randomUUID(), a.organization.id)).toBeNull();
    expect(await incidentsService.listHistory(crypto.randomUUID(), a.organization.id)).toBeNull();

    const inc = await insertIncident({ organizationId: a.organization.id });
    expect(await incidentsService.listComments(inc.id, b.organization.id)).toBeNull();
    expect(await incidentsService.listHistory(inc.id, b.organization.id)).toBeNull();
    expect(await incidentsService.listComments(inc.id, a.organization.id)).toEqual([]);
    expect(await incidentsService.listHistory(inc.id, a.organization.id)).toEqual([]);
  });

  it('listComments returns authors ascending and listHistory newest first', async () => {
    const ctx = await createTestContext();
    const org = ctx.organization.id;
    const inc = await insertIncident({ organizationId: org });
    await db
      .insertInto('incident_comments')
      .values([
        { incident_id: inc.id, user_id: ctx.user.id, comment: 'second', created_at: new Date('2026-10-21T10:01:00.000Z') },
        { incident_id: inc.id, user_id: ctx.user.id, comment: 'first', created_at: new Date('2026-10-21T10:00:00.000Z') },
      ])
      .execute();
    await insertHistory({ incidentId: inc.id, action: 'status_change', metadata: null, createdAt: new Date('2026-10-21T10:00:00.000Z') });
    await insertHistory({ incidentId: inc.id, action: 'severity_change', metadata: { reason: 'manual' }, createdAt: new Date('2026-10-21T10:02:00.000Z') });

    const comments = await incidentsService.listComments(inc.id, org);
    expect(comments!.map((c) => c.comment)).toEqual(['first', 'second']);
    expect(comments![0]).toMatchObject({ incidentId: inc.id, userId: ctx.user.id, userName: ctx.user.name, userEmail: ctx.user.email, edited: false });

    const history = await incidentsService.listHistory(inc.id, org);
    expect(history!.map((h) => h.action)).toEqual(['severity_change', 'status_change']);
    expect(history![0]).toMatchObject({ incidentId: inc.id, userId: null, metadata: { reason: 'manual' } });
    expect(history![0].userName).toBeUndefined();
  });
});
