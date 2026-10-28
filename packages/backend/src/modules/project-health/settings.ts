/**
 * Per-project health settings (project_notification_settings, migration 073):
 * channel override for project_health notifications, silent threshold, mutes.
 * A project without a row uses the defaults.
 */

import {
  PROJECT_HEALTH_CHECKS,
  PROJECT_HEALTH_SILENT_DEFAULT_MINUTES,
  PROJECT_HEALTH_SILENT_MAX_MINUTES,
  PROJECT_HEALTH_SILENT_MIN_MINUTES,
  type ProjectHealthCheckKey,
  type ProjectHealthMute,
  type ProjectHealthMuteDuration,
} from '@logtide/shared';
import { sql } from 'kysely';
import { db } from '../../database/connection.js';

export type ProjectHealthMutes = Partial<Record<ProjectHealthCheckKey, ProjectHealthMute>>;

export interface ProjectHealthSettings {
  healthChannelIds: string[];
  silentMinutes: number;
  mutes: ProjectHealthMutes;
}

export interface UpdateProjectHealthSettingsInput {
  healthChannelIds?: string[];
  silentMinutes?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function defaultProjectHealthSettings(): ProjectHealthSettings {
  return { healthChannelIds: [], silentMinutes: PROJECT_HEALTH_SILENT_DEFAULT_MINUTES, mutes: {} };
}

export function isCheckKey(value: string): value is ProjectHealthCheckKey {
  return Object.prototype.hasOwnProperty.call(PROJECT_HEALTH_CHECKS, value);
}

/** A mute is active while `untilResolved` is set or `until` is in the future. */
export function isMuted(mute: ProjectHealthMute | null | undefined, now: Date = new Date()): boolean {
  if (!mute) return false;
  if (mute.untilResolved) return true;
  return mute.until !== null && new Date(mute.until).getTime() > now.getTime();
}

/** Normalize the stored JSONB into typed mutes, dropping unknown keys and junk. */
export function parseMutes(raw: unknown): ProjectHealthMutes {
  const out: ProjectHealthMutes = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCheckKey(key) || !value || typeof value !== 'object') continue;
    const v = value as { until?: unknown; untilResolved?: unknown };
    out[key] = {
      until: typeof v.until === 'string' ? v.until : null,
      untilResolved: v.untilResolved === true,
    };
  }
  return out;
}

export function rowToSettings(row: {
  health_channel_ids: string[] | null;
  silent_minutes: number;
  mutes: unknown;
}): ProjectHealthSettings {
  return {
    healthChannelIds: row.health_channel_ids ?? [],
    silentMinutes: row.silent_minutes,
    mutes: parseMutes(row.mutes),
  };
}

export async function getProjectHealthSettings(
  organizationId: string,
  projectId: string
): Promise<ProjectHealthSettings> {
  const row = await db
    .selectFrom('project_notification_settings')
    .select(['health_channel_ids', 'silent_minutes', 'mutes'])
    .where('organization_id', '=', organizationId)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  return row ? rowToSettings(row) : defaultProjectHealthSettings();
}

/** Settings for many projects of any org (system cron). Missing rows are absent from the map. */
export async function getSettingsForProjects(
  projectIds: string[]
): Promise<Map<string, ProjectHealthSettings>> {
  const map = new Map<string, ProjectHealthSettings>();
  if (projectIds.length === 0) return map;
  const rows = await db
    .selectFrom('project_notification_settings')
    .select(['project_id', 'health_channel_ids', 'silent_minutes', 'mutes'])
    // tenant-scope-ok: system cron, project ids come from the non-deleted projects query
    .where('project_id', 'in', projectIds)
    .execute();
  for (const row of rows) map.set(row.project_id, rowToSettings(row));
  return map;
}

function clampSilent(minutes: number): number {
  if (!Number.isInteger(minutes)) throw new Error('silentMinutes must be an integer');
  if (minutes < PROJECT_HEALTH_SILENT_MIN_MINUTES || minutes > PROJECT_HEALTH_SILENT_MAX_MINUTES) {
    throw new Error(
      `silentMinutes must be between ${PROJECT_HEALTH_SILENT_MIN_MINUTES} and ${PROJECT_HEALTH_SILENT_MAX_MINUTES}`
    );
  }
  return minutes;
}

/**
 * Upsert the per-project settings. Callers validate that channel ids belong to
 * the organization (the resolver also filters foreign or disabled channels).
 */
