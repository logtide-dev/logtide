/**
 * hardware_hosts persistence. Every query is scoped by organization (or by
 * the requesting user's memberships); the evaluation pass is a system job
 * and reads across organizations on purpose.
 */
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type {
  HardwareCollectorStatus,
  HardwareComponentKey,
  HardwareComponentSnapshots,
  HardwareComponentStatus,
  HardwareFinding,
  HardwareHostDetail,
  HardwareHostInfo,
  HardwareHostSummary,
  HardwareStatus,
} from '@logtide/shared';
import { HARDWARE_COMPONENT_KEYS, HARDWARE_WINDOW_24H_MS } from '@logtide/shared';
import { db } from '../../database/index.js';
import type { HardwareHostsTable } from '../../database/types.js';
import { componentStatuses, evaluateHost, type EvaluateHostResult } from './evaluator.js';

export type HardwareHostRow = Selectable<HardwareHostsTable>;

/** A host the evaluation pass looks at, with its project name. */
export interface DueHardwareHost {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  hostName: string;
  /** Effective (debounced) status. */
  status: HardwareStatus;
  muted: boolean;
  lastSeenAt: Date | null;
  lastEvaluatedAt: Date | null;
  pendingStatus: 'ok' | 'warning' | 'critical' | null;
  pendingSince: Date | null;
  episodeStartedAt: Date | null;
  episodeIncidentId: string | null;
}

/** What one evaluation pass writes on a host (compare-and-set, see saveHostState). */
export interface HostStatePatch {
  status: HardwareStatus;
  pendingStatus: 'ok' | 'warning' | 'critical' | null;
  pendingSince: Date | null;
  episodeStartedAt: Date | null;
  episodeIncidentId: string | null;
  /** The new snapshot; omitted when the pass brought no new data (stale or no point). */
  snapshot?: EvaluateHostResult;
}

