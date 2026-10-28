import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/factories.js';

vi.mock('../../../modules/project-health/notifier.js', () => ({
  notifyProjectHealth: vi.fn(async () => {}),
}));

import { notifyProjectHealth } from '../../../modules/project-health/notifier.js';
import { runProjectHealthPass } from '../../../modules/project-health/evaluator.js';
import {
  listIssues,
  listOpenByOrg,
  setMute,
  getProjectHealthSettings,
  updateProjectHealthSettings,
} from '../../../modules/project-health/index.js';
import { projectsService } from '../../../modules/projects/service.js';

const notify = notifyProjectHealth as unknown as ReturnType<typeof vi.fn>;
const MIN = 60_000;

let t0: Date;
const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN);

async function setLastEvent(projectId: string, when: Date | null) {
  await db.updateTable('projects').set({ has_logs_at: when }).where('id', '=', projectId).execute();
}

async function addMetering(orgId: string, projectId: string, type: string, time: Date, quantity = 1) {
  await db
    .insertInto('metering_events')
    .values({
      time,
      organization_id: orgId,
      project_id: projectId,
      type,
      quantity,
      metadata: null,
    } as never)
    .execute();
}

/** Mark a project as already evaluated and seen receiving (a mature project). */
async function seedMatureState(orgId: string, projectId: string) {
  const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db
    .insertInto('project_health_state')
    .values({ project_id: projectId, organization_id: orgId, first_evaluated_at: past, last_receiving_at: past })
    .execute();
}

function calls(kind: 'opened' | 'resolved', projectId?: string) {
  return notify.mock.calls.filter(
    (c) => c[2] === kind && (projectId === undefined || c[1].id === projectId)
  );
}

