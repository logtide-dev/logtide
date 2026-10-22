import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import type { NotificationChannel, NotificationEventType } from '@logtide/shared';
import { notificationChannelsService as svc } from '../../../modules/notification-channels/service.js';
import { createTestContext, createTestAlertRule, createTestSigmaRule } from '../../helpers/factories.js';

vi.mock('../../../config/index.js', async (orig) => ({
  ...((await orig()) as object),
  isSmtpConfigured: vi.fn(() => true),
}));

import { resolveRoutingPreview } from '../../../modules/notification-channels/routing-preview.service.js';
import { resolveChannelsForEvent } from '../../../modules/notification-channels/resolver.js';
import { resolveAlertChannels } from '../../../queue/jobs/alert-notification.js';
import { resolveErrorChannels } from '../../../queue/jobs/error-notification.js';

/**
 * Contract test: the preview must resolve the same channel set as the
 * notification jobs. Jobs: specific = get<X>Channels(id); when empty,
 * getOrganizationDefaults(org, type), else the owners and admins fallback.
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

  // Dispatch side: the resolver each job really calls (alert/sigma/error are the
  // exported job resolvers; monitoring composes the same call inline in its job).
  const dispatchScenarios = [
    {
      eventType: 'alert' as const,
      create: async () => (await createTestAlertRule({ organizationId: orgId })).id,
      set: (id: string, ids: string[]) => svc.setAlertRuleChannels(id, ids, orgId),
      dispatch: (id: string) =>
        resolveAlertChannels({ kind: 'triggered', rule_id: id, organization_id: orgId } as any),
    },
    {
      eventType: 'sigma' as const,
      create: async () => (await createTestSigmaRule({ organizationId: orgId })).id,
      set: (id: string, ids: string[]) => svc.setSigmaRuleChannels(id, ids, orgId),
      dispatch: (id: string) =>
        resolveAlertChannels({
          kind: 'triggered',
          event_type: 'sigma',
          rule_id: id,
          organization_id: orgId,
        } as any),
    },
    {
      eventType: 'error' as const,
      create: () => createErrorGroup(),
      set: (id: string, ids: string[]) => svc.setErrorGroupChannels(id, ids),
      dispatch: (id: string) => resolveErrorChannels(id, orgId),
    },
    {
      eventType: 'monitoring' as const,
      create: () => createMonitor(),
      set: (id: string, ids: string[]) => svc.setMonitorChannels(id, ids, orgId),
      dispatch: async (id: string) =>
        resolveChannelsForEvent({
          organizationId: orgId,
          eventType: 'monitoring',
          explicitChannels: await svc.getMonitorChannels(id),
        }),
    },
  ];

  for (const s of dispatchScenarios) {
    it(`${s.eventType} preview and dispatch resolver give the same channels and fallback`, async () => {
      const ids = (r: { channels: NotificationChannel[] }) => r.channels.map((c) => c.id).sort();
      const preview = async (channelIds: string[]) => {
        const res = await resolveRoutingPreview({ organizationId: orgId, eventType: s.eventType, channelIds });
        return { ids: res.destinations.map((d) => d.id).sort(), fallback: res.fallback };
      };

      // (a) own channels beat the org default
      const withOwn = await s.create();
      await s.set(withOwn, [chA, chB]);
      await svc.setOrganizationDefaults(orgId, s.eventType, [chDefault]);
      const dOwn = await s.dispatch(withOwn);
      expect(ids(dOwn)).toEqual([chA, chB].sort());
      expect(await preview([chA, chB])).toEqual({ ids: ids(dOwn), fallback: dOwn.fallback });

      // (b) no own channels: the org default
      const bare = await s.create();
      const dBare = await s.dispatch(bare);
      expect(ids(dBare)).toEqual([chDefault]);
      expect(await preview([])).toEqual({ ids: ids(dBare), fallback: dBare.fallback });

      // (c) nothing at all: the owners and admins fallback
      await svc.setOrganizationDefaults(orgId, s.eventType, []);
      const dNone = await s.dispatch(bare);
      expect(dNone.channels).toEqual([]);
      expect(dNone.fallback).toBe('owners_admins_email');
      expect(await preview([])).toEqual({ ids: [], fallback: 'owners_admins_email' });
    });
  }
});
