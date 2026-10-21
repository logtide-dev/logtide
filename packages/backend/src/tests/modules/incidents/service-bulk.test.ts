import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';
import { addOrgMember, insertIncident } from './fixtures.js';

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return createTestUser({ email: `bulk-${seq}-${Date.now()}@example.com`, name });
}

async function setup() {
  const ctx = await createTestContext();
  const orgA = ctx.organization.id;
  const owner = ctx.user;
  const member = await newUser('Member');
  await addOrgMember(orgA, member.id);
  const other = await createTestContext();
  return { ...ctx, orgA, owner, member, other, orgB: other.organization.id };
}

async function rawRow(id: string, orgId: string) {
  return db
    .selectFrom('incidents')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirstOrThrow();
}

describe('IncidentsService bulk actions', () => {
  it('bulk acknowledge updates open ones and skips resolved and foreign ids', async () => {
    const { orgA, orgB, owner } = await setup();
    const open1 = (await insertIncident({ organizationId: orgA, source: 'alert' })).id;
    const ack1 = (await insertIncident({ organizationId: orgA, status: 'investigating' })).id;
    const resolved1 = (await insertIncident({ organizationId: orgA, status: 'resolved' })).id;
    const foreignB = (await insertIncident({ organizationId: orgB })).id;

    const r = await incidentsService.bulk({
      organizationId: orgA,
      ids: [open1, ack1, resolved1, foreignB],
      action: 'acknowledge',
      actorId: owner.id,
    });

    expect(r.updated.map((i) => i.id)).toEqual([open1, ack1]);
    expect(r.updated[0]).toMatchObject({ status: 'investigating', acknowledgedBy: owner.id });
    expect(r.updated[0].acknowledgedAt).not.toBeNull();
    expect(r.updated[1]).toMatchObject({ status: 'investigating', acknowledgedBy: null });
    expect(r.skipped).toEqual([
      { id: resolved1, reason: 'invalid_transition' },
      { id: foreignB, reason: 'not_found' },
    ]);
    expect(r.changedIds).toEqual([open1]);

    expect((await rawRow(resolved1, orgA)).status).toBe('resolved');
    expect((await rawRow(foreignB, orgB)).status).toBe('open');
  });

  it('bulk resolve sets resolvedBy and skips false positives', async () => {
    const { orgA, owner } = await setup();
    const open1 = (await insertIncident({ organizationId: orgA, source: 'monitor' })).id;
    const ack1 = (await insertIncident({ organizationId: orgA, status: 'investigating' })).id;
    const resolved1 = (await insertIncident({ organizationId: orgA, status: 'resolved' })).id;
    const fp1 = (await insertIncident({ organizationId: orgA, status: 'false_positive' })).id;
    const unknown = crypto.randomUUID();

    const r = await incidentsService.bulk({
      organizationId: orgA,
      ids: [open1, ack1, resolved1, fp1, unknown, 'not-a-uuid'],
      action: 'resolve',
      actorId: owner.id,
    });

    expect(r.updated.map((i) => i.id)).toEqual([open1, ack1, resolved1]);
    expect(r.updated[0]).toMatchObject({ status: 'resolved', resolvedBy: owner.id });
    expect(r.updated[0].resolvedAt).not.toBeNull();
    expect(r.updated[1]).toMatchObject({ status: 'resolved', resolvedBy: owner.id });
    expect(r.updated[2]).toMatchObject({ status: 'resolved', resolvedBy: null });
    expect(r.skipped).toEqual([
      { id: fp1, reason: 'invalid_transition' },
      { id: unknown, reason: 'not_found' },
      { id: 'not-a-uuid', reason: 'not_found' },
    ]);
    expect(r.changedIds).toEqual([open1, ack1]);
    expect((await rawRow(fp1, orgA)).status).toBe('false_positive');
  });

  it('bulk assign assigns and unassigns', async () => {
    const { orgA, owner, member } = await setup();
    const a = (await insertIncident({ organizationId: orgA })).id;
    const b = (await insertIncident({ organizationId: orgA, status: 'resolved' })).id;
    const c = (await insertIncident({ organizationId: orgA, assigneeId: member.id })).id;

    const assigned = await incidentsService.bulk({
      organizationId: orgA,
      ids: [a, b, c],
      action: 'assign',
      assigneeId: member.id,
      actorId: owner.id,
    });
    expect(assigned.updated.map((i) => i.id)).toEqual([a, b, c]);
    expect(assigned.updated.every((i) => i.assigneeId === member.id)).toBe(true);
    expect(assigned.updated[0].assignee).toEqual({ id: member.id, name: member.name, email: member.email });
    expect(assigned.skipped).toEqual([]);
    expect(assigned.changedIds).toEqual([a, b]);

    const unassigned = await incidentsService.bulk({
      organizationId: orgA,
      ids: [a, c],
      action: 'assign',
      assigneeId: null,
      actorId: owner.id,
    });
    expect(unassigned.updated.map((i) => [i.id, i.assigneeId, i.assignee])).toEqual([
      [a, null, null],
      [c, null, null],
    ]);
    expect(unassigned.changedIds).toEqual([a, c]);
    expect((await rawRow(b, orgA)).assignee_id).toBe(member.id);
  });

  it('bulk assign rejects a non-member before writing', async () => {
    const { orgA, owner, member, other } = await setup();
    const a = (await insertIncident({ organizationId: orgA, assigneeId: member.id })).id;
    const b = (await insertIncident({ organizationId: orgA })).id;

    await expect(
      incidentsService.bulk({
        organizationId: orgA,
        ids: [a, b],
        action: 'assign',
        assigneeId: other.user.id,
        actorId: owner.id,
      })
    ).rejects.toMatchObject({ code: 'invalid_assignee', statusCode: 400 });

    expect((await rawRow(a, orgA)).assignee_id).toBe(member.id);
    expect((await rawRow(b, orgA)).assignee_id).toBeNull();
    expect(await incidentsService.listHistory(a, orgA)).toEqual([]);
  });

  it('bulk history rows carry the actor', async () => {
    const { orgA, member } = await setup();
    const a = (await insertIncident({ organizationId: orgA })).id;
    const b = (await insertIncident({ organizationId: orgA, status: 'investigating' })).id;

    await incidentsService.bulk({ organizationId: orgA, ids: [a, b], action: 'resolve', actorId: member.id });
    await incidentsService.bulk({
      organizationId: orgA,
      ids: [a],
      action: 'assign',
      assigneeId: member.id,
      actorId: member.id,
    });

    const historyA = await incidentsService.listHistory(a, orgA);
    expect(historyA!.map((h) => [h.action, h.newValue, h.userId]).sort()).toEqual(
      [
        ['assignment_change', member.id, member.id],
        ['status_change', 'resolved', member.id],
      ].sort()
    );
    const historyB = await incidentsService.listHistory(b, orgA);
    expect(historyB).toHaveLength(1);
    expect(historyB![0]).toMatchObject({
      action: 'status_change',
      oldValue: 'investigating',
      newValue: 'resolved',
      userId: member.id,
      userName: member.name,
    });
  });

  it('bulk collapses duplicate ids', async () => {
    const { orgA, owner } = await setup();
    const a = (await insertIncident({ organizationId: orgA })).id;

    const r = await incidentsService.bulk({
      organizationId: orgA,
      ids: [a, a, a],
      action: 'acknowledge',
      actorId: owner.id,
    });
    expect(r.updated.map((i) => i.id)).toEqual([a]);
    expect(r.changedIds).toEqual([a]);
    expect(r.skipped).toEqual([]);
    expect(await incidentsService.listHistory(a, orgA)).toHaveLength(1);
  });

  it('addComment returns the comment with the author and touches updated_at', async () => {
    const { orgA, member } = await setup();
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const inc = await insertIncident({ organizationId: orgA, updatedAt: old });

    const comment = await incidentsService.addComment({
      incidentId: inc.id,
      organizationId: orgA,
      userId: member.id,
      comment: 'Looking into it',
    });

    expect(comment).toMatchObject({
      incidentId: inc.id,
      userId: member.id,
      comment: 'Looking into it',
      edited: false,
      userName: member.name,
      userEmail: member.email,
    });
    expect(comment!.id).toEqual(expect.any(String));

    const row = await rawRow(inc.id, orgA);
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(old.getTime() + 30 * 60 * 1000);
    expect(row.status).toBe('open');
    expect(await incidentsService.listHistory(inc.id, orgA)).toEqual([]);

    const comments = await incidentsService.listComments(inc.id, orgA);
    expect(comments!.map((c) => c.id)).toEqual([comment!.id]);
  });

  it('addComment returns null for an incident of another organization', async () => {
    const { orgA, orgB, owner } = await setup();
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const foreign = await insertIncident({ organizationId: orgB, updatedAt: old });

    expect(
      await incidentsService.addComment({ incidentId: foreign.id, organizationId: orgA, userId: owner.id, comment: 'x' })
    ).toBeNull();
    expect(
      await incidentsService.addComment({ incidentId: 'not-a-uuid', organizationId: orgA, userId: owner.id, comment: 'x' })
    ).toBeNull();

    const count = await db
      .selectFrom('incident_comments')
      .select(db.fn.countAll<number>().as('n'))
      .where('incident_id', '=', foreign.id)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(0);
    expect(new Date((await rawRow(foreign.id, orgB)).updated_at).getTime()).toBe(old.getTime());
  });
});
