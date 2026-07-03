import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { contextPlugin } from '../../../context/index.js';
import { receiversIngestRoutes } from '../../../modules/receivers/ingest-routes.js';
import { receiversService } from '../../../modules/receivers/service.js';
import { processReceiverEvent } from '../../../queue/jobs/receiver-event.js';
import type { IJob } from '../../../queue/abstractions/types.js';
import type { ReceiverEventJobData } from '../../../queue/jobs/receiver-event.js';
import { createTestContext } from '../../helpers/factories.js';

function fakeJob(eventId: string): IJob<ReceiverEventJobData> {
  return { id: 'test-job', name: 'process', data: { eventId } } as IJob<ReceiverEventJobData>;
}

describe('receiver ingest endpoint', () => {
  let app: FastifyInstance;
  let projectId: string;
  let receiverId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(receiversIngestRoutes, { prefix: '/api/v1/receivers' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('receiver_events').execute();
    await db.deleteFrom('receivers').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();
    const ctx = await createTestContext();
    projectId = ctx.project.id;
    const created = await receiversService.createReceiver({
      projectId,
      name: 'generic in',
      adapterType: 'generic',
    });
    receiverId = created.id;
    token = created.token;
  });

  it('accepts a valid payload with 202 and records a pending event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/${receiverId}/${token}`,
      payload: { msg: 'hello' },
    });
    expect(res.statusCode).toBe(202);
    const { eventId } = JSON.parse(res.body);
    const event = await receiversService.getEventWithReceiver(eventId);
    expect(event).not.toBeNull();
    expect(event!.status).toBe('pending');
  });

  it('rejects wrong tokens with 401 and unknown receivers with 404', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/${receiverId}/lr_${'0'.repeat(64)}`,
      payload: { a: 1 },
    });
    expect(bad.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/00000000-0000-4000-8000-000000000000/${token}`,
      payload: { a: 1 },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects disabled receivers with 403', async () => {
    await receiversService.updateReceiver(receiverId, projectId, { enabled: false });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/${receiverId}/${token}`,
      payload: { a: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects non-object payloads with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/${receiverId}/${token}`,
      payload: JSON.stringify([1, 2, 3]),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('processes an event end to end: logs are ingested, event marked processed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/${receiverId}/${token}`,
      payload: { msg: 'from external' },
    });
    const { eventId } = JSON.parse(res.body);

    await processReceiverEvent(fakeJob(eventId));

    const event = await receiversService.getEventWithReceiver(eventId);
    expect(event!.status).toBe('processed');

    const events = await receiversService.listEvents(receiverId, 10);
    expect(events[0].normalized).not.toBeNull();

    const receivers = await receiversService.listReceivers(projectId);
    expect(receivers[0].lastReceivedAt).not.toBeNull();
  });

  it('marks github ping events as skipped', async () => {
    const gh = await receiversService.createReceiver({
      projectId,
      name: 'gh',
      adapterType: 'github',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/${gh.id}/${gh.token}`,
      payload: { zen: 'Design for failure.', hook_id: 1 },
    });
    const { eventId } = JSON.parse(res.body);
    await processReceiverEvent(fakeJob(eventId));
    const event = await receiversService.getEventWithReceiver(eventId);
    expect(event!.status).toBe('skipped');
  });

  it('is idempotent: reprocessing a non-pending event is a no-op', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/receivers/${receiverId}/${token}`,
      payload: { msg: 'x' },
    });
    const { eventId } = JSON.parse(res.body);
    await processReceiverEvent(fakeJob(eventId));
    await processReceiverEvent(fakeJob(eventId)); // must not throw or double-ingest
    const event = await receiversService.getEventWithReceiver(eventId);
    expect(event!.status).toBe('processed');
  });
});
