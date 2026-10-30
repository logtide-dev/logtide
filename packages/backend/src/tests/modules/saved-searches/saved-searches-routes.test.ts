import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { createTestContext, createTestSession, createTestUser } from '../../helpers/index.js';

// Saved searches API on the real app: visibility, permissions, validation, audit.

type Role = 'owner' | 'admin' | 'member';

interface Actor {
  id: string;
  name: string;
  token: string;
}

const BASE = '/api/v1/saved-searches';

const baseState = { q: 'level:error timeout', projectIds: [] as string[], range: '24h' };

describe('Saved searches API', () => {
  let app: FastifyInstance;
  let orgId: string;
  let projectId: string;
  let apiKey: string;
  let owner: Actor;
  let admin: Actor;
  let memberA: Actor;
  let memberB: Actor;

  async function addMember(organizationId: string, role: Role, name: string): Promise<Actor> {
    const user = await createTestUser({ email: `${role}-${crypto.randomUUID()}@example.com`, name });
    await db
      .insertInto('organization_members')
      .values({ user_id: user.id, organization_id: organizationId, role })
      .execute();
    const session = await createTestSession(user.id);
    return { id: user.id, name, token: session.token };
  }

  function as(actor: Actor) {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${actor.token}`);
    return {
      list: (organizationId: string | null = orgId) =>
        auth(request(app.server).get(BASE).query(organizationId ? { organizationId } : {})),
      create: (body: Record<string, unknown>) =>
        auth(request(app.server).post(BASE)).send({ organizationId: orgId, ...body }),
      patch: (id: string, body: Record<string, unknown>, organizationId: string | null = orgId) =>
        auth(request(app.server).patch(`${BASE}/${id}`).query(organizationId ? { organizationId } : {})).send(body),
      remove: (id: string, organizationId: string | null = orgId) =>
        auth(request(app.server).delete(`${BASE}/${id}`).query(organizationId ? { organizationId } : {})),
    };
  }

  async function createAs(actor: Actor, name: string, visibility: 'private' | 'organization' = 'private') {
    const res = await as(actor).create({ name, visibility, state: baseState });
    expect(res.status).toBe(201);
    return res.body.savedSearch as { id: string; name: string; visibility: string; canEdit: boolean };
  }

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    apiKey = ctx.apiKey.plainKey;
    const ownerSession = await createTestSession(ctx.user.id);
    owner = { id: ctx.user.id, name: ctx.user.name, token: ownerSession.token };
    admin = await addMember(orgId, 'admin', 'Ada Admin');
    memberA = await addMember(orgId, 'member', 'Alice Member');
    memberB = await addMember(orgId, 'member', 'Bob Member');
  });

  it('creates a private saved search', async () => {
    const state = { ...baseState, projectIds: [projectId], view: 'table', columns: ['region'] };
    const res = await as(memberA).create({ name: '  Checkout errors  ', state });

    expect(res.status).toBe(201);
    const s = res.body.savedSearch;
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.organizationId).toBe(orgId);
    expect(s.name).toBe('Checkout errors');
    expect(s.visibility).toBe('private');
    expect(s.canEdit).toBe(true);
    expect(s.createdBy).toBe(memberA.id);
    expect(s.createdByName).toBe('Alice Member');
    expect(s.state).toEqual(state);
    expect(new Date(s.createdAt).toISOString()).toBe(s.createdAt);
    expect(new Date(s.updatedAt).toISOString()).toBe(s.updatedAt);
  });

  it('rejects an invalid query with position', async () => {
    const res = await as(memberA).create({ name: 'Broken', state: { ...baseState, q: '(oops' } });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(Number.isInteger(res.body.position)).toBe(true);
  });

  it('rejects an invalid query on update with position', async () => {
    const s = await createAs(memberA, 'Fine');
    const res = await as(memberA).patch(s.id, { state: { ...baseState, q: 'level:loud' } });

    expect(res.status).toBe(400);
    expect(Number.isInteger(res.body.position)).toBe(true);
  });

  it('rejects projects from another organization', async () => {
    const other = await createTestContext();
    const res = await as(memberA).create({
      name: 'Foreign',
      state: { ...baseState, projectIds: [projectId, other.project.id] },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Some projects do not belong to this organization');

    const s = await createAs(memberA, 'Mine');
    const patch = await as(memberA).patch(s.id, { state: { ...baseState, projectIds: [other.project.id] } });
    expect(patch.status).toBe(400);
    expect(patch.body.error).toBe('Some projects do not belong to this organization');
  });

  it('rejects an invalid body with validation details', async () => {
    const res = await as(memberA).create({ name: '', state: baseState });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('lists own private and organization searches only', async () => {
    await createAs(memberA, 'beta private of A');
    await createAs(memberB, 'B private');
    await createAs(memberB, 'Alpha shared by B', 'organization');

    const res = await as(memberA).list();

    expect(res.status).toBe(200);
    expect(res.body.savedSearches.map((s: { name: string }) => s.name)).toEqual([
      'Alpha shared by B',
      'beta private of A',
    ]);
  });

  it('marks canEdit for admins on organization searches', async () => {
    await createAs(memberB, 'Shared', 'organization');

    const asAdmin = await as(admin).list();
    const asOwner = await as(owner).list();
    const asMemberA = await as(memberA).list();

    expect(asAdmin.body.savedSearches).toHaveLength(1);
    expect(asAdmin.body.savedSearches[0].canEdit).toBe(true);
    expect(asOwner.body.savedSearches[0].canEdit).toBe(true);
    expect(asMemberA.body.savedSearches[0].canEdit).toBe(false);
  });

  it('lets the creator rename and change visibility', async () => {
    const s = await createAs(memberA, 'Old name');

    const renamed = await as(memberA).patch(s.id, { name: 'New name' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.savedSearch.name).toBe('New name');

    const shared = await as(memberA).patch(s.id, { visibility: 'organization' });
    expect(shared.status).toBe(200);
    expect(shared.body.savedSearch.visibility).toBe('organization');
    expect(shared.body.savedSearch.canEdit).toBe(true);
  });

  it('replaces the state as a whole on update', async () => {
    const s = await createAs(memberA, 'Stateful');
    const next = { q: 'service:api', projectIds: [projectId] };

    const res = await as(memberA).patch(s.id, { state: next });

    expect(res.status).toBe(200);
    expect(res.body.savedSearch.state).toEqual(next);
  });

  it('lets an admin rename an organization search but not change its visibility', async () => {
    const s = await createAs(memberB, 'Team search', 'organization');

    const renamed = await as(admin).patch(s.id, { name: 'Team search (renamed)' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.savedSearch.name).toBe('Team search (renamed)');
    expect(renamed.body.savedSearch.createdBy).toBe(memberB.id);

    const state = await as(owner).patch(s.id, { state: { ...baseState, q: 'timeout' } });
    expect(state.status).toBe(200);

    const hidden = await as(admin).patch(s.id, { visibility: 'private' });
    expect(hidden.status).toBe(403);
    expect(hidden.body.error).toBe('Only the creator can change visibility');
  });

  it("forbids a member from editing another member's organization search", async () => {
    const s = await createAs(memberB, 'Team search', 'organization');

    const res = await as(memberA).patch(s.id, { name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('You can only edit your own saved searches');

    const del = await as(memberA).remove(s.id);
    expect(del.status).toBe(403);
  });

  it("returns 404 for another member's private search", async () => {
    const s = await createAs(memberB, 'Secret');

    for (const actor of [memberA, admin, owner]) {
      const patch = await as(actor).patch(s.id, { name: 'Peek' });
      expect(patch.status).toBe(404);
      expect(patch.body.error).toBe('Saved search not found');
      const del = await as(actor).remove(s.id);
      expect(del.status).toBe(404);
    }

    const unknown = await as(memberA).patch(crypto.randomUUID(), { name: 'Ghost' });
    expect(unknown.status).toBe(404);
    const notUuid = await as(memberA).remove('not-a-uuid');
    expect(notUuid.status).toBe(404);
  });

  it('deletes as creator and as admin for organization searches', async () => {
    const mine = await createAs(memberA, 'Mine');
    const shared = await createAs(memberB, 'Shared', 'organization');

    const byCreator = await as(memberA).remove(mine.id);
    expect(byCreator.status).toBe(204);
    const byAdmin = await as(admin).remove(shared.id);
    expect(byAdmin.status).toBe(204);

    const rows = await db
      .selectFrom('saved_searches')
      .select('id')
      .where('organization_id', '=', orgId)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('rejects API key auth', async () => {
    const list = await request(app.server).get(BASE).query({ organizationId: orgId }).set('x-api-key', apiKey);
    expect(list.status).toBe(401);

    const create = await request(app.server)
      .post(BASE)
      .set('x-api-key', apiKey)
      .send({ organizationId: orgId, name: 'Key', state: baseState });
    expect(create.status).toBe(401);
  });

  it('returns 400 without organizationId', async () => {
    const s = await createAs(memberA, 'Mine');

    const list = await as(memberA).list(null);
    expect(list.status).toBe(400);
    expect(list.body.error).toBe('organizationId required');

    const create = await request(app.server)
      .post(BASE)
      .set('Authorization', `Bearer ${memberA.token}`)
      .send({ name: 'No org', state: baseState });
    expect(create.status).toBe(400);
    expect(create.body.error).toBe('organizationId required');

    const patch = await as(memberA).patch(s.id, { name: 'x' }, null);
    expect(patch.status).toBe(400);
    expect(patch.body.error).toBe('organizationId required');

    const del = await as(memberA).remove(s.id, null);
    expect(del.status).toBe(400);
    expect(del.body.error).toBe('organizationId required');
  });

  it('returns 403 for a user outside the organization', async () => {
    const outsider = await createTestContext();
    const outsiderSession = await createTestSession(outsider.user.id);
    const stranger: Actor = { id: outsider.user.id, name: outsider.user.name, token: outsiderSession.token };

    const list = await as(stranger).list();
    expect(list.status).toBe(403);
    expect(list.body.error).toBe('Forbidden');

    const create = await as(stranger).create({ name: 'Intruder', state: baseState });
    expect(create.status).toBe(403);
  });

  it('writes audit rows', async () => {
    const s = await createAs(memberA, 'Audited', 'organization');
    await as(memberA).patch(s.id, { name: 'Audited again' }).expect(200);
    await as(memberA).remove(s.id).expect(204);

    const rows = await db
      .selectFrom('audit_log')
      .select(['action', 'resource_type', 'resource_id', 'metadata', 'user_id'])
      .where('organization_id', '=', orgId)
      .where('resource_type', '=', 'saved_search')
      .orderBy('time', 'asc')
      .execute();

    expect(rows.map((r) => r.action)).toEqual(['search.created', 'search.updated', 'search.deleted']);
    for (const row of rows) {
      expect(row.resource_id).toBe(s.id);
      expect(row.user_id).toBe(memberA.id);
    }
    expect(rows[0].metadata).toEqual({ name: 'Audited', visibility: 'organization' });
    expect(rows[1].metadata).toEqual({ name: 'Audited again', visibility: 'organization' });
  });
});
