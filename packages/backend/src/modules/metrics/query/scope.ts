// Project scope of a metrics query: which projects of the organization the
// query reads.
//
// Reading: projectIds null -> every non-deleted project of the organization.
// Explicit ids must belong to the organization (else MetricScopeError, 403);
// ids of projects deleted since the query was saved (a dashboard panel, an
// alert rule, a shared link) are dropped with a warning instead of failing
// the whole panel.
// Saving (custom-dashboards assertMetricsProjectsInOrg) rejects deleted ids.

import { db } from '../../../database/index.js';
import { MetricScopeError } from './errors.js';

export interface ProjectScope {
  projectIds: string[];
  warnings: string[];
}

export function deletedProjectsWarning(count: number): string {
  return count === 1
    ? 'A selected project was deleted and is skipped'
    : `${count} selected projects were deleted and are skipped`;
}

/**
 * Resolve the projects a query reads, with warnings for dropped (deleted)
 * ids. No membership check: callers that act for a user use
 * resolveProjectScopeDetailed / resolveProjectScope.
 */
export async function resolveOrgProjectScope(
  organizationId: string,
  projectIds: string[] | null,
): Promise<ProjectScope> {
  if (projectIds === null) {
    const rows = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .execute();
    return { projectIds: rows.map((r) => r.id).sort(), warnings: [] };
  }
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return { projectIds: [], warnings: [] };
  const rows = await db
    .selectFrom('projects')
    .select(['id', 'deleted_at'])
    .where('organization_id', '=', organizationId)
    .where('id', 'in', unique)
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const live: string[] = [];
  let deleted = 0;
  for (const id of unique) {
    const row = byId.get(id);
    if (!row) throw new MetricScopeError('Access denied - project not found in this organization');
    if (row.deleted_at) deleted++;
    else live.push(id);
  }
  return { projectIds: live.sort(), warnings: deleted > 0 ? [deletedProjectsWarning(deleted)] : [] };
}

/** resolveOrgProjectScope without the warnings. */
export async function resolveOrgProjects(organizationId: string, projectIds: string[] | null): Promise<string[]> {
  return (await resolveOrgProjectScope(organizationId, projectIds)).projectIds;
}

export async function isOrgMember(organizationId: string, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('organization_members')
    .select('user_id')
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return !!row;
}

export async function resolveProjectScopeDetailed(
  organizationId: string,
  userId: string,
  projectIds: string[] | null,
): Promise<ProjectScope> {
  if (!(await isOrgMember(organizationId, userId))) {
    throw new MetricScopeError('Access denied - you are not a member of this organization');
  }
  return resolveOrgProjectScope(organizationId, projectIds);
}

export async function resolveProjectScope(
  organizationId: string,
  userId: string,
  projectIds: string[] | null,
): Promise<string[]> {
  return (await resolveProjectScopeDetailed(organizationId, userId, projectIds)).projectIds;
}
