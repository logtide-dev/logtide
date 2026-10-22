import { describe, it, expect, beforeEach, vi } from 'vitest';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../../../queue/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../queue/connection.js')>();
  return { ...actual, createQueue: vi.fn(() => ({ add })) };
});

import { alertsService } from '../../../modules/alerts/service.js';
import { notificationChannelsService } from '../../../modules/notification-channels/index.js';
import { createTestAlertRule, createTestContext } from '../../helpers/factories.js';
import { resolveAlertChannels } from '../../../queue/jobs/alert-notification.js';
import { setRuleLifecycle } from './lifecycle-test-helpers.js';

describe('disabling or deleting a firing alert rule sends the resolve', () => {
  let organizationId: string;
  let projectId: string;
  let ruleId: string;
  const firedAt = new Date(Date.now() - 10 * 60_000);

  beforeEach(async () => {
    add.mockReset().mockResolvedValue(undefined);
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
    const rule = await createTestAlertRule({ organizationId, projectId, name: 'Noisy' });
    ruleId = rule.id;
  });

  async function fire(notified: boolean) {
    await setRuleLifecycle(ruleId, {
      state: 'firing',
      last_triggered_at: firedAt,
      last_notified_at: notified ? firedAt : null,
    });
  }

  it('disable enqueues alert.resolved for a notified episode', async () => {
    await fire(true);
    await alertsService.updateAlertRule(ruleId, organizationId, { enabled: false });
    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0];
    expect(name).toBe('send-resolved');
    expect(data).toMatchObject({
      kind: 'resolved',
      rule_id: ruleId,
      organization_id: organizationId,
      firing_since: firedAt.toISOString(),
    });
    expect(opts.jobKey).toBe(`alert-resolved-${ruleId}-${firedAt.getTime()}`);
  });

  it('delete enqueues the resolve with the channels the rule had', async () => {
    const channel = await notificationChannelsService.createChannel(organizationId, {
      name: 'pd',
      type: 'webhook',
      config: { url: 'https://example.com/hook' },
    } as any);
    await notificationChannelsService.setAlertRuleChannels(ruleId, [channel.id], organizationId);
    await fire(true);

    expect(await alertsService.deleteAlertRule(ruleId, organizationId)).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][1]).toMatchObject({ kind: 'resolved', rule_id: ruleId, channel_ids: [channel.id] });
  });

  it('sends nothing when the episode was never notified (snoozed) or the rule is ok', async () => {
    await fire(false);
    await alertsService.updateAlertRule(ruleId, organizationId, { enabled: false });
    expect(add).not.toHaveBeenCalled();

    const ok = await createTestAlertRule({ organizationId, projectId, name: 'Quiet' });
    await alertsService.deleteAlertRule(ok.id, organizationId);
    expect(add).not.toHaveBeenCalled();
  });

  it('a queue failure does not block the disable', async () => {
    await fire(true);
    add.mockRejectedValueOnce(new Error('queue down'));
    const updated = await alertsService.updateAlertRule(ruleId, organizationId, { enabled: false });
    expect(updated?.enabled).toBe(false);
  });

  it('the resolve job routes to the snapshotted channels after the rule is gone', async () => {
    const channel = await notificationChannelsService.createChannel(organizationId, {
      name: 'hook',
      type: 'webhook',
      config: { url: 'https://example.com/hook' },
    } as any);
    await notificationChannelsService.setAlertRuleChannels(ruleId, [channel.id], organizationId);
    await fire(true);
    await alertsService.deleteAlertRule(ruleId, organizationId);

    const routing = await resolveAlertChannels(add.mock.calls[0][1]);
    expect(routing.source).toBe('explicit');
    expect(routing.channels.map((c) => c.id)).toEqual([channel.id]);
  });
});
