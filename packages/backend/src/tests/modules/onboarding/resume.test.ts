import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { onboardingRoutes } from '../../../modules/onboarding/routes.js';
import { ONBOARDING_STEPS } from '../../../modules/onboarding/service.js';
import {
  createTestUser,
  createTestOrganization,
  createTestProject,
} from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

describe('onboarding resume state', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const user = await createTestUser({ email: `resume-${Date.now()}-${Math.random()}@example.com` });
    const org = await createTestOrganization({ ownerId: user.id });
    const project = await createTestProject({ organizationId: org.id, userId: user.id });
    const session = await createTestSession(user.id);
    return { user, org, project, token: session.token };
  }

  const get = (token: string) =>
    app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: { Authorization: `Bearer ${token}` } });
  const put = (token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/v1/onboarding', headers: { Authorization: `Bearer ${token}` }, payload });

  it('defaults to null step, org and project', async () => {
    const { token } = await setup();
    const body = (await get(token)).json();
    expect(body.step).toBeNull();
    expect(body.organizationId).toBeNull();
    expect(body.projectId).toBeNull();
  });

  it('persists step, organizationId and projectId and keeps tutorialStep coherent', async () => {
    const { token, org, project } = await setup();
    const res = await put(token, { step: 'connect', organizationId: org.id, projectId: project.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      step: 'connect',
      organizationId: org.id,
      projectId: project.id,
      tutorialStep: ONBOARDING_STEPS.indexOf('connect'),
    });
    const again = (await get(token)).json();
    expect(again).toMatchObject({ step: 'connect', organizationId: org.id, projectId: project.id });
  });

  it('rejects an organization the user is not a member of with 404 and stores nothing', async () => {
    const { token } = await setup();
    const foreign = await createTestOrganization();
    const res = await put(token, { step: 'workspace', organizationId: foreign.id });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Organization or project not found' });
    const state = (await get(token)).json();
    expect(state.organizationId).toBeNull();
    expect(state.step).toBeNull();
  });

  it("rejects a projectId from another organization even when the user belongs to both", async () => {
    const { user, token, org } = await setup();
    const other = await createTestOrganization({ ownerId: user.id });
    const otherProject = await createTestProject({ organizationId: other.id, userId: user.id });

    const res = await put(token, { organizationId: org.id, projectId: otherProject.id });
    expect(res.statusCode).toBe(404);
    const state = (await get(token)).json();
    expect(state.organizationId).toBeNull();
    expect(state.projectId).toBeNull();
  });

  it('validates projectId against the stored organization when only projectId is sent', async () => {
    const { user, token, org, project } = await setup();
    const other = await createTestOrganization({ ownerId: user.id });
    const otherProject = await createTestProject({ organizationId: other.id, userId: user.id });

    // No stored organization yet: a project alone has nothing to be checked against.
    expect((await put(token, { projectId: project.id })).statusCode).toBe(404);

    await put(token, { organizationId: org.id });
    expect((await put(token, { projectId: otherProject.id })).statusCode).toBe(404);
    expect((await put(token, { projectId: project.id })).statusCode).toBe(200);
    expect((await get(token)).json().projectId).toBe(project.id);
  });

  it('returns a null project after it is soft-deleted', async () => {
    const { token, org, project } = await setup();
    await put(token, { step: 'connect', organizationId: org.id, projectId: project.id });
    await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', project.id).execute();

    const state = (await get(token)).json();
    expect(state.projectId).toBeNull();
    expect(state.organizationId).toBe(org.id);
  });

  it('returns null org and project after membership is removed', async () => {
    const { user, token, org, project } = await setup();
    await put(token, { step: 'connect', organizationId: org.id, projectId: project.id });
    await db
      .deleteFrom('organization_members')
      .where('organization_id', '=', org.id)
      .where('user_id', '=', user.id)
      .execute();

    const state = (await get(token)).json();
    expect(state.organizationId).toBeNull();
    expect(state.projectId).toBeNull();
  });

  it('rejects an unknown step with 400', async () => {
    const { token } = await setup();
    const res = await put(token, { step: 'tour' });
    expect(res.statusCode).toBe(400);
  });

  it('null clears a stored value', async () => {
    const { token, org, project } = await setup();
    await put(token, { step: 'connect', organizationId: org.id, projectId: project.id });
    const res = await put(token, { step: null, projectId: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ step: null, projectId: null, organizationId: org.id });
  });

  it('clears the project when the organization changes and no project is sent', async () => {
    const { user, token, org, project } = await setup();
    await put(token, { organizationId: org.id, projectId: project.id });
    const other = await createTestOrganization({ ownerId: user.id });
    const res = await put(token, { organizationId: other.id });
    expect(res.json()).toMatchObject({ organizationId: other.id, projectId: null });
  });

  it('reset clears step, org and project', async () => {
    const { token, org, project } = await setup();
    await put(token, { step: 'done', organizationId: org.id, projectId: project.id });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/reset',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ step: null, organizationId: null, projectId: null });
  });

  it("one user's stored ids never leak to another user", async () => {
    const a = await setup();
    const b = await setup();
    await put(a.token, { organizationId: a.org.id, projectId: a.project.id });
    const state = (await get(b.token)).json();
    expect(state.organizationId).toBeNull();
    expect(state.projectId).toBeNull();
  });
});
