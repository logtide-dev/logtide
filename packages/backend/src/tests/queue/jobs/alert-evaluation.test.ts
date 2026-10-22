import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type {
  AlertNotificationJobData,
  AlertResolvedNotificationData,
  AlertTriggeredResult,
} from '../../../modules/alerts/types.js';

const bullAdd = vi.hoisted(() => vi.fn());
const quickAddJob = vi.hoisted(() => vi.fn());

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: bullAdd, close: vi.fn().mockResolvedValue(undefined) };
  }),
  Worker: vi.fn(),
}));

vi.mock('graphile-worker', () => ({
  quickAddJob,
  parseCronItems: vi.fn(),
  run: vi.fn(),
}));

import {
  alertNotificationJobKey,
  enqueueAlertNotifications,
} from '../../../queue/jobs/alert-evaluation.js';
import { BullMQQueueAdapter } from '../../../queue/adapters/bullmq-adapter.js';
import { GraphileQueueAdapter } from '../../../queue/adapters/graphile-adapter.js';

const RULE_ID = '6f1c9a52-3b0e-4d43-9a8e-2f6b1c0d7e11';
const ORG_ID = '0b5e7c1a-9d2f-4e3b-8a6c-1d2e3f4a5b6c';
const PROJECT_ID = 'a3d9e8f7-6c5b-4a39-8271-605f4e3d2c1b';
const INCIDENT_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const FIRING_SINCE = '2026-10-22T10:00:00.000Z';

const triggered: AlertTriggeredResult = {
  kind: 'triggered',
  historyId: '9e8d7c6b-5a49-4382-b716-05f4e3d2c1b0',
  rule_id: RULE_ID,
  rule_name: 'High error rate',
  organization_id: ORG_ID,
  project_id: PROJECT_ID,
  log_count: 12,
  threshold: 10,
  time_window: 5,
  email_recipients: [],
  webhook_url: null,
  firing_since: FIRING_SINCE,
  incident_id: INCIDENT_ID,
};

const renotify: AlertTriggeredResult = {
  ...triggered,
  kind: 'renotify',
  historyId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
};

const resolved: AlertResolvedNotificationData = {
  kind: 'resolved',
  rule_id: RULE_ID,
  rule_name: 'High error rate',
  organization_id: ORG_ID,
  project_id: PROJECT_ID,
  alert_type: 'threshold',
  log_count: 0,
  threshold: 10,
  time_window: 5,
  firing_since: FIRING_SINCE,
  resolved_at: '2026-10-22T10:30:00.000Z',
  incident_id: INCIDENT_ID,
};

function fakeQueue() {
  const add = vi.fn(async (name: string, data: AlertNotificationJobData) => ({ id: '1', name, data }));
  return { add };
}

describe('alertNotificationJobKey', () => {
  it('job keys are stable, unique per notification and colon-free', () => {
    expect(alertNotificationJobKey(triggered)).toBe(`alert-notif-${triggered.historyId}`);
    expect(alertNotificationJobKey(resolved)).toBe(`alert-resolved-${resolved.rule_id}-${Date.parse(resolved.firing_since)}`);
    for (const r of [triggered, renotify, resolved]) {
      expect(alertNotificationJobKey(r)).toMatch(/^[A-Za-z0-9_-]+$/);
      // stable: same input, same key
      expect(alertNotificationJobKey(r)).toBe(alertNotificationJobKey({ ...r }));
    }
    const keys = [triggered, renotify, resolved].map(alertNotificationJobKey);
    expect(new Set(keys).size).toBe(3);
  });

  it('resolutions of two episodes of the same rule get different keys', () => {
    const later = { ...resolved, firing_since: '2026-10-22T11:00:00.000Z', resolved_at: '2026-10-22T11:10:00.000Z' };
    expect(alertNotificationJobKey(later)).not.toBe(alertNotificationJobKey(resolved));
  });

  it('the resolved key is the same whatever offset the firing time is written with', () => {
    const offset = { ...resolved, firing_since: '2026-10-22T12:00:00.000+02:00' };
    expect(alertNotificationJobKey(offset)).toBe(alertNotificationJobKey(resolved));
  });
});

describe('enqueueAlertNotifications', () => {
  it('enqueues with the job name of each kind', async () => {
    const queue = fakeQueue();
    const count = await enqueueAlertNotifications([triggered, renotify, resolved], queue);

    expect(count).toBe(3);
    expect(queue.add.mock.calls).toEqual([
      ['send-notification', triggered, { jobKey: alertNotificationJobKey(triggered) }],
      ['send-notification', renotify, { jobKey: alertNotificationJobKey(renotify) }],
      ['send-resolved', resolved, { jobKey: alertNotificationJobKey(resolved) }],
    ]);
  });

  it('passes only the job key, so the queue cleanup defaults stay', async () => {
    const queue = fakeQueue();
    await enqueueAlertNotifications([triggered], queue);
    expect(Object.keys(queue.add.mock.calls[0][2] as object)).toEqual(['jobKey']);
  });

  it('a failing add does not stop the remaining results', async () => {
    const queue = fakeQueue();
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const count = await enqueueAlertNotifications([triggered, resolved], queue);

    expect(count).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[1][0]).toBe('send-resolved');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('enqueues nothing for an empty run', async () => {
    const queue = fakeQueue();
    expect(await enqueueAlertNotifications([], queue)).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('queue adapters', () => {
  beforeEach(() => {
    bullAdd.mockReset();
    quickAddJob.mockReset();
  });

  it('the BullMQ adapter forwards the key as jobId', async () => {
    bullAdd.mockResolvedValue({ id: 'x', name: 'send-resolved', attemptsMade: 0, timestamp: Date.now() });
    const adapter = new BullMQQueueAdapter<AlertNotificationJobData>('alert-notifications', {} as Redis);

    expect(await enqueueAlertNotifications([resolved, triggered], adapter)).toBe(2);

    expect(bullAdd).toHaveBeenCalledTimes(2);
    const [name, , options] = bullAdd.mock.calls[0];
    expect(name).toBe('send-resolved');
    expect(options.jobId).toBe(alertNotificationJobKey(resolved));
    // no explicit cleanup keys: the queue DEFAULT_JOB_OPTIONS keep applying
    expect('removeOnComplete' in options).toBe(false);
    expect('removeOnFail' in options).toBe(false);
    expect(bullAdd.mock.calls[1][2].jobId).toBe(alertNotificationJobKey(triggered));
  });

  it('the graphile adapter forwards the key as jobKey', async () => {
    quickAddJob.mockResolvedValue({ id: 1, created_at: new Date() });
    const adapter = new GraphileQueueAdapter<AlertNotificationJobData>('alert-notifications', {} as Pool);

    expect(await enqueueAlertNotifications([resolved, triggered], adapter)).toBe(2);

    expect(quickAddJob).toHaveBeenCalledTimes(2);
    const [, task, , spec] = quickAddJob.mock.calls[0];
    expect(task).toBe('alert-notifications');
    expect(spec.jobKey).toBe(alertNotificationJobKey(resolved));
    expect(quickAddJob.mock.calls[1][3].jobKey).toBe(alertNotificationJobKey(triggered));
  });
});
