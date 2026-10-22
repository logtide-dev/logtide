import type { IncidentListItem } from '@logtide/shared';
import { incidentsAPI, type BulkAction } from '$lib/api/incidents';
import { DEFAULT_STATUS_FILTER, type InboxUrlState } from './incident-model';

/** True when the state differs from the inbox defaults (scope and page excluded). */
export function hasActiveFilters(state: InboxUrlState): boolean {
  const defaultStatus =
    state.status !== 'all' &&
    state.status.length === DEFAULT_STATUS_FILTER.length &&
    DEFAULT_STATUS_FILTER.every((s) => (state.status as string[]).includes(s));
  return (
    !defaultStatus ||
    state.severity.length > 0 ||
    state.source.length > 0 ||
    state.assignee !== 'anyone' ||
    !!state.service ||
    !!state.technique ||
    !!state.ruleId
  );
}

/** Defaults for every filter, keeping the project scope. */
export function clearedState(state: InboxUrlState): InboxUrlState {
  return {
    projectIds: state.projectIds,
    status: [...DEFAULT_STATUS_FILTER],
    severity: [],
    source: [],
    assignee: 'anyone',
    page: 1,
  };
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return Math.min(Math.max(1, page), pages);
}

/**
 * Decides whether a realtime `incident_created` belongs in the visible list.
 * Anything beyond the first page is never prepended (it would shift the rows),
 * and a rule filter cannot be evaluated client side, so it rejects.
 */
export function matchesInbox(
  incident: IncidentListItem,
  state: InboxUrlState,
  userId: string | null
): boolean {
  if (state.page > 1 || state.ruleId) return false;
  if (state.status !== 'all' && !state.status.includes(incident.status)) return false;
  if (state.severity.length > 0 && !state.severity.includes(incident.severity)) return false;
  if (state.source.length > 0 && !(state.source as string[]).includes(incident.source)) return false;
  if (state.projectIds.length > 0) {
    if (!incident.projectId || !state.projectIds.includes(incident.projectId)) return false;
  }
  if (state.assignee === 'unassigned' && incident.assigneeId) return false;
  if (state.assignee === 'me' && (!userId || incident.assigneeId !== userId)) return false;
  if (state.service && !(incident.affectedServices ?? []).includes(state.service)) return false;
  if (state.technique && !(incident.mitreTechniques ?? []).includes(state.technique)) return false;
  return true;
}

export interface BulkOutcome {
  requested: number;
  updated: number;
  skipped: { id: string; title: string; reason: 'not_found' | 'invalid_transition' }[];
  message: string;
  /** success when every row changed, warning otherwise. */
  tone: 'success' | 'warning';
}

const SKIP_REASON: Record<'not_found' | 'invalid_transition', string> = {
  not_found: 'not found',
  invalid_transition: 'cannot change from its current status',
};

const noun = (n: number): string => (n === 1 ? 'incident' : 'incidents');

export function summarizeBulk(
  action: BulkAction,
  assigneeId: string | null | undefined,
  requested: string[],
  result: { updated: { id: string }[]; skipped: { id: string; reason: 'not_found' | 'invalid_transition' }[] },
  titleOf: (id: string) => string
): BulkOutcome {
  const updated = result.updated.length;
  const skipped = result.skipped.map((s) => ({ ...s, title: titleOf(s.id) }));
  // Ids neither updated nor reported skipped still count as failures.
  const accounted = new Set([...result.updated.map((u) => u.id), ...result.skipped.map((s) => s.id)]);
  for (const id of requested) {
    if (!accounted.has(id)) skipped.push({ id, title: titleOf(id), reason: 'not_found' });
  }

  if (skipped.length === 0) {
    const verb =
      action === 'acknowledge'
        ? 'Acknowledged'
        : action === 'resolve'
          ? 'Resolved'
          : assigneeId
            ? 'Assigned'
            : 'Unassigned';
    return {
      requested: requested.length,
      updated,
      skipped,
      message: `${verb} ${updated.toLocaleString('en-US')} ${noun(updated)}`,
      tone: 'success',
    };
  }

  const shown = skipped
    .slice(0, 3)
    .map((s) => `${s.title} (${SKIP_REASON[s.reason]})`)
    .join(', ');
  const more = skipped.length > 3 ? ` and ${(skipped.length - 3).toLocaleString('en-US')} more` : '';
  return {
    requested: requested.length,
    updated,
    skipped,
    message: `${updated.toLocaleString('en-US')} of ${requested.length.toLocaleString('en-US')} updated. Skipped: ${shown}${more}`,
    tone: 'warning',
  };
}

export async function runBulk(input: {
  organizationId: string;
  ids: string[];
  action: BulkAction;
  assigneeId?: string | null;
  titleOf: (id: string) => string;
}): Promise<BulkOutcome> {
  const result = await incidentsAPI.bulk({
    organizationId: input.organizationId,
    ids: input.ids,
    action: input.action,
    ...(input.action === 'assign' ? { assigneeId: input.assigneeId ?? null } : {}),
  });
  return summarizeBulk(input.action, input.assigneeId, input.ids, result, input.titleOf);
}