function toIso(d: Date | string | null): string | null {
  if (d === null) return null;
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

/** Empty snapshot of a host that was never evaluated. */
function emptyComponents(): HardwareComponentSnapshots {
  return evaluateHost({ latest: [], history: [], now: new Date(0), lastSeenAt: null }).components;
}

function storedComponents(row: HardwareHostRow): HardwareComponentSnapshots {
  const c = row.components as Partial<HardwareComponentSnapshots>;
  const base = emptyComponents();
  const out = { ...base } as HardwareComponentSnapshots;
  for (const key of HARDWARE_COMPONENT_KEYS) {
    if (c && typeof c[key] === 'object' && c[key] !== null) {
      (out as unknown as Record<HardwareComponentKey, unknown>)[key] = c[key];
    }
  }
  return out;
}

function storedInfo(row: HardwareHostRow): HardwareHostInfo {
  const i = (row.info ?? {}) as Partial<HardwareHostInfo>;
  return {
    vendor: i.vendor ?? null,
    model: i.model ?? null,
    kernel: i.kernel ?? null,
    agentVersion: i.agentVersion ?? null,
  };
}

export function toHostSummary(row: HardwareHostRow): HardwareHostSummary {
  const components: Record<HardwareComponentKey, HardwareComponentStatus> = componentStatuses(storedComponents(row));
  return {
    id: row.id,
    hostName: row.host_name,
    projectId: row.project_id,
    status: row.status,
    components,
    isVirtual: row.is_virtual,
    info: storedInfo(row),
    lastSeenAt: toIso(row.last_seen_at),
    statusChangedAt: toIso(row.status_changed_at)!,
    muted: row.muted,
    findingsCount: Array.isArray(row.findings) ? row.findings.length : 0,
  };
}

export function toHostDetail(row: HardwareHostRow): HardwareHostDetail {
  return {
    ...toHostSummary(row),
    firstSeenAt: toIso(row.first_seen_at)!,
    lastEvaluatedAt: toIso(row.last_evaluated_at),
    snapshot: storedComponents(row),
    findings: (Array.isArray(row.findings) ? row.findings : []) as HardwareFinding[],
    collectors: (Array.isArray(row.collectors) ? row.collectors : []) as HardwareCollectorStatus[],
  };
}

/**
 * Hosts the evaluation pass covers: seen in the last 24 h, or currently
 * warning/critical (so a host that stopped reporting can still recover or go
 * stale). Projects that are soft-deleted are skipped.
 */
export async function listDueHosts(now: Date): Promise<DueHardwareHost[]> {
  const since = new Date(now.getTime() - HARDWARE_WINDOW_24H_MS);
  const rows = await db
    .selectFrom('hardware_hosts')
    .innerJoin('projects', (join) =>
      join
        .onRef('projects.id', '=', 'hardware_hosts.project_id')
        .onRef('projects.organization_id', '=', 'hardware_hosts.organization_id')
    )
    .select([
      'hardware_hosts.id',
      'hardware_hosts.organization_id',
      'hardware_hosts.project_id',
      'hardware_hosts.host_name',
      'hardware_hosts.status',
      'hardware_hosts.muted',
      'hardware_hosts.last_seen_at',
      'hardware_hosts.last_evaluated_at',
      'hardware_hosts.pending_status',
      'hardware_hosts.pending_since',
      'hardware_hosts.episode_started_at',
      'hardware_hosts.episode_incident_id',
      'projects.name as project_name',
    ])
    // tenant-scope-ok: system cron, evaluates the hardware hosts of every organization
    .where('projects.deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('hardware_hosts.last_seen_at', '>=', since),
        eb('hardware_hosts.status', 'in', ['warning', 'critical']),
      ])
    )
    .orderBy('hardware_hosts.project_id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    projectId: r.project_id,
    projectName: r.project_name,
    hostName: r.host_name,
    status: r.status,
    muted: r.muted,
    lastSeenAt: r.last_seen_at,
    lastEvaluatedAt: r.last_evaluated_at,
    pendingStatus: r.pending_status,
    pendingSince: r.pending_since,
    episodeStartedAt: r.episode_started_at,
    episodeIncidentId: r.episode_incident_id,
  }));
}

/**
 * Persists one pass with a compare-and-set on what the pass read (status,
 * last_evaluated_at, muted and the episode start): the row is written only
 * when none of them changed meanwhile. Returns false when another worker (or
 * a mute/unmute) got there first; the caller then skips every side effect,
 * so a transition is acted on exactly once.
 * Without `patch.snapshot` (stale host, or no point in the latest window)
 * the last components, findings, info and collectors are kept.
 */
