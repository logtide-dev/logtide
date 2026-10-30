/**
 * Tenant isolation of the incidents module: every public IncidentsService
 * method and the REST routes (canonical base and the SIEM alias) stay inside
 * the caller organization, whatever foreign ids they are handed.
 *
 * No global cleanup, like siem/tenant-isolation.test.ts: every test builds
 * two fresh organizations and only asserts on their rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import { IncidentError } from '../../../modules/incidents/types.js';
import {
  createTestAlertRule,
  createTestContext,
  createTestSigmaRule,
} from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';
import { createTestMonitor, insertIncident } from './fixtures.js';

const occurredAt = new Date('2026-10-21T12:00:00.000Z');

/** One organization with one incident per source, a monitor, an alert rule, a comment and a history row. */
async function setupOrg(label: string) {
  const ctx = await createTestContext();
  const orgId = ctx.organization.id;
  const user = ctx.user;
  const rule = await createTestAlertRule({ organizationId: orgId, projectId: ctx.project.id, name: `${label} rule` });
  const monitor = await createTestMonitor({ organizationId: orgId, projectId: ctx.project.id, name: `${label} monitor` });
  const sigmaRule = await createTestSigmaRule({ organizationId: orgId, projectId: ctx.project.id, title: `${label} sigma` });

  const sigma = await insertIncident({ organizationId: orgId, projectId: ctx.project.id, source: 'sigma', title: `${label} sigma` });
  const manual = await insertIncident({ organizationId: orgId, source: 'manual', title: `${label} manual` });
  const alert = await insertIncident({
    organizationId: orgId,
    projectId: ctx.project.id,
    source: 'alert',
    alertRuleId: rule.id,
    title: `${label} alert`,
    lastEventAt: occurredAt,
  });
  const uptime = await insertIncident({
    organizationId: orgId,
    projectId: ctx.project.id,
    source: 'monitor',
    monitorId: monitor.id,
    title: `${label} monitor`,
    lastEventAt: occurredAt,
  });

  // A detection of this organization behind its sigma incident.
  await db
    .insertInto('detection_events')
    .values({
      time: new Date(),
      organization_id: orgId,
      project_id: ctx.project.id,
      sigma_rule_id: sigmaRule.id,
      log_id: crypto.randomUUID(),
      severity: 'high',
      rule_title: `${label} sigma`,
      rule_description: null,
      mitre_tactics: null,
      mitre_techniques: null,
      service: 'api',
      log_level: 'error',
      log_message: 'boom',
      trace_id: null,
      matched_fields: null,
      incident_id: sigma.id,
    })
    .execute();

  const comment = await incidentsService.addComment({
    incidentId: sigma.id,
    organizationId: orgId,
    userId: user.id,
    comment: `${label} comment`,
  });
  // One history row (severity change) written by the trigger.
  await incidentsService.update(sigma.id, orgId, { severity: 'high' }, user.id);

  return {
    ...ctx,
    orgId,
    user,
    rule,
    monitor,
    sigmaRule,
    comment: comment!,
    incidents: { sigma, manual, alert, uptime },
    ids: [sigma.id, manual.id, alert.id, uptime.id],
  };
}

type Org = Awaited<ReturnType<typeof setupOrg>>;

async function setupPair(): Promise<{ a: Org; b: Org }> {
  const a = await setupOrg('A');
  const b = await setupOrg('B');
  return { a, b };
}

/** Raw rows of the organization, plus comment and history counts, to prove nothing changed. */
async function snapshot(org: Org) {
  const rows = await db
    .selectFrom('incidents')
    .selectAll()
    .where('organization_id', '=', org.orgId)
    .orderBy('id')
    .execute();
  const comments = await db
    .selectFrom('incident_comments')
    .select(['id', 'incident_id', 'comment'])
    .where('incident_id', 'in', org.ids)
    .orderBy('id')
    .execute();
  const history = await db
    .selectFrom('incident_history')
    .select(['id', 'incident_id', 'action'])
    .where('incident_id', 'in', org.ids)
    .orderBy('id')
    .execute();
  return { rows, comments, history };
}

async function expectIncidentError(promise: Promise<unknown>, code: IncidentError['code']) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(IncidentError);
  expect((error as IncidentError).code).toBe(code);
}

