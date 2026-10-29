import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';
import { addOrgMember, insertIncident } from './fixtures.js';

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return createTestUser({ email: `write-${seq}-${Date.now()}@example.com`, name });
}

async function setup() {
  const ctx = await createTestContext();
  const orgId = ctx.organization.id;
  const owner = ctx.user;
  const member = await newUser('Member');
  await addOrgMember(orgId, member.id);
  return { ...ctx, orgId, owner, member };
}

async function rawRow(id: string, orgId: string) {
  return db
    .selectFrom('incidents')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirstOrThrow();
}

describe('IncidentsService write side', () => {
  it('update records the acting user in history, not the assignee', async () => {
    const { orgId, owner, member } = await setup();
    const inc = await insertIncident({ organizationId: orgId, assigneeId: member.id });

    const updated = await incidentsService.update(inc.id, orgId, { status: 'resolved' }, owner.id);
    expect(updated).toMatchObject({ id: inc.id, status: 'resolved', resolvedBy: owner.id });
    expect(updated!.assignee).toMatchObject({ id: member.id });

    const h = await incidentsService.listHistory(inc.id, orgId);
    expect(h).toHaveLength(1);
    expect(h![0]).toMatchObject({ action: 'status_change', userId: owner.id, newValue: 'resolved', userName: owner.name });
  });

  it('update to investigating sets acknowledgedAt and acknowledgedBy', async () => {
    const { orgId, member } = await setup();
    const inc = await insertIncident({ organizationId: orgId });
    const before = Date.now();

    const updated = await incidentsService.update(inc.id, orgId, { status: 'investigating' }, member.id);
    expect(updated).toMatchObject({ status: 'investigating', acknowledgedBy: member.id });
    expect(Math.abs(new Date(updated!.acknowledgedAt!).getTime() - before)).toBeLessThan(5000);
  });

  it('update to resolved sets resolvedBy and reopen clears it', async () => {
    const { orgId, owner } = await setup();
    const inc = await insertIncident({ organizationId: orgId });

    const resolved = await incidentsService.update(inc.id, orgId, { status: 'resolved' }, owner.id);
    expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: owner.id });
    expect(resolved!.resolvedAt).not.toBeNull();

    const reopened = await incidentsService.update(inc.id, orgId, { status: 'open' }, owner.id);
    expect(reopened).toMatchObject({ status: 'open', resolvedBy: null, resolvedAt: null, acknowledgedBy: null });
  });

  it('update rejects false positive on an alert incident', async () => {
    const { orgId, owner } = await setup();
    const alertInc = await insertIncident({ organizationId: orgId, source: 'alert' });

    await expect(
      incidentsService.update(alertInc.id, orgId, { status: 'false_positive', title: 'changed' }, owner.id)
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      statusCode: 409,
      message: 'False positive applies to security incidents only',
    });
    const row = await rawRow(alertInc.id, orgId);
    expect(row).toMatchObject({ status: 'open', title: alertInc.title });
  });

  it('update accepts false positive on a security incident', async () => {
    const { orgId, owner } = await setup();
    const inc = await insertIncident({ organizationId: orgId, source: 'sigma' });
    const updated = await incidentsService.update(inc.id, orgId, { status: 'false_positive' }, owner.id);
    expect(updated).toMatchObject({ status: 'false_positive', resolvedBy: owner.id });
  });

  it('update rejects an assignee outside the organization', async () => {
    const { orgId, owner } = await setup();
    const other = await createTestContext();
    const inc = await insertIncident({ organizationId: orgId });

    await expect(
      incidentsService.update(inc.id, orgId, { assigneeId: other.user.id }, owner.id)
    ).rejects.toMatchObject({
      code: 'invalid_assignee',
      statusCode: 400,
      message: 'Assignee is not a member of this organization',
    });
    await expect(
      incidentsService.update(inc.id, orgId, { assigneeId: 'not-a-uuid' }, owner.id)
    ).rejects.toMatchObject({ code: 'invalid_assignee' });
    expect((await rawRow(inc.id, orgId)).assignee_id).toBeNull();
  });

  it('update with assigneeId null unassigns and records an assignment_change history row', async () => {
    const { orgId, owner, member } = await setup();
    const inc = await insertIncident({ organizationId: orgId, assigneeId: member.id });

    const updated = await incidentsService.update(inc.id, orgId, { assigneeId: null }, owner.id);
    expect(updated).toMatchObject({ assigneeId: null, assignee: null });

    const h = await incidentsService.listHistory(inc.id, orgId);
    expect(h![0]).toMatchObject({
      action: 'assignment_change',
      fieldName: 'assignee_id',
      oldValue: member.id,
      newValue: null,
      userId: owner.id,
    });
  });

  it('update changes title, description and severity', async () => {
    const { orgId, owner } = await setup();
    const inc = await insertIncident({ organizationId: orgId, severity: 'low' });
    const updated = await incidentsService.update(
      inc.id,
      orgId,
      { title: 'New title', description: 'More context', severity: 'critical' },
      owner.id
    );
    expect(updated).toMatchObject({ title: 'New title', description: 'More context', severity: 'critical' });
    const h = await incidentsService.listHistory(inc.id, orgId);
    expect(h!.map((r) => r.action)).toEqual(['severity_change']);
  });

  it('update returns null for another org incident and changes nothing', async () => {
    const { orgId, owner } = await setup();
    const other = await createTestContext();
    const foreign = await insertIncident({ organizationId: other.organization.id, title: 'foreign' });

    expect(await incidentsService.update(foreign.id, orgId, { status: 'resolved', title: 'x' }, owner.id)).toBeNull();
    expect(await incidentsService.update(crypto.randomUUID(), orgId, { status: 'resolved' }, owner.id)).toBeNull();
    const row = await rawRow(foreign.id, other.organization.id);
    expect(row).toMatchObject({ status: 'open', title: 'foreign' });
  });

  it('acknowledge moves open to investigating once and is idempotent', async () => {
    const { orgId, member } = await setup();
    const inc = await insertIncident({ organizationId: orgId });

    const first = await incidentsService.acknowledge(inc.id, orgId, member.id);
    expect(first).toMatchObject({ status: 'investigating', acknowledgedBy: member.id });
    expect(first!.acknowledgedAt).not.toBeNull();

    const second = await incidentsService.acknowledge(inc.id, orgId, member.id);
    expect(second).toMatchObject({ status: 'investigating', acknowledgedBy: member.id });
    expect(new Date(second!.acknowledgedAt!).getTime()).toBe(new Date(first!.acknowledgedAt!).getTime());

    const h = await incidentsService.listHistory(inc.id, orgId);
    expect(h).toHaveLength(1);
    expect(h![0]).toMatchObject({ action: 'status_change', newValue: 'investigating', userId: member.id });
  });

  it('acknowledge refuses a resolved incident', async () => {
    const { orgId, member } = await setup();
    const resolved = await insertIncident({ organizationId: orgId, status: 'resolved' });
    const falsePositive = await insertIncident({ organizationId: orgId, status: 'false_positive' });

    for (const inc of [resolved, falsePositive]) {
      await expect(incidentsService.acknowledge(inc.id, orgId, member.id)).rejects.toMatchObject({
        code: 'invalid_transition',
        statusCode: 409,
        message: 'Only open incidents can be acknowledged',
      });
    }
  });

  it('acknowledge returns null for another org incident', async () => {
    const { orgId, member } = await setup();
    const other = await createTestContext();
    const foreign = await insertIncident({ organizationId: other.organization.id });
    expect(await incidentsService.acknowledge(foreign.id, orgId, member.id)).toBeNull();
    expect((await rawRow(foreign.id, other.organization.id)).status).toBe('open');
  });

  it('a later update without an actor records a null user', async () => {
    const { orgId, owner } = await setup();
    const inc = await insertIncident({ organizationId: orgId });

    await incidentsService.update(inc.id, orgId, { status: 'investigating' }, owner.id);
    await incidentsService.update(inc.id, orgId, { status: 'resolved' }, null);

    const h = await incidentsService.listHistory(inc.id, orgId);
    const byValue = Object.fromEntries(h!.map((r) => [r.newValue, r.userId]));
    expect(byValue).toEqual({ investigating: owner.id, resolved: null });
  });

  it('assertAssignableUser accepts members and rejects everyone else', async () => {
    const { orgId, member } = await setup();
    const outsider = await newUser('Outsider');
    await expect(incidentsService.assertAssignableUser(orgId, member.id)).resolves.toBeUndefined();
    await expect(incidentsService.assertAssignableUser(orgId, outsider.id)).rejects.toMatchObject({
      code: 'invalid_assignee',
    });
  });
});