export async function saveHostState(
  host: Pick<DueHardwareHost, 'id' | 'organizationId' | 'status' | 'lastEvaluatedAt' | 'muted' | 'episodeStartedAt'>,
  patch: HostStatePatch,
  now: Date
): Promise<boolean> {
  const snap = patch.snapshot;
  const row = await db
    .updateTable('hardware_hosts')
    .set({
      status: patch.status,
      pending_status: patch.pendingStatus,
      pending_since: patch.pendingSince,
      episode_started_at: patch.episodeStartedAt,
      episode_incident_id: patch.episodeIncidentId,
      ...(snap && {
        components: JSON.stringify(snap.components),
        findings: JSON.stringify(snap.findings),
        info: JSON.stringify(snap.info),
        collectors: JSON.stringify(snap.collectors),
        // Keep the last known value when this pass saw no hw.host.info point.
        is_virtual: snap.isVirtual === null ? sql<boolean | null>`hardware_hosts.is_virtual` : snap.isVirtual,
      }),
      last_evaluated_at: now,
      ...(patch.status !== host.status && { status_changed_at: now }),
      updated_at: now,
    })
    .where('id', '=', host.id)
    .where('organization_id', '=', host.organizationId)
    .where('status', '=', host.status)
    .where('muted', '=', host.muted)
    .where(sql<boolean>`last_evaluated_at is not distinct from ${host.lastEvaluatedAt}`)
    .where(sql<boolean>`episode_started_at is not distinct from ${host.episodeStartedAt}`)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Links the incident of the current episode to the host. Only while that
 * episode is still the current one (an unmute starts a new one).
 */
export async function setEpisodeIncident(
  host: Pick<DueHardwareHost, 'id' | 'organizationId'>,
  episodeStartedAt: Date,
  incidentId: string
): Promise<void> {
  await db
    .updateTable('hardware_hosts')
    .set({ episode_incident_id: incidentId })
    .where('id', '=', host.id)
    .where('organization_id', '=', host.organizationId)
    .where('episode_started_at', '=', episodeStartedAt)
    .execute();
}

/** Hosts of a project, worst first then by name. The caller checked access to the project. */
export async function listHostsByProject(projectId: string, organizationId: string): Promise<HardwareHostRow[]> {
  return db
    .selectFrom('hardware_hosts')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('organization_id', '=', organizationId)
    .orderBy(
      sql`case status when 'critical' then 0 when 'warning' then 1 when 'stale' then 2 when 'unknown' then 3 else 4 end`
    )
    .orderBy('host_name')
    .execute();
}

/**
 * A host by id, only when `userId` is a member of its organization (else
 * undefined, so other organizations see a 404). Returns the caller's role.
 */
export async function findHostForUser(
  id: string,
  userId: string
): Promise<{ row: HardwareHostRow; role: string } | undefined> {
  const found = await db
    .selectFrom('hardware_hosts')
    .innerJoin('organization_members', (join) =>
      join
        .onRef('organization_members.organization_id', '=', 'hardware_hosts.organization_id')
        .on('organization_members.user_id', '=', userId)
    )
    .innerJoin('projects', (join) =>
      join
        .onRef('projects.id', '=', 'hardware_hosts.project_id')
        .onRef('projects.organization_id', '=', 'hardware_hosts.organization_id')
    )
    .selectAll('hardware_hosts')
    .select('organization_members.role as member_role')
    .where('hardware_hosts.id', '=', id)
    .where('projects.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!found) return undefined;
  const { member_role, ...row } = found;
  return { row: row as HardwareHostRow, role: member_role };
}

/**
 * Mutes or unmutes a host. Unmuting a degraded host starts a new
 * notification episode: the next pass reconciles it like a fresh
 * degradation (opens an incident and notifies when none is active).
 */
export async function setHostMuted(id: string, organizationId: string, muted: boolean): Promise<HardwareHostRow | undefined> {
  const now = new Date();
  return db
    .updateTable('hardware_hosts')
    .set({
      muted,
      ...(!muted && {
        episode_started_at: sql<Date | null>`case when hardware_hosts.muted and hardware_hosts.status in ('warning', 'critical') then ${now}::timestamptz else hardware_hosts.episode_started_at end`,
        episode_incident_id: sql<string | null>`case when hardware_hosts.muted and hardware_hosts.status in ('warning', 'critical') then null else hardware_hosts.episode_incident_id end`,
      }),
      updated_at: now,
    })
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .returningAll()
    .executeTakeFirst();
}

/** The active (open or investigating) hardware incident of a host, or undefined. */
export async function activeHardwareIncident(
  organizationId: string,
  hostId: string
): Promise<{ id: string; severity: string } | undefined> {
  return db
    .selectFrom('incidents')
    .select(['id', 'severity'])
    .where('organization_id', '=', organizationId)
    .where('source', '=', 'hardware')
    .where('hardware_host_id', '=', hostId)
    .where('status', 'in', ['open', 'investigating'])
    .executeTakeFirst();
}

export async function deleteHost(id: string, organizationId: string): Promise<boolean> {
  const res = await db
    .deleteFrom('hardware_hosts')
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  return Number(res.numDeletedRows) > 0;
}