describe('runProjectHealthPass', () => {
  let orgId: string;
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    notify.mockClear();
    await db.deleteFrom('project_health_issues').execute();
    await db.deleteFrom('project_notification_settings').execute();
    await db.deleteFrom('metering_events').execute();
    await db.deleteFrom('project_health_state').execute();
    // Only our project is evaluated in a pass: other tests' projects are gone by setup truncation.
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    userId = ctx.user.id;
    t0 = new Date();
    t0.setUTCSeconds(0, 0);
    // Most tests describe a mature project; the rollout tests below delete this.
    await seedMatureState(orgId, projectId);
  });

  describe('rollout guard', () => {
    beforeEach(async () => {
      await db.deleteFrom('project_health_state').execute();
    });

    it('a project already idle on its first evaluation never raises silent', async () => {
      await setLastEvent(projectId, at(-24 * 60));
      const r1 = await runProjectHealthPass(t0);
      const r2 = await runProjectHealthPass(at(5));
      expect(r1.opened + r2.opened).toBe(0);
      expect(calls('opened')).toHaveLength(0);
      expect(await listIssues(orgId, projectId)).toHaveLength(0);
    });

    it('silent arms once the project was seen receiving, then alerts on the next stop', async () => {
      await setLastEvent(projectId, at(-24 * 60));
      await runProjectHealthPass(t0);
      await setLastEvent(projectId, at(1));
      await runProjectHealthPass(at(2));
      await runProjectHealthPass(at(120));
      expect(calls('opened', projectId)).toHaveLength(1);
      expect(calls('opened', projectId)[0][0].checkKey).toBe('silent');
    });

    it('issues found on the first evaluation are baseline: visible, never notified', async () => {
      await setLastEvent(projectId, at(-1));
      await addMetering(orgId, projectId, 'ingestion.timestamp_skew', at(-30));
      await runProjectHealthPass(t0);
      const issues = await listIssues(orgId, projectId);
      expect(issues).toHaveLength(1);
      expect(issues[0].baseline).toBe(true);
      expect(calls('opened')).toHaveLength(0);

      // Resolves 24h+ later: still nothing sent.
      await setLastEvent(projectId, at(25 * 60));
      await runProjectHealthPass(at(25 * 60));
      await runProjectHealthPass(at(25 * 60 + 20));
      expect(calls('resolved')).toHaveLength(0);
    });

    it('a new issue after the first evaluation is notified', async () => {
      await setLastEvent(projectId, at(-1));
      await runProjectHealthPass(t0);
      await addMetering(orgId, projectId, 'ingestion.pii_rejected', at(4));
      await runProjectHealthPass(at(5));
      expect(calls('opened', projectId)).toHaveLength(1);
      expect(calls('opened', projectId)[0][0].checkKey).toBe('pii_rejected');
    });
  });

  it('opens a silent issue and notifies exactly once across passes', async () => {
    await setLastEvent(projectId, at(-120));
    const r1 = await runProjectHealthPass(t0);
    expect(r1.opened).toBe(1);
    expect(calls('opened', projectId)).toHaveLength(1);
    expect(calls('opened', projectId)[0][0].checkKey).toBe('silent');

    const r2 = await runProjectHealthPass(at(5));
    expect(r2.opened).toBe(0);
    expect(calls('opened', projectId)).toHaveLength(1);

    const issues = await listIssues(orgId, projectId);
    expect(issues).toHaveLength(1);
    expect(issues[0].notifiedOpenAt).not.toBeNull();
    expect(issues[0].lastSeenAt.getTime()).toBe(at(5).getTime());
  });

  it('two concurrent passes on the same state send one notification', async () => {
    await setLastEvent(projectId, at(-120));
    await Promise.all([runProjectHealthPass(t0), runProjectHealthPass(t0)]);
    expect(calls('opened', projectId)).toHaveLength(1);
    const open = await listOpenByOrg(orgId);
    expect(open).toHaveLength(1);

    await setLastEvent(projectId, at(1));
    await runProjectHealthPass(at(2));
    await Promise.all([runProjectHealthPass(at(20)), runProjectHealthPass(at(20))]);
    expect(calls('resolved', projectId)).toHaveLength(1);
  });

  it('never received an event: no silent issue', async () => {
    await setLastEvent(projectId, null);
    await runProjectHealthPass(t0);
    expect(await listIssues(orgId, projectId)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('honors the per-project silent threshold without flapping on the debounce', async () => {
    await updateProjectHealthSettings(orgId, projectId, { silentMinutes: 10 });
    await setLastEvent(projectId, at(-6));
    await runProjectHealthPass(t0);
    expect(await listIssues(orgId, projectId)).toHaveLength(0);

    await setLastEvent(projectId, at(-11));
    await runProjectHealthPass(t0);
    expect((await listOpenByOrg(orgId)).map((i) => i.checkKey)).toEqual(['silent']);
  });

  it('resolves and sends a resolve notification', async () => {
    await setLastEvent(projectId, at(1));
    await addMetering(orgId, projectId, 'ingestion.pii_rejected', at(-5), 4);
    await runProjectHealthPass(t0);
    const opened = calls('opened', projectId);
    expect(opened).toHaveLength(1);
    expect(opened[0][0].checkKey).toBe('pii_rejected');
    expect(opened[0][0].details).toEqual({ count60m: 4 });

    // 60 min with zero rejections
    const r = await runProjectHealthPass(at(60));
    expect(r.resolved).toBe(1);
    expect(await listOpenByOrg(orgId)).toHaveLength(0);
    // the resolve waits out the 15 minute reopen window
    expect(calls('resolved', projectId)).toHaveLength(0);

    await runProjectHealthPass(at(70));
    expect(calls('resolved', projectId)).toHaveLength(0);
    await runProjectHealthPass(at(76));
    expect(calls('resolved', projectId)).toHaveLength(1);
    await runProjectHealthPass(at(80));
    expect(calls('resolved', projectId)).toHaveLength(1);
  });

  it('reopen within 15 minutes reuses the row and does not re-notify open', async () => {
    await setLastEvent(projectId, at(-120));
    await runProjectHealthPass(t0);
    const [first] = await listIssues(orgId, projectId);

    await setLastEvent(projectId, at(1));
    await runProjectHealthPass(at(1));
    expect(calls('resolved', projectId)).toHaveLength(0);

    // Silent again 10 min after resolve (threshold 10 with last event at +1)
    await updateProjectHealthSettings(orgId, projectId, { silentMinutes: 10 });
    await runProjectHealthPass(at(12));
    const rows = await listIssues(orgId, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].resolvedAt).toBeNull();
    expect(rows[0].notifiedResolveAt).toBeNull();
    expect(rows[0].openedAt.getTime()).toBe(first.openedAt.getTime());
    expect(calls('opened', projectId)).toHaveLength(1);
  });

  it('reopen after 15 minutes opens a new episode and notifies', async () => {
    await setLastEvent(projectId, at(-120));
    await runProjectHealthPass(t0);
    await setLastEvent(projectId, at(1));
    await runProjectHealthPass(at(1));
    await updateProjectHealthSettings(orgId, projectId, { silentMinutes: 10 });
    await runProjectHealthPass(at(20));
    expect(await listIssues(orgId, projectId)).toHaveLength(2);
    expect(calls('opened', projectId)).toHaveLength(2);
  });

  it('muted open issue sends nothing until the mute expires while still open', async () => {
    await setMute(orgId, projectId, 'silent', '24h', t0);
    await setLastEvent(projectId, at(-120));
    await runProjectHealthPass(t0);
    expect(await listOpenByOrg(orgId)).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();

    await runProjectHealthPass(at(24 * 60 + 1));
    expect(calls('opened', projectId)).toHaveLength(1);
  });

  it('an episode opened and resolved inside a mute sends nothing', async () => {
    await setMute(orgId, projectId, 'silent', '7d', t0);
    await setLastEvent(projectId, at(-120));
    await runProjectHealthPass(t0);
    await setLastEvent(projectId, at(5));
    await runProjectHealthPass(at(6));
    expect(await listOpenByOrg(orgId)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('muting an already notified issue still sends its resolve', async () => {
    await setLastEvent(projectId, at(-120));
    await runProjectHealthPass(t0);
    await setMute(orgId, projectId, 'silent', '7d', t0);
    await setLastEvent(projectId, at(5));
    await runProjectHealthPass(at(6));
    expect(calls('opened', projectId)).toHaveLength(1);
    await runProjectHealthPass(at(22));
    expect(calls('resolved', projectId)).toHaveLength(1);
  });

  it('until_resolved mute is cleared when the issue resolves', async () => {
    await setLastEvent(projectId, at(-120));
    await setMute(orgId, projectId, 'silent', 'until_resolved', t0);
    await runProjectHealthPass(t0);
    expect(notify).not.toHaveBeenCalled();
    await setLastEvent(projectId, at(5));
    await runProjectHealthPass(at(6));
    expect((await getProjectHealthSettings(orgId, projectId)).mutes.silent).toBeUndefined();
  });

  it('skew and revoked key counters open warning issues', async () => {
    await setLastEvent(projectId, at(1));
    await db
      .insertInto('metering_events')
      .values({
        time: at(-600),
        organization_id: orgId,
        project_id: projectId,
        type: 'ingestion.timestamp_skew',
        quantity: 900,
        metadata: JSON.stringify({ maxPastMs: 3 * 3_600_000, maxFutureMs: 0 }),
      } as never)
      .execute();
    await addMetering(orgId, projectId, 'ingestion.revoked_key', at(-10));
    await addMetering(orgId, projectId, 'ingestion.revoked_key', at(-90)); // outside 60m

    await runProjectHealthPass(t0);
    const open = await listOpenByOrg(orgId);
    const byKey = Object.fromEntries(open.map((i) => [i.checkKey, i]));
    expect(Object.keys(byKey).sort()).toEqual(['revoked_key', 'timestamp_skew_logs']);
    expect(byKey.timestamp_skew_logs.severity).toBe('warning');
    expect(byKey.timestamp_skew_logs.details).toEqual({ count24h: 900, maxPastHours: 3 });
    expect(byKey.revoked_key.details).toEqual({ count60m: 1 });
  });

  it('soft-deleted project: skipped by the cron and its issues resolved silently', async () => {
    await setLastEvent(projectId, at(-120));
    await runProjectHealthPass(t0);
    expect(calls('opened', projectId)).toHaveLength(1);

    expect(await projectsService.deleteProject(projectId, userId)).toBe(true);
    const rows = await listIssues(orgId, projectId);
    expect(rows[0].resolvedAt).not.toBeNull();
    expect(rows[0].notifiedResolveAt).not.toBeNull();

    const r = await runProjectHealthPass(at(5));
    expect(r.evaluated).toBe(0);
    expect(calls('resolved', projectId)).toHaveLength(0);
    expect(await listOpenByOrg(orgId)).toHaveLength(0);
  });

  it('flapping issue: reopen inside the window then resolve again sends exactly one resolved', async () => {
    await updateProjectHealthSettings(orgId, projectId, { silentMinutes: 10 });
    await setLastEvent(projectId, at(-120));
    await runProjectHealthPass(t0);
    expect(calls('opened', projectId)).toHaveLength(1);

    await setLastEvent(projectId, at(1));
    await runProjectHealthPass(at(1)); // resolved
    await runProjectHealthPass(at(5));
    await runProjectHealthPass(at(12)); // silent again, reopens the same row
    expect((await listOpenByOrg(orgId))).toHaveLength(1);
    expect(calls('resolved', projectId)).toHaveLength(0);

    await setLastEvent(projectId, at(13));
    await runProjectHealthPass(at(13)); // resolved again
    await runProjectHealthPass(at(20));
    expect(calls('resolved', projectId)).toHaveLength(0);
    await setLastEvent(projectId, at(100));
    await runProjectHealthPass(at(29));
    await runProjectHealthPass(at(35));
    expect(calls('resolved', projectId)).toHaveLength(1);
    expect(calls('opened', projectId)).toHaveLength(1);
  });

  it('until_resolved mute does not survive soft delete and restore', async () => {
    await setLastEvent(projectId, at(-120));
    await setMute(orgId, projectId, 'silent', 'until_resolved', t0);
    await setMute(orgId, projectId, 'revoked_key', '7d', t0);
    await runProjectHealthPass(t0);
    expect(await listOpenByOrg(orgId)).toHaveLength(1);

    expect(await projectsService.deleteProject(projectId, userId)).toBe(true);
    const mutes = (await getProjectHealthSettings(orgId, projectId)).mutes;
    expect(mutes.silent).toBeUndefined();
    expect(mutes.revoked_key).toBeDefined();

    expect(await projectsService.restoreProject(projectId, userId)).toBe(true);
    await db.deleteFrom('project_health_issues').where('project_id', '=', projectId).execute();
    await runProjectHealthPass(at(5));
    expect(calls('opened', projectId)).toHaveLength(1);
  });

  it('org isolation: issues of org A are never read through org B', async () => {
    const other = await createTestContext();
    await setLastEvent(projectId, at(-120));
    await setLastEvent(other.project.id, at(1));
    await runProjectHealthPass(t0);

    expect(await listOpenByOrg(other.organization.id)).toHaveLength(0);
    expect(await listIssues(other.organization.id, projectId)).toHaveLength(0);
    expect(await listOpenByOrg(orgId)).toHaveLength(1);
    expect(calls('opened', other.project.id)).toHaveLength(0);
  });
});
