import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/factories.js';
import {
  clearUntilResolvedMutes,
  getProjectHealthSettings,
  setMute,
} from '../../../modules/project-health/settings.js';

describe('project health mutes (atomic updates)', () => {
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    await db.deleteFrom('project_notification_settings').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  it('setMute upserts the settings row when missing', async () => {
    const mute = await setMute(orgId, projectId, 'silent', '24h');
    expect(mute?.until).not.toBeNull();
    expect((await getProjectHealthSettings(orgId, projectId)).mutes.silent).toEqual(mute);
  });

  it('setMute(null) on a missing row is a no-op that does not fail', async () => {
    expect(await setMute(orgId, projectId, 'silent', null)).toBeNull();
    expect((await getProjectHealthSettings(orgId, projectId)).mutes).toEqual({});
  });

  it('clearing one key keeps the mutes of other keys', async () => {
    await setMute(orgId, projectId, 'silent', 'until_resolved');
    await setMute(orgId, projectId, 'revoked_key', 'until_resolved');
    await setMute(orgId, projectId, 'pii_rejected', '7d');
    await clearUntilResolvedMutes(orgId, projectId, ['silent', 'pii_rejected']);
    const mutes = (await getProjectHealthSettings(orgId, projectId)).mutes;
    expect(mutes.silent).toBeUndefined();
    expect(mutes.revoked_key?.untilResolved).toBe(true);
    // timed mute is not an untilResolved one
    expect(mutes.pii_rejected?.until).not.toBeNull();
  });

  it('setMute(null) removes only its key', async () => {
    await setMute(orgId, projectId, 'silent', '24h');
    await setMute(orgId, projectId, 'revoked_key', '24h');
    await setMute(orgId, projectId, 'silent', null);
    const mutes = (await getProjectHealthSettings(orgId, projectId)).mutes;
    expect(mutes.silent).toBeUndefined();
    expect(mutes.revoked_key).toBeDefined();
  });

  it('concurrent mutes on different keys both survive', async () => {
    await Promise.all([
      setMute(orgId, projectId, 'silent', '24h'),
      setMute(orgId, projectId, 'revoked_key', '7d'),
      setMute(orgId, projectId, 'pii_rejected', 'until_resolved'),
    ]);
    const mutes = (await getProjectHealthSettings(orgId, projectId)).mutes;
    expect(Object.keys(mutes).sort()).toEqual(['pii_rejected', 'revoked_key', 'silent']);
  });

  it('does not touch another organization row', async () => {
    const other = await createTestContext();
    await setMute(other.organization.id, other.project.id, 'silent', 'until_resolved');
    await clearUntilResolvedMutes(orgId, other.project.id, ['silent']);
    expect(
      (await getProjectHealthSettings(other.organization.id, other.project.id)).mutes.silent
    ).toBeDefined();
  });
});
