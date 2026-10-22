import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import { metricsService } from '../metrics/service.js';
import { tracesService } from '../traces/service.js';

export type PickerKind = 'metric-names' | 'services';
export type PickerSource = 'logs' | 'traces' | 'metrics';

export const PICKER_KINDS: readonly PickerKind[] = ['metric-names', 'services'];
export const PICKER_SOURCES: readonly PickerSource[] = ['logs', 'traces', 'metrics'];

const MAX_OPTIONS = 500;
const MAX_ORG_PROJECTS = 50;
const MAX_TRACE_PROJECTS = 20;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the project exists and belongs to the organization. */
export async function projectBelongsToOrg(
  projectId: string,
  organizationId: string
): Promise<boolean> {
  const row = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', projectId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  return !!row;
}

async function resolveProjectIds(
  organizationId: string,
  projectId: string | null | undefined
): Promise<string[]> {
  if (projectId) {
    return (await projectBelongsToOrg(projectId, organizationId)) ? [projectId] : [];
  }
  const rows = await db
    .selectFrom('projects')
    .select('id')
    .where('organization_id', '=', organizationId)
    .orderBy('created_at', 'asc')
    .limit(MAX_ORG_PROJECTS)
    .execute();
  return rows.map((r) => r.id);
}

function finalize(values: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) unique.add(v);
  }
  return [...unique].sort().slice(0, MAX_OPTIONS);
}

async function logServices(ids: string[], from: Date, to: Date): Promise<string[]> {
  const res = await reservoir.distinct({ field: 'service', projectId: ids, from, to });
  return res.values;
}

async function traceServices(ids: string[], from: Date): Promise<string[]> {
  const out: string[] = [];
  for (const pid of ids.slice(0, MAX_TRACE_PROJECTS)) {
    out.push(...(await tracesService.getServices(pid, from)));
  }
  return out;
}

/**
 * Suggestions for the dashboard panel form pickers. Always scoped to the
 * organization: an explicit projectId must belong to it (the route rejects a
 * foreign one with 400), otherwise at most 50 of the org's projects are used.
 */
export async function listPickerOptions(params: {
  organizationId: string;
  projectId?: string | null;
  kind: PickerKind;
  source?: PickerSource;
}): Promise<string[]> {
  const ids = await resolveProjectIds(params.organizationId, params.projectId);
  if (ids.length === 0) return [];

  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_MS);

  if (params.kind === 'metric-names') {
    const res = await metricsService.listMetricNames(ids, from, to);
    return finalize(res.names.map((n) => n.name));
  }

  const source = params.source ?? 'logs';
  if (source === 'logs') return finalize(await logServices(ids, from, to));
  if (source === 'traces') return finalize(await traceServices(ids, from));

  // metrics: the reservoir has no distinct-service query for metric points on
  // every engine, so offer the union of log and trace services, which are the
  // names an instrumented service reports under in practice.
  const [l, t] = await Promise.all([logServices(ids, from, to), traceServices(ids, from)]);
  return finalize([...l, ...t]);
}
