import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import {
  createTestAlertRule,
  createTestContext,
  createTestProject,
  createTestSigmaRule,
  createTestUser,
} from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';
import { addOrgMember, createTestMonitor, insertIncident } from './fixtures.js';

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return createTestUser({ email: `routes-${seq}-${Date.now()}@example.com`, name });
}

async function setup() {
  const ctx = await createTestContext();
  const orgId = ctx.organization.id;
  const owner = ctx.user;
  const session = await createTestSession(owner.id);
  const member = await newUser('Member');
  await addOrgMember(orgId, member.id);
  const rule = await createTestAlertRule({ organizationId: orgId, projectId: ctx.project.id, name: 'High errors' });
  const monitor = await createTestMonitor({ organizationId: orgId, projectId: ctx.project.id, name: 'API health' });
  return { ...ctx, orgId, owner, member, rule, monitor, token: session.token };
}

async function seedEverySource(s: Awaited<ReturnType<typeof setup>>) {
  const sigma = await insertIncident({ organizationId: s.orgId, projectId: s.project.id, source: 'sigma', title: 'sigma' });
  const manual = await insertIncident({ organizationId: s.orgId, source: 'manual', title: 'manual' });
  const alert = await insertIncident({
    organizationId: s.orgId,
    projectId: s.project.id,
    source: 'alert',
    alertRuleId: s.rule.id,
    title: 'alert',
  });
  const monitor = await insertIncident({
    organizationId: s.orgId,
    projectId: s.project.id,
    source: 'monitor',
    monitorId: s.monitor.id,
    title: 'monitor',
  });
  return { sigma, manual, alert, monitor };
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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('incidents REST API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function get(url: string, token: string) {
    return app.inject({ method: 'GET', url, headers: auth(token) });
  }

  it('returns 401 without a session', async () => {
    const s = await setup();
    const res = await app.inject({ method: 'GET', url: `/api/v1/incidents?organizationId=${s.orgId}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for a user outside the organization', async () => {
    const s = await setup();
    const outsider = await newUser('Outsider');
    const outsiderSession = await createTestSession(outsider.id);
    const res = await get(`/api/v1/incidents?organizationId=${s.orgId}`, outsiderSession.token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'You are not a member of this organization' });
  });

  it('lists incidents of every source in the IncidentListItem shape', async () => {
    const s = await setup();
    const seeded = await seedEverySource(s);
    const res = await get(`/api/v1/incidents?organizationId=${s.orgId}`, s.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.incidents).toHaveLength(4);
    expect(Object.keys(body.incidents[0])).toEqual(
      expect.arrayContaining([
        'id', 'source', 'status', 'severity', 'title', 'projectId', 'project', 'assignee', 'sourceRef',
        'alertRuleId', 'monitorId', 'acknowledgedAt', 'acknowledgedBy', 'resolvedAt', 'resolvedBy',
        'lastEventAt', 'createdAt', 'updatedAt',
      ])
    );
    const byId = new Map(body.incidents.map((i: any) => [i.id, i]));
    expect((byId.get(seeded.alert.id) as any).sourceRef).toEqual({ kind: 'alert', id: s.rule.id, name: 'High errors' });
    expect((byId.get(seeded.monitor.id) as any).sourceRef).toEqual({
      kind: 'monitor',
      id: s.monitor.id,
      name: 'API health',
    });
    expect((byId.get(seeded.sigma.id) as any).project).toEqual({ id: s.project.id, name: s.project.name });
  });

  it('accepts repeated and comma separated source filters alike', async () => {
    const s = await setup();
    const seeded = await seedEverySource(s);
    const repeated = await get(`/api/v1/incidents?organizationId=${s.orgId}&source=alert&source=monitor`, s.token);
    const comma = await get(`/api/v1/incidents?organizationId=${s.orgId}&source=alert,monitor`, s.token);
    expect(repeated.statusCode).toBe(200);
    expect(comma.statusCode).toBe(200);
    const ids = (r: typeof repeated) => r.json().incidents.map((i: any) => i.id).sort();
    expect(ids(repeated)).toEqual([seeded.alert.id, seeded.monitor.id].sort());
    expect(ids(comma)).toEqual(ids(repeated));
    expect(repeated.json().total).toBe(2);

    const statuses = await get(`/api/v1/incidents?organizationId=${s.orgId}&status=open,resolved&severity=medium`, s.token);
    expect(statuses.json().total).toBe(4);

    const bogus = await get(`/api/v1/incidents?organizationId=${s.orgId}&source=bogus`, s.token);
    expect(bogus.statusCode).toBe(400);
    expect(bogus.json().error).toBe('Validation error');
  });

  it('resolves assignee=me, unassigned and anyone', async () => {
    const s = await setup();
    const mine = await insertIncident({ organizationId: s.orgId, assigneeId: s.owner.id, title: 'mine' });
    const theirs = await insertIncident({ organizationId: s.orgId, assigneeId: s.member.id, title: 'theirs' });
    const nobody = await insertIncident({ organizationId: s.orgId, title: 'nobody' });
    const base = `/api/v1/incidents?organizationId=${s.orgId}`;
    const ids = async (q: string) => (await get(`${base}${q}`, s.token)).json().incidents.map((i: any) => i.id).sort();

    expect(await ids('&assignee=me')).toEqual([mine.id]);
    expect(await ids('&assignee=unassigned')).toEqual([nobody.id]);
    expect(await ids('&assignee=anyone')).toEqual([mine.id, theirs.id, nobody.id].sort());
    expect(await ids(`&assignee=${s.member.id}`)).toEqual([theirs.id]);
    expect(await ids(`&assigneeId=${s.member.id}`)).toEqual([theirs.id]);

    const outsider = await newUser('Outsider');
    const res = await get(`${base}&assignee=${outsider.id}`, s.token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Assignee is not a member of this organization', code: 'invalid_assignee' });
  });

  it('filters by several projectId values and by ruleId', async () => {
    const s = await setup();
    const p2 = await createTestProject({ organizationId: s.orgId, userId: s.owner.id, name: 'Second' });
    const p3 = await createTestProject({ organizationId: s.orgId, userId: s.owner.id, name: 'Third' });
    const i1 = await insertIncident({ organizationId: s.orgId, projectId: s.project.id });
    const i2 = await insertIncident({ organizationId: s.orgId, projectId: p2.id });
    await insertIncident({ organizationId: s.orgId, projectId: p3.id });
    await insertIncident({ organizationId: s.orgId, projectId: null });
    const base = `/api/v1/incidents?organizationId=${s.orgId}`;
    const ids = async (q: string) => (await get(`${base}${q}`, s.token)).json().incidents.map((i: any) => i.id).sort();

    expect(await ids(`&projectId=${s.project.id}&projectId=${p2.id}`)).toEqual([i1.id, i2.id].sort());
    expect(await ids(`&projectId=${s.project.id},${p2.id}`)).toEqual([i1.id, i2.id].sort());

    const sigmaRule = await createTestSigmaRule({ organizationId: s.orgId, projectId: s.project.id });
    await insertDetection({ organizationId: s.orgId, projectId: s.project.id, sigmaRuleId: sigmaRule.id, incidentId: i2.id });
    expect(await ids(`&ruleId=${sigmaRule.id}`)).toEqual([i2.id]);
  });

  it('detail includes sourceEvents for an alert incident and an empty array for sigma', async () => {
    const s = await setup();
    const t1 = new Date('2026-10-21T09:00:00.000Z');
    const opened = await incidentsService.openOrUpdateFromSource({
      organizationId: s.orgId,
      projectId: s.project.id,
      source: 'alert',
      sourceId: s.rule.id,
      title: 'High errors firing',
      severity: 'high',
      occurredAt: t1,
      metadata: { summary: '12 errors in 5 minutes' },
    });
    const sigma = await insertIncident({ organizationId: s.orgId, source: 'sigma' });

    const alertRes = await get(`/api/v1/incidents/${opened.incident.id}?organizationId=${s.orgId}`, s.token);
    expect(alertRes.statusCode).toBe(200);
    expect(alertRes.json().sourceEvents).toEqual([
      expect.objectContaining({ kind: 'alert_trigger', time: t1.toISOString(), summary: '12 errors in 5 minutes' }),
    ]);

    const sigmaRes = await get(`/api/v1/incidents/${sigma.id}?organizationId=${s.orgId}`, s.token);
    expect(sigmaRes.json().sourceEvents).toEqual([]);
  });

  it('returns the detail envelope and 404 for another org incident', async () => {
    const s = await setup();
    const other = await createTestContext();
    const inc = await insertIncident({ organizationId: s.orgId, projectId: s.project.id, title: 'mine' });
    const foreign = await insertIncident({ organizationId: other.organization.id, title: 'foreign' });

    const res = await get(`/api/v1/incidents/${inc.id}?organizationId=${s.orgId}`, s.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['comments', 'detections', 'history', 'incident', 'sourceEvents']);
    expect(body.incident).toMatchObject({ id: inc.id, title: 'mine', project: { id: s.project.id } });

    const foreignRes = await get(`/api/v1/incidents/${foreign.id}?organizationId=${s.orgId}`, s.token);
    expect(foreignRes.statusCode).toBe(404);
    expect(foreignRes.json()).toEqual({ error: 'Incident not found' });

    const badId = await get(`/api/v1/incidents/not-a-uuid?organizationId=${s.orgId}`, s.token);
    expect(badId.statusCode).toBe(400);
  });

  it('sorts by last event by default', async () => {
    const s = await setup();
    const now = Date.now();
    const oldest = await insertIncident({
      organizationId: s.orgId,
      lastEventAt: new Date(now - 3 * 60_000),
      createdAt: new Date(now - 60_000),
    });
    const newest = await insertIncident({
      organizationId: s.orgId,
      lastEventAt: new Date(now - 60_000),
      createdAt: new Date(now - 3 * 60_000),
    });
    const middle = await insertIncident({
      organizationId: s.orgId,
      lastEventAt: new Date(now - 2 * 60_000),
      createdAt: new Date(now - 2 * 60_000),
    });
    const base = `/api/v1/incidents?organizationId=${s.orgId}`;
    const ids = async (q: string) => (await get(`${base}${q}`, s.token)).json().incidents.map((i: any) => i.id);

    expect(await ids('')).toEqual([newest.id, middle.id, oldest.id]);
    expect(await ids('&sort=created_at')).toEqual([oldest.id, middle.id, newest.id]);
    expect(await ids('&order=asc')).toEqual([oldest.id, middle.id, newest.id]);
    expect(await ids('&limit=1&offset=1')).toEqual([middle.id]);
  });

  it('rejects limit 101 with 400', async () => {
    const s = await setup();
    const res = await get(`/api/v1/incidents?organizationId=${s.orgId}&limit=101`, s.token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Validation error', details: expect.any(Array) });
  });

  it('PATCH assigneeId null unassigns', async () => {
    const s = await setup();
    const inc = await insertIncident({ organizationId: s.orgId, assigneeId: s.member.id });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${inc.id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, assigneeId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: inc.id, assigneeId: null, assignee: null });
  });

  it('PATCH investigating stamps the caller as acknowledgedBy', async () => {
    const s = await setup();
    const inc = await insertIncident({ organizationId: s.orgId, source: 'alert' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${inc.id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, status: 'investigating' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'investigating', acknowledgedBy: s.owner.id });
    expect(res.json().acknowledgedAt).not.toBeNull();
  });

  it('PATCH false_positive on an alert incident answers 409 invalid_transition', async () => {
    const s = await setup();
    const inc = await insertIncident({ organizationId: s.orgId, source: 'alert' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${inc.id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, status: 'false_positive' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'False positive applies to security incidents only', code: 'invalid_transition' });
  });

  it('PATCH with a non-member assignee answers 400 invalid_assignee', async () => {
    const s = await setup();
    const outsider = await newUser('Outsider');
    const inc = await insertIncident({ organizationId: s.orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${inc.id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, assigneeId: outsider.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Assignee is not a member of this organization', code: 'invalid_assignee' });
  });

  it('PATCH an unknown id answers 404', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${crypto.randomUUID()}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, status: 'resolved' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Incident not found' });
  });

  it('POST /bulk acknowledges and reports skipped ids', async () => {
    const s = await setup();
    const other = await createTestContext();
    const open1 = await insertIncident({ organizationId: s.orgId });
    const resolved1 = await insertIncident({ organizationId: s.orgId, status: 'resolved' });
    const foreign = await insertIncident({ organizationId: other.organization.id });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents/bulk',
      headers: auth(s.token),
      payload: { organizationId: s.orgId, ids: [open1.id, resolved1.id, foreign.id], action: 'acknowledge' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['skipped', 'updated']);
    expect(body.updated.map((i: any) => i.id)).toEqual([open1.id]);
    expect(body.updated[0]).toMatchObject({ status: 'investigating', acknowledgedBy: s.owner.id });
    expect(body.skipped).toEqual([
      { id: resolved1.id, reason: 'invalid_transition' },
      { id: foreign.id, reason: 'not_found' },
    ]);

    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('organization_id', '=', s.orgId)
      .where('resource_id', 'in', [open1.id, resolved1.id, foreign.id])
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'incident.status_changed',
      resource_id: open1.id,
      actor_id: s.owner.id,
      metadata: { bulk: true, action: 'acknowledge' },
    });
  });

  it('POST /bulk rejects 101 ids and assign without assigneeId', async () => {
    const s = await setup();
    const tooMany = Array.from({ length: 101 }, () => crypto.randomUUID());
    const big = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents/bulk',
      headers: auth(s.token),
      payload: { organizationId: s.orgId, ids: tooMany, action: 'resolve' },
    });
    expect(big.statusCode).toBe(400);
    expect(big.json().error).toBe('Validation error');

    const inc = await insertIncident({ organizationId: s.orgId });
    const noAssignee = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents/bulk',
      headers: auth(s.token),
      payload: { organizationId: s.orgId, ids: [inc.id], action: 'assign' },
    });
    expect(noAssignee.statusCode).toBe(400);
    expect(noAssignee.json().error).toBe('Validation error');

    const outsider = await newUser('Outsider');
    const outsiderSession = await createTestSession(outsider.id);
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents/bulk',
      headers: auth(outsiderSession.token),
      payload: { organizationId: s.orgId, ids: [inc.id], action: 'resolve' },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('comments can be added and listed', async () => {
    const s = await setup();
    const inc = await insertIncident({ organizationId: s.orgId });

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${inc.id}/comments`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, comment: 'Looking into it' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      incidentId: inc.id,
      userId: s.owner.id,
      comment: 'Looking into it',
      userName: s.owner.name,
    });

    const listed = await get(`/api/v1/incidents/${inc.id}/comments?organizationId=${s.orgId}`, s.token);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().comments.map((c: any) => c.comment)).toEqual(['Looking into it']);

    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${crypto.randomUUID()}/comments`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, comment: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'Incident not found' });

    const missingList = await get(`/api/v1/incidents/${crypto.randomUUID()}/comments?organizationId=${s.orgId}`, s.token);
    expect(missingList.statusCode).toBe(404);

    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${inc.id}/comments`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, comment: '' },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('history lists the status change with the caller name', async () => {
    const s = await setup();
    const inc = await insertIncident({ organizationId: s.orgId });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${inc.id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, status: 'resolved' },
    });

    const res = await get(`/api/v1/incidents/${inc.id}/history?organizationId=${s.orgId}`, s.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().history).toEqual([
      expect.objectContaining({
        action: 'status_change',
        oldValue: 'open',
        newValue: 'resolved',
        userId: s.owner.id,
        userName: s.owner.name,
      }),
    ]);

    const missing = await get(`/api/v1/incidents/${crypto.randomUUID()}/history?organizationId=${s.orgId}`, s.token);
    expect(missing.statusCode).toBe(404);
  });

  it('legacy alias returns the same items as /api/v1/incidents with sort=created_at', async () => {
    const s = await setup();
    await seedEverySource(s);
    await insertIncident({ organizationId: s.orgId, assigneeId: s.member.id, title: 'assigned' });

    const canonical = await get(`/api/v1/incidents?organizationId=${s.orgId}&sort=created_at`, s.token);
    const legacy = await get(`/api/v1/siem/incidents?organizationId=${s.orgId}`, s.token);
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toEqual(canonical.json());
    expect(legacy.json().total).toBe(5);

    const filtered = '&source=alert,monitor&status=open';
    expect((await get(`/api/v1/siem/incidents?organizationId=${s.orgId}${filtered}`, s.token)).json()).toEqual(
      (await get(`/api/v1/incidents?organizationId=${s.orgId}${filtered}&sort=created_at`, s.token)).json()
    );
  });

  it('records an audit entry for PATCH', async () => {
    const s = await setup();
    const inc = await insertIncident({ organizationId: s.orgId });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${inc.id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, status: 'resolved', severity: 'high' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${inc.id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, title: 'Renamed' },
    });

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('organization_id', '=', s.orgId)
      .where('resource_id', '=', inc.id)
      .orderBy('time', 'asc')
      .execute();
    expect(rows.map((r) => r.action).sort()).toEqual(['incident.status_changed', 'incident.updated']);
    const statusRow = rows.find((r) => r.action === 'incident.status_changed')!;
    expect(statusRow).toMatchObject({
      resource_type: 'incident',
      actor_id: s.owner.id,
      metadata: { status: 'resolved', severity: 'high' },
    });
  });
});
