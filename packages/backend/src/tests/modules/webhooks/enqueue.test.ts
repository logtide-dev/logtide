import { describe, it, expect, vi, beforeEach } from 'vitest';

const { addMock, createDeliveryMock, findInFlightMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  createDeliveryMock: vi.fn(),
  findInFlightMock: vi.fn(),
}));

vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({ add: addMock, close: vi.fn() })),
}));

vi.mock('../../../modules/webhooks/service.js', () => ({
  webhookDeliveryService: {
    createDelivery: createDeliveryMock,
    findInFlightDelivery: findInFlightMock,
  },
}));

vi.mock('../../../config/index.js', () => ({
  config: { WEBHOOK_MAX_ATTEMPTS: 5, WEBHOOK_DEDUP_WINDOW_MS: 60000 },
}));

import { webhookDispatcher } from '../../../modules/webhooks/dispatcher.js';

beforeEach(() => {
  addMock.mockReset().mockResolvedValue({ id: 'job-1' });
  createDeliveryMock.mockReset().mockResolvedValue({ id: 'del-1' });
  findInFlightMock.mockReset().mockResolvedValue(undefined);
});

describe('webhookDispatcher.enqueue', () => {
  it('persists a delivery and enqueues a job keyed by the delivery row', async () => {
    await webhookDispatcher.enqueue({
      url: 'https://e.com/hook', payload: { a: 1 }, organizationId: 'org-1', eventType: 'alert', eventId: 'evt-9',
    });
    expect(createDeliveryMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', eventType: 'alert', eventId: 'evt-9', url: 'https://e.com/hook', maxAttempts: 5,
    }));
    const [, jobData, opts] = addMock.mock.calls[0];
    expect(jobData).toEqual({ deliveryId: 'del-1' });
    // Unique per row: the queue must never be the thing that decides whether a
    // legitimate delivery runs. It contains no ':' (BullMQ forbids it in job ids).
    expect(opts.jobKey).toBe('webhook-del-1');
    expect(opts.jobKey).not.toContain(':');
  });

  it('does not let a completed job id linger in the backend', async () => {
    await webhookDispatcher.enqueue({
      url: 'https://e.com/hook', payload: { a: 1 }, organizationId: 'org-1', eventType: 'alert', eventId: 'evt-9',
    });
    const [, , opts] = addMock.mock.calls[0];
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it('looks up an in-flight duplicate inside the configured window', async () => {
    const before = Date.now();
    await webhookDispatcher.enqueue({
      url: 'https://e.com/hook', payload: { a: 1 }, organizationId: 'org-1', eventType: 'alert', eventId: 'evt-9',
    });
    const [lookup] = findInFlightMock.mock.calls[0];
    expect(lookup).toMatchObject({ organizationId: 'org-1', eventType: 'alert', eventId: 'evt-9' });
    const sinceMs = (lookup.since as Date).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - 60000 - 1000);
    expect(sinceMs).toBeLessThanOrEqual(before - 60000 + 1000);
  });

  it('reuses an in-flight delivery instead of creating a second one', async () => {
    findInFlightMock.mockResolvedValue({ id: 'del-existing' });
    const result = await webhookDispatcher.enqueue({
      url: 'https://e.com/hook', payload: { a: 1 }, organizationId: 'org-1', eventType: 'alert', eventId: 'evt-9',
    });
    expect(result).toEqual({ deliveryId: 'del-existing' });
    expect(createDeliveryMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('enqueues again once the previous delivery is no longer in flight', async () => {
    // Regression for the stuck-pending bug: a repeated event (same monitor, same
    // status, same url) must produce a new delivery once the earlier one is
    // terminal or outside the window, which is what the lookup returning
    // undefined represents.
    createDeliveryMock.mockResolvedValueOnce({ id: 'del-1' }).mockResolvedValueOnce({ id: 'del-2' });
    const args = {
      url: 'https://discord.com/api/webhooks/1/t',
      payload: { a: 1 },
      organizationId: 'org-1',
      eventType: 'monitor.status_changed',
      eventId: 'mon-1:down:https://discord.com/api/webhooks/1/t',
    };
    await webhookDispatcher.enqueue(args);
    await webhookDispatcher.enqueue(args);
    expect(createDeliveryMock).toHaveBeenCalledTimes(2);
    expect(addMock).toHaveBeenCalledTimes(2);
    expect(addMock.mock.calls[0][2].jobKey).toBe('webhook-del-1');
    expect(addMock.mock.calls[1][2].jobKey).toBe('webhook-del-2');
  });

  it('derives a stable eventId when none is given', async () => {
    await webhookDispatcher.enqueue({ url: 'https://e.com', payload: { a: 1 }, organizationId: 'o', eventType: 'alert' });
    const firstId = createDeliveryMock.mock.calls[0][0].eventId;
    createDeliveryMock.mockClear();
    await webhookDispatcher.enqueue({ url: 'https://e.com', payload: { a: 1 }, organizationId: 'o', eventType: 'alert' });
    expect(createDeliveryMock.mock.calls[0][0].eventId).toBe(firstId);
  });

  it('uses payload.id as eventId when it starts with evt_ and no explicit eventId', async () => {
    const envelopeId = 'evt_a1b2c3d4-0000-0000-0000-000000000001';
    await webhookDispatcher.enqueue({
      url: 'https://e.com/hook',
      payload: { id: envelopeId, type: 'alert.triggered', version: 1 },
      organizationId: 'org-1',
      eventType: 'alert.triggered',
    });
    expect(createDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: envelopeId })
    );
  });

  it('envelopes with different ids are never treated as the same event', async () => {
    const args1 = {
      url: 'https://e.com/hook',
      payload: { id: 'evt_aaaaaaaa-0000-0000-0000-000000000001', type: 'alert.triggered', version: 1 },
      organizationId: 'org-1',
      eventType: 'alert.triggered',
    };
    const args2 = {
      ...args1,
      payload: { id: 'evt_bbbbbbbb-0000-0000-0000-000000000002', type: 'alert.triggered', version: 1 },
    };
    await webhookDispatcher.enqueue(args1);
    await webhookDispatcher.enqueue(args2);
    expect(findInFlightMock.mock.calls[0][0].eventId).not.toBe(findInFlightMock.mock.calls[1][0].eventId);
  });

  it('falls back to hash when payload.id exists but does not start with evt_', async () => {
    await webhookDispatcher.enqueue({
      url: 'https://e.com/hook',
      payload: { id: 'not-an-envelope-id' },
      organizationId: 'org-1',
      eventType: 'alert',
    });
    // eventId in the createDelivery call should be the hash (32 hex chars), not the plain id
    const call = createDeliveryMock.mock.calls[0][0];
    expect(call.eventId).toMatch(/^[0-9a-f]{32}$/);
    expect(call.eventId).not.toBe('not-an-envelope-id');
  });
});