describe('incidents tenant isolation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('list never returns another organization, even with its project ids', async () => {
    const { a, b } = await setupPair();

    const withForeignProject = await incidentsService.list({ organizationId: a.orgId, projectIds: [b.project.id] });
    expect(withForeignProject).toEqual({ incidents: [], total: 0 });

    const all = await incidentsService.list({ organizationId: a.orgId, limit: 100 });
    expect(all.total).toBe(4);
    expect(all.incidents.map((i) => i.id).sort()).toEqual([...a.ids].sort());
    expect(all.incidents.every((i) => i.organizationId === a.orgId)).toBe(true);

    // Every other filter keyed by a foreign id matches nothing either.
    const byForeignRule = await incidentsService.list({ organizationId: a.orgId, ruleId: b.sigmaRule.id });
    expect(byForeignRule.total).toBe(0);
    await incidentsService.update(b.incidents.sigma.id, b.orgId, { assigneeId: b.user.id }, b.user.id);
    const byForeignAssignee = await incidentsService.list({ organizationId: a.orgId, assigneeId: b.user.id });
    expect(byForeignAssignee.total).toBe(0);
    expect((await incidentsService.list({ organizationId: b.orgId, assigneeId: b.user.id })).total).toBe(1);

    // A detection of B pointing at an incident of A does not satisfy the rule filter.
    await db
      .insertInto('detection_events')
      .values({
        time: new Date(),
        organization_id: b.orgId,
        project_id: b.project.id,
        sigma_rule_id: b.sigmaRule.id,
        log_id: crypto.randomUUID(),
        severity: 'high',
        rule_title: 'injected',
        rule_description: null,
        mitre_tactics: null,
        mitre_techniques: null,
        service: 'api',
        log_level: 'error',
        log_message: 'injected',
        trace_id: null,
        matched_fields: null,
        incident_id: a.incidents.sigma.id,
      })
      .execute();
    expect((await incidentsService.list({ organizationId: a.orgId, ruleId: b.sigmaRule.id })).total).toBe(0);
    expect((await incidentsService.list({ organizationId: a.orgId, ruleId: a.sigmaRule.id })).total).toBe(1);

    expect(await incidentsService.listByIds(a.orgId, b.ids)).toEqual([]);
  });

  it('getItem, listComments and listHistory return null across organizations', async () => {
    const { a, b } = await setupPair();

    for (const id of b.ids) {
      expect(await incidentsService.getItem(id, a.orgId)).toBeNull();
      expect(await incidentsService.listComments(id, a.orgId)).toBeNull();
      expect(await incidentsService.listHistory(id, a.orgId)).toBeNull();
      expect(await incidentsService.listSourceEvents(id, a.orgId)).toBeNull();
    }

    // Positive control: the owner organization sees them.
    expect(await incidentsService.getItem(b.incidents.sigma.id, b.orgId)).not.toBeNull();
    const comments = await incidentsService.listComments(b.incidents.sigma.id, b.orgId);
    expect(comments!.map((c) => c.id)).toEqual([b.comment.id]);
    const history = await incidentsService.listHistory(b.incidents.sigma.id, b.orgId);
    expect(history!.map((h) => h.action)).toEqual(['severity_change']);
  });

  it('listUpdatedSince only streams the caller organization', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const { a, b } = await setupPair();

    const stream = await incidentsService.listUpdatedSince({ organizationId: a.orgId, since, limit: 100 });
    expect(stream.map((i) => i.id).sort()).toEqual([...a.ids].sort());
    expect(stream.every((i) => i.organizationId === a.orgId)).toBe(true);

    const foreignProject = await incidentsService.listUpdatedSince({
      organizationId: a.orgId,
      since,
      projectId: b.project.id,
    });
    expect(foreignProject).toEqual([]);

    const bySource = await incidentsService.listUpdatedSince({
      organizationId: a.orgId,
      since,
      sources: ['alert', 'monitor'],
    });
    expect(bySource.map((i) => i.id).sort()).toEqual([a.incidents.alert.id, a.incidents.uptime.id].sort());
  });

  it('update, acknowledge and addComment cannot touch another organization', async () => {
    const { a, b } = await setupPair();
    const before = await snapshot(b);

    for (const id of b.ids) {
      expect(
        await incidentsService.update(id, a.orgId, { status: 'resolved', title: 'hijacked', severity: 'critical' }, a.user.id)
      ).toBeNull();
      expect(await incidentsService.acknowledge(id, a.orgId, a.user.id)).toBeNull();
      expect(
        await incidentsService.addComment({ incidentId: id, organizationId: a.orgId, userId: a.user.id, comment: 'hijacked' })
      ).toBeNull();
    }

    expect(await snapshot(b)).toEqual(before);
  });

  it('bulk reports foreign ids as not_found and leaves them untouched', async () => {
    const { a, b } = await setupPair();
    const before = await snapshot(b);

    const resolved = await incidentsService.bulk({
      organizationId: a.orgId,
      ids: [a.incidents.sigma.id, b.incidents.sigma.id, b.incidents.alert.id],
      action: 'resolve',
      actorId: a.user.id,
    });
    expect(resolved.updated.map((i) => i.id)).toEqual([a.incidents.sigma.id]);
    expect(resolved.changedIds).toEqual([a.incidents.sigma.id]);
    expect(resolved.skipped).toEqual([
      { id: b.incidents.sigma.id, reason: 'not_found' },
      { id: b.incidents.alert.id, reason: 'not_found' },
    ]);

    for (const action of ['acknowledge', 'assign'] as const) {
      const result = await incidentsService.bulk({
        organizationId: a.orgId,
        ids: b.ids,
        action,
        ...(action === 'assign' && { assigneeId: a.user.id }),
        actorId: a.user.id,
      });
      expect(result.updated).toEqual([]);
      expect(result.changedIds).toEqual([]);
      expect(result.skipped).toEqual(b.ids.map((id) => ({ id, reason: 'not_found' })));
    }

    expect(await snapshot(b)).toEqual(before);
  });

  it('openOrUpdateFromSource refuses a source of another organization', async () => {
    const { a, b } = await setupPair();
    const before = await snapshot(b);
    const beforeA = await snapshot(a);

    const base = {
      organizationId: a.orgId,
      projectId: a.project.id,
      title: 'Hijacked',
      severity: 'critical' as const,
      occurredAt: new Date('2026-10-21T13:00:00.000Z'),
    };
    await expectIncidentError(
      incidentsService.openOrUpdateFromSource({ ...base, source: 'alert', sourceId: b.rule.id }),
      'source_not_found'
    );
    await expectIncidentError(
      incidentsService.openOrUpdateFromSource({ ...base, source: 'monitor', sourceId: b.monitor.id }),
      'source_not_found'
    );
    // Own source, foreign project.
    await expectIncidentError(
      incidentsService.openOrUpdateFromSource({ ...base, source: 'alert', sourceId: a.rule.id, projectId: b.project.id }),
      'source_not_found'
    );

    expect(await snapshot(b)).toEqual(before);
    expect(await snapshot(a)).toEqual(beforeA);
    const foreignInA = await db
      .selectFrom('incidents')
      .select('id')
      .where('organization_id', '=', a.orgId)
      .where((eb) => eb.or([eb('alert_rule_id', '=', b.rule.id), eb('monitor_id', '=', b.monitor.id)]))
      .execute();
    expect(foreignInA).toEqual([]);
  });

  it('resolveFromSource with a foreign source id resolves nothing', async () => {
    const { a, b } = await setupPair();
    const before = await snapshot(b);

    expect(
      await incidentsService.resolveFromSource({
        organizationId: a.orgId,
        source: 'alert',
        sourceId: b.rule.id,
        resolvedAt: new Date(),
        reason: 'recovered',
      })
    ).toBeNull();
    expect(
      await incidentsService.resolveFromSource({
        organizationId: a.orgId,
        source: 'monitor',
        sourceId: b.monitor.id,
        resolvedAt: new Date(),
        reason: 'manual',
      })
    ).toBeNull();

    const after = await snapshot(b);
    expect(after).toEqual(before);
    expect(after.rows.find((r) => r.id === b.incidents.alert.id)!.status).toBe('open');
    expect(after.rows.find((r) => r.id === b.incidents.uptime.id)!.status).toBe('open');
  });

  it('a member of B cannot be assigned in A', async () => {
    const { a, b } = await setupPair();
    const beforeA = await snapshot(a);

    await expectIncidentError(incidentsService.assertAssignableUser(a.orgId, b.user.id), 'invalid_assignee');
    await expectIncidentError(
      incidentsService.update(a.incidents.sigma.id, a.orgId, { assigneeId: b.user.id }, a.user.id),
      'invalid_assignee'
    );
    await expectIncidentError(
      incidentsService.bulk({
        organizationId: a.orgId,
        ids: a.ids,
        action: 'assign',
        assigneeId: b.user.id,
        actorId: a.user.id,
      }),
      'invalid_assignee'
    );
    expect(await snapshot(a)).toEqual(beforeA);

    const { token } = await createTestSession(a.user.id);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${a.incidents.sigma.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: a.orgId, assigneeId: b.user.id },
    });
    expect(patch.statusCode).toBe(400);
    expect(patch.json()).toMatchObject({ code: 'invalid_assignee' });

    const filter = await app.inject({
      method: 'GET',
      url: `/api/v1/incidents?organizationId=${a.orgId}&assignee=${b.user.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(filter.statusCode).toBe(400);
    expect(filter.json()).toMatchObject({ code: 'invalid_assignee' });

    expect(await snapshot(a)).toEqual(beforeA);
  });

  it('list items never join names from another organization', async () => {
    const { a, b } = await setupPair();

    // Foreign references written behind the service's back (e.g. a user who
    // left the organization, or a corrupted row): resolved so the active
    // alert index of B does not conflict.
    const stray = await insertIncident({
      organizationId: a.orgId,
      projectId: b.project.id,
      source: 'alert',
      status: 'resolved',
      alertRuleId: b.rule.id,
      assigneeId: b.user.id,
      title: 'stray',
    });

    const item = await incidentsService.getItem(stray.id, a.orgId);
    expect(item).toMatchObject({ id: stray.id, assignee: null, project: null, sourceRef: null });

    const listed = await incidentsService.list({ organizationId: a.orgId, limit: 100 });
    const listedStray = listed.incidents.find((i) => i.id === stray.id)!;
    expect(listedStray).toMatchObject({ assignee: null, project: null, sourceRef: null });
  });

  it('the REST list ignores organizationId of a non-member with 403', async () => {
    const { a, b } = await setupPair();
    const { token } = await createTestSession(a.user.id);
    const headers = { authorization: `Bearer ${token}` };

    for (const base of ['/api/v1/incidents', '/api/v1/siem/incidents']) {
      const list = await app.inject({ method: 'GET', url: `${base}?organizationId=${b.orgId}`, headers });
      expect(list.statusCode).toBe(403);
      expect(list.json()).toEqual({ error: 'You are not a member of this organization' });

      const detail = await app.inject({
        method: 'GET',
        url: `${base}/${b.incidents.sigma.id}?organizationId=${b.orgId}`,
        headers,
      });
      expect(detail.statusCode).toBe(403);

      const bulk = await app.inject({
        method: 'POST',
        url: `${base}/bulk`,
        headers,
        payload: { organizationId: b.orgId, ids: b.ids, action: 'resolve' },
      });
      expect(bulk.statusCode).toBe(403);

      const comment = await app.inject({
        method: 'POST',
        url: `${base}/${b.incidents.sigma.id}/comments`,
        headers,
        payload: { organizationId: b.orgId, comment: 'hijacked' },
      });
      expect(comment.statusCode).toBe(403);
    }
  });

  it('REST calls with a foreign incident id under the caller organization return 404', async () => {
    const { a, b } = await setupPair();
    const before = await snapshot(b);
    const { token } = await createTestSession(a.user.id);
    const headers = { authorization: `Bearer ${token}` };
    const foreign = b.incidents.alert.id;

    for (const base of ['/api/v1/incidents', '/api/v1/siem/incidents']) {
      const detail = await app.inject({ method: 'GET', url: `${base}/${foreign}?organizationId=${a.orgId}`, headers });
      expect(detail.statusCode).toBe(404);

      const comments = await app.inject({
        method: 'GET',
        url: `${base}/${foreign}/comments?organizationId=${a.orgId}`,
        headers,
      });
      expect(comments.statusCode).toBe(404);

      const history = await app.inject({
        method: 'GET',
        url: `${base}/${foreign}/history?organizationId=${a.orgId}`,
        headers,
      });
      expect(history.statusCode).toBe(404);

      const patch = await app.inject({
        method: 'PATCH',
        url: `${base}/${foreign}`,
        headers,
        payload: { organizationId: a.orgId, status: 'resolved', title: 'hijacked' },
      });
      expect(patch.statusCode).toBe(404);

      const comment = await app.inject({
        method: 'POST',
        url: `${base}/${foreign}/comments`,
        headers,
        payload: { organizationId: a.orgId, comment: 'hijacked' },
      });
      expect(comment.statusCode).toBe(404);

      const bulk = await app.inject({
        method: 'POST',
        url: `${base}/bulk`,
        headers,
        payload: { organizationId: a.orgId, ids: [foreign], action: 'acknowledge' },
      });
      expect(bulk.statusCode).toBe(200);
      expect(bulk.json()).toEqual({ updated: [], skipped: [{ id: foreign, reason: 'not_found' }] });
    }

    expect(await snapshot(b)).toEqual(before);
  });
});