export async function updateProjectHealthSettings(
  organizationId: string,
  projectId: string,
  input: UpdateProjectHealthSettingsInput
): Promise<ProjectHealthSettings> {
  const current = await getProjectHealthSettings(organizationId, projectId);
  const healthChannelIds = input.healthChannelIds
    ? Array.from(new Set(input.healthChannelIds))
    : current.healthChannelIds;
  const silentMinutes =
    input.silentMinutes !== undefined ? clampSilent(input.silentMinutes) : current.silentMinutes;

  await writeRow(organizationId, projectId, {
    health_channel_ids: healthChannelIds,
    silent_minutes: silentMinutes,
  });
  return { ...current, healthChannelIds, silentMinutes };
}

async function writeRow(
  organizationId: string,
  projectId: string,
  values: { health_channel_ids?: string[]; silent_minutes?: number; mutes?: ProjectHealthMutes }
): Promise<void> {
  const insert = {
    project_id: projectId,
    organization_id: organizationId,
    ...(values.health_channel_ids !== undefined ? { health_channel_ids: values.health_channel_ids } : {}),
    ...(values.silent_minutes !== undefined ? { silent_minutes: values.silent_minutes } : {}),
    ...(values.mutes !== undefined ? { mutes: JSON.stringify(values.mutes) } : {}),
  };
  const update = {
    ...(values.health_channel_ids !== undefined ? { health_channel_ids: values.health_channel_ids } : {}),
    ...(values.silent_minutes !== undefined ? { silent_minutes: values.silent_minutes } : {}),
    ...(values.mutes !== undefined ? { mutes: JSON.stringify(values.mutes) } : {}),
    updated_at: new Date(),
  };
  await db
    .insertInto('project_notification_settings')
    .values(insert)
    .onConflict((oc) =>
      oc
        .column('project_id')
        .doUpdateSet(update)
        // Never let a row of another organization be rewritten through this path.
        .where('project_notification_settings.organization_id', '=', organizationId)
    )
    .execute();
}

/** Mute value for a duration, computed from `now`. */
export function muteFor(duration: ProjectHealthMuteDuration, now: Date = new Date()): ProjectHealthMute {
  switch (duration) {
    case '24h':
      return { until: new Date(now.getTime() + DAY_MS).toISOString(), untilResolved: false };
    case '7d':
      return { until: new Date(now.getTime() + 7 * DAY_MS).toISOString(), untilResolved: false };
    case 'until_resolved':
      return { until: null, untilResolved: true };
  }
}

/** Set (or clear with null) the mute of one check. Returns the stored mute. */
export async function setMute(
  organizationId: string,
  projectId: string,
  checkKey: ProjectHealthCheckKey,
  duration: ProjectHealthMuteDuration | null,
  now: Date = new Date()
): Promise<ProjectHealthMute | null> {
  // Single statements so concurrent changes to different keys never clobber
  // each other (no read-modify-write of the whole JSONB).
  if (duration === null) {
    await sql`
      INSERT INTO project_notification_settings (project_id, organization_id)
      VALUES (${projectId}, ${organizationId})
      ON CONFLICT (project_id) DO UPDATE
        SET mutes = COALESCE(project_notification_settings.mutes, '{}'::jsonb) - ${checkKey}::text,
            updated_at = NOW()
        WHERE project_notification_settings.organization_id = ${organizationId}
    `.execute(db);
    return null;
  }
  const mute = muteFor(duration, now);
  await sql`
    INSERT INTO project_notification_settings (project_id, organization_id, mutes)
    VALUES (${projectId}, ${organizationId}, jsonb_build_object(${checkKey}::text, ${JSON.stringify(mute)}::jsonb))
    ON CONFLICT (project_id) DO UPDATE
      SET mutes = jsonb_set(
            COALESCE(project_notification_settings.mutes, '{}'::jsonb),
            ARRAY[${checkKey}::text],
            ${JSON.stringify(mute)}::jsonb,
            true
          ),
          updated_at = NOW()
      WHERE project_notification_settings.organization_id = ${organizationId}
  `.execute(db);
  return mute;
}

/** Drop the `untilResolved` mutes of the given checks (their issue resolved). */
export async function clearUntilResolvedMutes(
  organizationId: string,
  projectId: string,
  checkKeys: ProjectHealthCheckKey[]
): Promise<void> {
  if (checkKeys.length === 0) return;
  // One atomic UPDATE: drop only the listed keys whose mute is untilResolved.
  await sql`
    UPDATE project_notification_settings
    SET mutes = mutes - COALESCE(
          (
            SELECT array_agg(e.key)
            FROM jsonb_each(mutes) AS e
            WHERE e.key = ANY(${checkKeys}::text[])
              AND e.value->>'untilResolved' = 'true'
          ),
          ARRAY[]::text[]
        ),
        updated_at = NOW()
    WHERE project_id = ${projectId}
      AND organization_id = ${organizationId}
      AND mutes IS NOT NULL
  `.execute(db);
}
