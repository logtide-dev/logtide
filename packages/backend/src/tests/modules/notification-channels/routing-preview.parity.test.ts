import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import type { NotificationChannel, NotificationEventType } from '@logtide/shared';
import { notificationChannelsService as svc } from '../../../modules/notification-channels/service.js';
import { createTestContext, createTestAlertRule } from '../../helpers/factories.js';

vi.mock('../../../config/index.js', async (orig) => ({
  ...((await orig()) as object),
  isSmtpConfigured: vi.fn(() => true),
}));

import { resolveRoutingPreview } from '../../../modules/notification-channels/routing-preview.service.js';

/**
 * Contract test: the preview must resolve the same channel set as the
 * notification jobs. Jobs: specific = get<X>Channels(id); when empty,
 * getOrganizationDefaults(org, type). W11 keeps this test when it swaps in
 * the shared resolver.
 */
describe('routing preview parity with job resolution', () => {
  let orgId: string;
  let projectId: string;
  let chA: string;
  let chB: string;
  let chDefault: string;

  async function addChannel(name: string) {
    const row = await db
      .insertInto('notification_channels')
      .values({
        organization_id: orgId,
        name,
        type: 'email',
        enabled: true,
        config: { recipients: ['ops@example.com'] },
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function createIncident() {
    return db
      .insertInto('incidents')
      .values({
        organization_id: orgId,
        project_id: projectId,
        title: 'Parity incident',
        severity: 'high',
        status: 'open',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((r) => r.id);
  }

  async function createErrorGroup() {
    return db
      .insertInto('error_groups')
      .values({
        organization_id: orgId,
        project_id: projectId,
        fingerprint: `fp_parity_${Math.random()}`,
        exception_type: 'TypeError',
        exception_message: 'parity',
        language: 'nodejs',
        occurrence_count: 1,
        first_seen: new Date(),
        last_seen: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((r) => r.id);
  }

  async function createMonitor() {
    return db
      .insertInto('monitors')
      .values({
        organization_id: orgId,
        project_id: projectId,
        name: 'Parity monitor',
        type: 'http',
        target: 'https://example.com/health',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((r) => r.id);
  }

  async function jobResolution(
    specific: NotificationChannel[],
    eventType: NotificationEventType
  ): Promise<string[]> {
    const chosen = specific.length > 0 ? specific : await svc.getOrganizationDefaults(orgId, eventType);
    return chosen.map((c) => c.id).sort();
  }

  async function previewIds(eventType: NotificationEventType, specific: NotificationChannel[]) {
    const res = await resolveRoutingPreview({
      organizationId: orgId,
      eventType,
      channelIds: specific.map((c) => c.id),
    });
    return res.destinations.map((d) => d.id).sort();
  }

  beforeEach(async () => {
    await db.deleteFrom('organization_default_channels').execute();
    await db.deleteFrom('alert_rule_channels').execute();
    await db.deleteFrom('sigma_rule_channels').execute();
    await db.deleteFrom('incident_channels').execute();
    await db.deleteFrom('error_group_channels').execute();
    await db.deleteFrom('monitor_channels').execute();
    await db.deleteFrom('notification_channels').execute();
    await db.deleteFrom('incidents').execute();
    await db.deleteFrom('error_groups').execute();
    await db.deleteFrom('monitors').execute();
    await db.deleteFrom('alert_history').execute();
    await db.deleteFrom('alert_rules').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();

    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    chA = await addChannel('A');
    chB = await addChannel('B');
    chDefault = await addChannel('Default');
  });

  const scenarios = [
    { eventType: 'incident' as const, create: () => createIncident(), set: (id: string, ids: string[]) => svc.setIncidentChannels(id, ids), get: (id: string) => svc.getIncidentChannels(id) },
    { eventType: 'error' as const, create: () => createErrorGroup(), set: (id: string, ids: string[]) => svc.setErrorGroupChannels(id, ids), get: (id: string) => svc.getErrorGroupChannels(id) },
    { eventType: 'monitoring' as const, create: () => createMonitor(), set: (id: string, ids: string[]) => svc.setMonitorChannels(id, ids, orgId), get: (id: string) => svc.getMonitorChannels(id) },
  ];

  for (const s of scenarios) {
    const label = s.eventType;

    it(`${label} preview matches the channels the ${label} job resolves`, async () => {
      // (a) object with its own channels
      const withOwn = await s.create();
      await s.set(withOwn, [chA, chB]);
      await svc.setOrganizationDefaults(orgId, s.eventType, [chDefault]);
      const own = await s.get(withOwn);
      expect(own).toHaveLength(2);
      expect(await previewIds(s.eventType, own)).toEqual(await jobResolution(own, s.eventType));
      expect(await previewIds(s.eventType, own)).toEqual([chA, chB].sort());

      // (b) object with none and org defaults set
      const bare = await s.create();
      const none = await s.get(bare);
      expect(none).toHaveLength(0);
      expect(await previewIds(s.eventType, none)).toEqual(await jobResolution(none, s.eventType));
      expect(await previewIds(s.eventType, none)).toEqual([chDefault]);

      // (c) neither
      await svc.setOrganizationDefaults(orgId, s.eventType, []);
      expect(await previewIds(s.eventType, none)).toEqual(await jobResolution(none, s.eventType));
      expect(await previewIds(s.eventType, none)).toEqual([]);
    });
  }

  it('alert preview matches getAlertRuleChannels when the rule has channels', async () => {
    const rule = await createTestAlertRule({ organizationId: orgId });
    await svc.setAlertRuleChannels(rule.id, [chA, chB], orgId);
    const own = await svc.getAlertRuleChannels(rule.id);

    expect(own).toHaveLength(2);
    expect(await previewIds('alert', own)).toEqual(own.map((c) => c.id).sort());
  });

  it('KNOWN GAP alert dispatch ignores organization defaults', async () => {
    const rule = await createTestAlertRule({ organizationId: orgId });
    await svc.setOrganizationDefaults(orgId, 'alert', [chDefault]);

    const jobSide = await svc.getAlertRuleChannels(rule.id);
    const preview = await resolveRoutingPreview({ organizationId: orgId, eventType: 'alert' });

    // Dispatch (alert-notification.ts) never consults org defaults; the preview
    // follows the target precedence. W11/W8 update this test when the gap closes.
    expect(jobSide).toEqual([]);
    expect(preview.destinations.map((d) => d.id)).toEqual([chDefault]);
  });
});
