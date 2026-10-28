/**
 * Persisted project health issue state (project_health_issues, migration 073).
 *
 * One row per episode (project, check, opened_at). At most one open row per
 * (project, check) is enforced by a partial unique index. Notification claims
 * are conditional UPDATEs so two passes (or two worker replicas) can never
 * send the same open or resolve twice.
 */

import { sql } from 'kysely';
import {
  PROJECT_HEALTH_CHECKS,
  type ProjectHealthCheckKey,
  type ProjectHealthIssue,
  type ProjectHealthSeverity,
} from '@logtide/shared';
import { db } from '../../database/connection.js';
import { clearUntilResolvedMutes, type ProjectHealthMutes } from './settings.js';

/** A reopen within this window of the resolution reuses the row (flapping guard). */
export const REOPEN_WINDOW_MS = 15 * 60 * 1000;

export interface HealthIssueRow {
  id: string;
  organizationId: string;
  projectId: string;
  checkKey: ProjectHealthCheckKey;
  severity: ProjectHealthSeverity;
  openedAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  details: Record<string, unknown>;
  notifiedOpenAt: Date | null;
  notifiedResolveAt: Date | null;
}

type RawRow = {
  id: string;
  organization_id: string;
  project_id: string;
  check_key: string;
  severity: 'critical' | 'warning';
  opened_at: Date | string;
  last_seen_at: Date | string;
  resolved_at: Date | string | null;
  details: unknown;
  notified_open_at: Date | string | null;
  notified_resolve_at: Date | string | null;
};

const COLUMNS = [
  'id',
  'organization_id',
  'project_id',
  'check_key',
  'severity',
  'opened_at',
  'last_seen_at',
  'resolved_at',
  'details',
  'notified_open_at',
  'notified_resolve_at',
] as const;

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const toDateOrNull = (v: Date | string | null): Date | null => (v === null ? null : toDate(v));

function mapRow(r: RawRow): HealthIssueRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    projectId: r.project_id,
    checkKey: r.check_key as ProjectHealthCheckKey,
    severity: r.severity,
    openedAt: toDate(r.opened_at),
    lastSeenAt: toDate(r.last_seen_at),
    resolvedAt: toDateOrNull(r.resolved_at),
    details:
      r.details && typeof r.details === 'object'
        ? (r.details as Record<string, unknown>)
        : typeof r.details === 'string'
          ? (JSON.parse(r.details) as Record<string, unknown>)
          : {},
    notifiedOpenAt: toDateOrNull(r.notified_open_at),
    notifiedResolveAt: toDateOrNull(r.notified_resolve_at),
  };
}

/** API shape of an issue, with the check mute attached. */
export function toApiIssue(row: HealthIssueRow, mutes: ProjectHealthMutes = {}): ProjectHealthIssue {
  return {
    id: row.id,
    checkKey: row.checkKey,
    severity: row.severity,
    openedAt: row.openedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    details: row.details,
    mute: mutes[row.checkKey] ?? null,
  };
}

/**
 * Issues the evaluator needs for a set of projects: every open row plus rows
 * resolved after `resolvedSince` (reopen candidates and pending resolve
 * notifications). System cron: the project ids come from the non-deleted
 * projects query.
 */
export async function loadIssuesForProjects(
  projectIds: string[],
  resolvedSince: Date
): Promise<HealthIssueRow[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .selectFrom('project_health_issues')
    .select(COLUMNS)
    // tenant-scope-ok: system cron, project ids come from the non-deleted projects query
    .where('project_id', 'in', projectIds)
    .where((eb) => eb.or([eb('resolved_at', 'is', null), eb('resolved_at', '>=', resolvedSince)]))
    .execute();
  return rows.map((r) => mapRow(r as RawRow));
}

/** Open a new issue. Returns null when another pass opened it first. */
export async function openIssue(input: {
  organizationId: string;
  projectId: string;
  checkKey: ProjectHealthCheckKey;
  details: Record<string, unknown>;
  now: Date;
}): Promise<HealthIssueRow | null> {
  const row = await db
    .insertInto('project_health_issues')
    .values({
      organization_id: input.organizationId,
      project_id: input.projectId,
      check_key: input.checkKey,
      severity: PROJECT_HEALTH_CHECKS[input.checkKey].severity,
      opened_at: input.now,
      last_seen_at: input.now,
      details: JSON.stringify(input.details),
    })
    .onConflict((oc) =>
      oc.columns(['project_id', 'check_key']).where('resolved_at', 'is', null).doNothing()
    )
    .returning(COLUMNS)
    .executeTakeFirst();
  return row ? mapRow(row as RawRow) : null;
}

/**
 * Reopen a recently resolved row: keeps opened_at and notified_open_at (no new
 * open notification), clears resolved_at and notified_resolve_at. Returns null
 * if the row is no longer resolved or the window passed.
 */
