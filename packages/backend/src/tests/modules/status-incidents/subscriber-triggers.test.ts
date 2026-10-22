import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createTestContext, createTestSession } from '../../helpers/index.js';

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('../../../queue/jobs/monitor-status-subscribers.js', () => ({
  enqueueStatusSubscriberNotification: enqueue,
}));

import { statusIncidentRoutes } from '../../../modules/status-incidents/routes.js';
import { statusIncidentService } from '../../../modules/status-incidents/service.js';

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = Fastify();
  await app.register(statusIncidentRoutes, { prefix: '/api/v1/status-incidents' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  enqueue.mockReset().mockResolvedValue(undefined);
  ctx = await createTestContext();
  token = (await createTestSession(ctx.user.id)).token;
});

async function create(extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/status-incidents',
    headers: auth(),
    payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, title: 'DB slow', ...extra },
  });
}

describe('status updates enqueue subscriber notifications', () => {
  it('create enqueues incident_created with title, status and message', async () => {
    const res = await create({ message: 'Looking into it', severity: 'major' });
    expect(res.statusCode).toBe(201);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toEqual({
      kind: 'incident_created',
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      title: 'DB slow',
      status: 'investigating',
      message: 'Looking into it',
    });
  });

  it('add-update enqueues incident_updated, a resolved update enqueues incident_resolved', async () => {
    const id = (await create()).json().incident.id;
    enqueue.mockClear();
    const url = `/api/v1/status-incidents/${id}/updates?organizationId=${ctx.organization.id}`;

    await app.inject({ method: 'POST', url, headers: auth(), payload: { status: 'identified', message: 'Found it' } });
    expect(enqueue.mock.calls[0][0]).toMatchObject({ kind: 'incident_updated', status: 'identified', message: 'Found it', title: 'DB slow' });

    await app.inject({ method: 'POST', url, headers: auth(), payload: { status: 'resolved', message: 'Fixed' } });
    expect(enqueue.mock.calls[1][0]).toMatchObject({ kind: 'incident_resolved', status: 'resolved', message: 'Fixed' });
  });

  it('PUT to resolved enqueues once, repeated saves do not', async () => {
    const id = (await create()).json().incident.id;
    enqueue.mockClear();
    const url = `/api/v1/status-incidents/${id}?organizationId=${ctx.organization.id}`;
    await app.inject({ method: 'PUT', url, headers: auth(), payload: { status: 'resolved' } });
    await app.inject({ method: 'PUT', url, headers: auth(), payload: { status: 'resolved' } });
    await app.inject({ method: 'PUT', url, headers: auth(), payload: { title: 'Renamed' } });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({ kind: 'incident_resolved' });
  });

  it('a rejected create does not enqueue', async () => {
    const res = await create({ monitorIds: ['00000000-0000-4000-8000-000000000001'] });
    expect(res.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('a failing lookup or enqueue never fails the request', async () => {
    enqueue.mockRejectedValue(new Error('queue down'));
    const res = await create();
    expect(res.statusCode).toBe(201);

    enqueue.mockReset();
    const spy = vi.spyOn(statusIncidentService, 'getById').mockRejectedValue(new Error('db blip'));
    const res2 = await create();
    spy.mockRestore();
    expect(res2.statusCode).toBe(201);
  });
});
