import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createTestContext, createTestSession } from '../../helpers/index.js';

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('../../../queue/jobs/monitor-status-subscribers.js', () => ({
  enqueueStatusSubscriberNotification: enqueue,
}));

import { maintenanceRoutes } from '../../../modules/maintenances/routes.js';

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let token: string;

beforeAll(async () => {
  app = Fastify();
  await app.register(maintenanceRoutes, { prefix: '/api/v1/maintenances' });
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

describe('maintenance create enqueues a subscriber notification', () => {
  const start = new Date(Date.now() + 3600_000).toISOString();
  const end = new Date(Date.now() + 7200_000).toISOString();

  it('enqueues maintenance_scheduled with the window and description', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'DB upgrade',
        description: 'Read-only for 30 minutes',
        scheduledStart: start,
        scheduledEnd: end,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toEqual({
      kind: 'maintenance_scheduled',
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      title: 'DB upgrade',
      message: 'Read-only for 30 minutes',
      scheduledStart: start,
      scheduledEnd: end,
    });
  });

  it('does not enqueue when validation fails', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Bad window',
        scheduledStart: end,
        scheduledEnd: start,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
