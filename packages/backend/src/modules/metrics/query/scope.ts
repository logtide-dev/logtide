// Project scope of a metrics query: which projects of the organization the
// query reads.

import { db } from '../../../database/index.js';
import { MetricScopeError } from './errors.js';

/**
 * projectIds null -> every non-deleted project of the organization; explicit
 * ids must all be non-deleted projects of it. No membership check: callers
 * that act for a user use resolveProjectScope.
 */
export async function resolveOrgProjects(organizationId: string, projectIds: string[] | null): Promise<string[]> {
  const rows = await db
    .selectFrom('projects')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute();
  const owned = new Set(rows.map((r) => r.id));
  if (projectIds === null) return [...owned].sort();
  const unique = [...new Set(projectIds)];
  for (const id of unique) {
    if (!owned.has(id)) throw new MetricScopeError('Access denied - project not found in this organization');
  }
  return unique.sort();
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

export async function resolveProjectScope(
  organizationId: string,
  userId: string,
  projectIds: string[] | null,
): Promise<string[]> {
  if (!(await isOrgMember(organizationId, userId))) {
    throw new MetricScopeError('Access denied - you are not a member of this organization');
  }
  return resolveOrgProjects(organizationId, projectIds);
}
