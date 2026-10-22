import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';

const hoisted = vi.hoisted(() => ({
  smtp: { configured: true },
  add: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({ add: hoisted.add })),
}));

vi.mock('../../../config/index.js', async (orig) => ({
  ...((await orig()) as object),
  isSmtpConfigured: vi.fn(() => hoisted.smtp.configured),
}));

import { processSigmaDetection } from '../../../queue/jobs/sigma-detection.js';
import { SigmaDetectionEngine } from '../../../modules/sigma/detection-engine.js';

async function addChannel(organizationId: string, name: string) {
  return db
    .insertInto('notification_channels')
    .values({
      organization_id: organizationId,
      name,
      type: 'email',
      enabled: true,
      config: JSON.stringify({ recipients: [`${name}@example.com`] }) as any,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function runMatch(organizationId: string, projectId: string, rule: { id: string; title: string; level: string }) {
  vi.spyOn(SigmaDetectionEngine, 'evaluateBatch').mockResolvedValueOnce([
    {
      matched: true,
      matchedRules: [
        { sigmaRuleId: rule.id, ruleTitle: rule.title, ruleLevel: rule.level, matchedAt: new Date() },
      ],
    },
  ] as any);
  await processSigmaDetection({
    data: {
      logs: [{ message: 'boom', level: 'error', service: 'api', time: new Date() }],
      organizationId,
      projectId,
    },
  });
}

describe('sigma detection notification routing', () => {
  beforeEach(async () => {
    hoisted.smtp.configured = true;
    hoisted.add.mockClear();
    await db.deleteFrom('organization_default_channels').execute();
    await db.deleteFrom('sigma_rule_channels').execute();
    await db.deleteFrom('notification_channels').execute();
    await db.deleteFrom('sigma_rules').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('notifications').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();
  });

  it('enqueues a sigma job for a rule that has channels, with kind set', async () => {
    const { organization, project } = await createTestContext();
    const rule = await createTestSigmaRule({ organizationId: organization.id, projectId: project.id });
    const ch = await addChannel(organization.id, 'rulechan');
    await db.insertInto('sigma_rule_channels').values({ sigma_rule_id: rule.id, channel_id: ch.id }).execute();

    await runMatch(organization.id, project.id, rule);

    expect(hoisted.add).toHaveBeenCalledTimes(1);
    const [, payload] = hoisted.add.mock.calls[0];
    expect(payload).toMatchObject({
      kind: 'triggered',
      event_type: 'sigma',
      rule_id: rule.id,
      organization_id: organization.id,
    });
  });

  it('enqueues for a rule with no channels when the org has a sigma default', async () => {
    const { organization, project } = await createTestContext();
    const rule = await createTestSigmaRule({ organizationId: organization.id, projectId: project.id });
    const ch = await addChannel(organization.id, 'orgdefault');
    await db
      .insertInto('organization_default_channels')
      .values({ organization_id: organization.id, channel_id: ch.id, event_type: 'sigma' })
      .execute();

    await runMatch(organization.id, project.id, rule);

    expect(hoisted.add).toHaveBeenCalledTimes(1);
    expect(hoisted.add.mock.calls[0][1]).toMatchObject({ kind: 'triggered', event_type: 'sigma' });
  });

  it('a default for another event type does not count for sigma', async () => {
    const { organization, project } = await createTestContext();
    hoisted.smtp.configured = false;
    const rule = await createTestSigmaRule({ organizationId: organization.id, projectId: project.id });
    const ch = await addChannel(organization.id, 'alertonly');
    await db
      .insertInto('organization_default_channels')
      .values({ organization_id: organization.id, channel_id: ch.id, event_type: 'alert' })
      .execute();

    await runMatch(organization.id, project.id, rule);

    expect(hoisted.add).not.toHaveBeenCalled();
  });

  it('falls back to owners and admins when nothing is configured and SMTP is on', async () => {
    const { organization, project } = await createTestContext();
    const rule = await createTestSigmaRule({ organizationId: organization.id, projectId: project.id });

    await runMatch(organization.id, project.id, rule);

    expect(hoisted.add).toHaveBeenCalledTimes(1);
    expect(hoisted.add.mock.calls[0][1]).toMatchObject({ kind: 'triggered', event_type: 'sigma' });
  });

  it('stays detection-only when nothing is configured and SMTP is off', async () => {
    const { organization, project } = await createTestContext();
    hoisted.smtp.configured = false;
    const rule = await createTestSigmaRule({ organizationId: organization.id, projectId: project.id });

    await runMatch(organization.id, project.id, rule);

    expect(hoisted.add).not.toHaveBeenCalled();
  });

  it('does not use channels of another organization', async () => {
    const { organization, project } = await createTestContext();
    const other = await createTestContext();
    hoisted.smtp.configured = false;
    const rule = await createTestSigmaRule({ organizationId: organization.id, projectId: project.id });
    const foreign = await addChannel(other.organization.id, 'foreign');
    await db.insertInto('sigma_rule_channels').values({ sigma_rule_id: rule.id, channel_id: foreign.id }).execute();

    await runMatch(organization.id, project.id, rule);

    expect(hoisted.add).not.toHaveBeenCalled();
  });
});