export async function reopenIssue(
  issue: Pick<HealthIssueRow, 'id' | 'organizationId' | 'projectId'>,
  details: Record<string, unknown>,
  now: Date
): Promise<HealthIssueRow | null> {
  try {
    const row = await db
      .updateTable('project_health_issues')
      .set({ resolved_at: null, notified_resolve_at: null, last_seen_at: now, details: JSON.stringify(details) })
      .where('id', '=', issue.id)
      .where('organization_id', '=', issue.organizationId)
      .where('project_id', '=', issue.projectId)
      .where('resolved_at', 'is not', null)
      .where('resolved_at', '>=', new Date(now.getTime() - REOPEN_WINDOW_MS))
      .returning(COLUMNS)
      .executeTakeFirst();
    return row ? mapRow(row as RawRow) : null;
  } catch (err) {
    // Another pass opened a fresh row meanwhile (partial unique index): keep it.
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
}

/** Refresh last_seen_at and details of an open issue. */
export async function touchIssue(
  issue: Pick<HealthIssueRow, 'id' | 'organizationId' | 'projectId'>,
  details: Record<string, unknown>,
  now: Date
): Promise<void> {
  await db
    .updateTable('project_health_issues')
    .set({ last_seen_at: now, details: JSON.stringify(details) })
    .where('id', '=', issue.id)
    .where('organization_id', '=', issue.organizationId)
    .where('project_id', '=', issue.projectId)
    .where('resolved_at', 'is', null)
    .execute();
}

/** Resolve an open issue. Returns the resolved row, null if it was not open anymore. */
export async function resolveIssue(
  issue: Pick<HealthIssueRow, 'id' | 'organizationId' | 'projectId'>,
  now: Date
): Promise<HealthIssueRow | null> {
  const row = await db
    .updateTable('project_health_issues')
    .set({ resolved_at: now })
    .where('id', '=', issue.id)
    .where('organization_id', '=', issue.organizationId)
    .where('project_id', '=', issue.projectId)
    .where('resolved_at', 'is', null)
    .returning(COLUMNS)
    .executeTakeFirst();
  return row ? mapRow(row as RawRow) : null;
}

/**
 * Claim the open notification of an issue. True for exactly one caller: the
 * UPDATE only matches while notified_open_at is null and the issue is open.
 */
export async function claimOpenNotification(issueId: string, now: Date = new Date()): Promise<boolean> {
  const row = await db
    .updateTable('project_health_issues')
    .set({ notified_open_at: now })
    // tenant-scope-ok: claim by primary key of a row the caller loaded scoped to its project
    .where('id', '=', issueId)
    .where('notified_open_at', 'is', null)
    .where('resolved_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return !!row;
}

/**
 * Claim the resolve notification of an issue. Only issues whose open was
 * notified get a resolve (an episode fully inside a mute sends nothing).
 */
export async function claimResolveNotification(issueId: string, now: Date = new Date()): Promise<boolean> {
  const row = await db
    .updateTable('project_health_issues')
    .set({ notified_resolve_at: now })
    // tenant-scope-ok: claim by primary key of a row the caller loaded scoped to its project
    .where('id', '=', issueId)
    .where('notified_resolve_at', 'is', null)
    .where('notified_open_at', 'is not', null)
    .where('resolved_at', 'is not', null)
    .returning('id')
    .executeTakeFirst();
  return !!row;
}

/**
 * Resolve every open issue of a project. With `silent`, notified_resolve_at is
 * stamped too so no resolve notification is ever sent (project soft delete).
 */
export async function resolveAllForProject(
  organizationId: string,
  projectId: string,
  opts: { silent: boolean },
  now: Date = new Date()
): Promise<number> {
  const rows = await db
    .updateTable('project_health_issues')
    .set(opts.silent ? { resolved_at: now, notified_resolve_at: now } : { resolved_at: now })
    .where('organization_id', '=', organizationId)
    .where('project_id', '=', projectId)
    .where('resolved_at', 'is', null)
    .returning('check_key')
    .execute();
  // Like a normal resolve, an "until resolved" mute ends with the issue.
  if (rows.length > 0) {
    await clearUntilResolvedMutes(
      organizationId,
      projectId,
      rows.map((r) => r.check_key as ProjectHealthCheckKey)
    );
  }
  return rows.length;
}

/** Open issues plus the ones resolved in the last N days, newest first. */
export async function listIssues(
  organizationId: string,
  projectId: string,
  opts: { includeResolvedSinceDays: number } = { includeResolvedSinceDays: 7 },
  now: Date = new Date()
): Promise<HealthIssueRow[]> {
  const since = new Date(now.getTime() - opts.includeResolvedSinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .selectFrom('project_health_issues')
    .select(COLUMNS)
    .where('organization_id', '=', organizationId)
    .where('project_id', '=', projectId)
    .where((eb) => eb.or([eb('resolved_at', 'is', null), eb('resolved_at', '>=', since)]))
    .orderBy(sql`resolved_at IS NULL`, 'desc')
    .orderBy('opened_at', 'desc')
    .execute();
  return rows.map((r) => mapRow(r as RawRow));
}

/** Every open issue of an organization (non-deleted projects only). */
export async function listOpenByOrg(organizationId: string): Promise<HealthIssueRow[]> {
  const rows = await db
    .selectFrom('project_health_issues')
    .innerJoin('projects', 'projects.id', 'project_health_issues.project_id')
    .select(COLUMNS.map((c) => `project_health_issues.${c}` as const))
    .where('project_health_issues.organization_id', '=', organizationId)
    .where('projects.organization_id', '=', organizationId)
    .where('projects.deleted_at', 'is', null)
    .where('project_health_issues.resolved_at', 'is', null)
    .orderBy('project_health_issues.opened_at', 'asc')
    .execute();
  return rows.map((r) => mapRow(r as RawRow));
}
