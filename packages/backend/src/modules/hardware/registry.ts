/**
 * Hardware host registry: hosts register themselves by sending `hw.*` metrics.
 *
 * Called from the metrics ingest path after the batch is stored. It never
 * throws and never blocks ingestion: the caller does not await it, every
 * error is logged and swallowed. Upserts are throttled in process to one per
 * (project, host) every REGISTRATION_THROTTLE_MS; `last_seen_at` is the server
 * receive time, so a sender with a wrong clock still counts as alive.
 * New hosts beyond the hardware.max_hosts capability of the organization are
 * not registered (and so never evaluated); the batch itself is always stored.
 */
import { sql } from 'kysely';
import { hub } from '@logtide/core';
import { isHardwareMetric } from '@logtide/shared';
import { db } from '../../database/index.js';
import { capabilities } from '../../capabilities/facade.js';
import { withLimitLock } from '../../capabilities/limit-lock.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';

export const REGISTRATION_THROTTLE_MS = 60_000;
/** Upper bound of the throttle map; the oldest entries are dropped first. */
export const REGISTRATION_THROTTLE_MAX_ENTRIES = 10_000;
/** Matches the hardware_hosts.host_name check. */
const MAX_HOST_NAME_LENGTH = 255;
const UPSERT_CHUNK = 500;

const HOST_LIMIT = 'hardware.max_hosts' as const;
/** A refused registration is logged at most once per project in this window. */
const LIMIT_LOG_INTERVAL_MS = 60 * 60_000;

const lastRegistered = new Map<string, number>();
const lastLimitLog = new Map<string, number>();

interface MetricLike {
  metricName: string;
  attributes?: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
}

/**
 * The host name exactly as sent, never trimmed: the evaluation loader and the
 * events query match `host.name` (and the log hostname) byte for byte, so a
 * trimmed registry name would never find its own data. Blank (empty or
 * whitespace only) and over-long names are rejected.
 */
function hostNameOf(record: MetricLike): string | null {
  const raw = record.attributes?.['host.name'] ?? record.resourceAttributes?.['host.name'];
  if (typeof raw !== 'string') return null;
  if (raw.trim().length === 0 || raw.length > MAX_HOST_NAME_LENGTH) return null;
  return raw;
}

/** Distinct host names of the `hw.*` points of a batch. */
export function hardwareHostNames(records: readonly MetricLike[]): string[] {
  const names = new Set<string>();
  for (const r of records) {
    if (!isHardwareMetric(r.metricName)) continue;
    const name = hostNameOf(r);
    if (name) names.add(name);
  }
  return [...names];
}

function remember(key: string, at: number): void {
  lastRegistered.delete(key);
  lastRegistered.set(key, at);
  while (lastRegistered.size > REGISTRATION_THROTTLE_MAX_ENTRIES) {
    const oldest = lastRegistered.keys().next().value;
    if (oldest === undefined) break;
    lastRegistered.delete(oldest);
  }
}

/** Test hook: forget every throttle entry. */
export function resetHardwareRegistrationThrottle(): void {
  lastRegistered.clear();
}

/** Test hook: forget when the limit was last logged. */
export function resetHardwareLimitLog(): void {
  lastLimitLog.clear();
}

export function hardwareRegistrationThrottleSize(): number {
  return lastRegistered.size;
}

async function upsertHosts(names: string[], projectId: string, organizationId: string, now: Date): Promise<void> {
  for (let i = 0; i < names.length; i += UPSERT_CHUNK) {
    await db
      .insertInto('hardware_hosts')
      .values(
        names.slice(i, i + UPSERT_CHUNK).map((name) => ({
          organization_id: organizationId,
          project_id: projectId,
          host_name: name,
          last_seen_at: now,
          first_seen_at: now,
        }))
      )
      .onConflict((oc) =>
        oc.columns(['project_id', 'host_name']).doUpdateSet({
          last_seen_at: sql`greatest(hardware_hosts.last_seen_at, excluded.last_seen_at)`,
          updated_at: sql`now()`,
        })
      )
      .execute();
  }
}

/**
 * The names of a batch allowed under hardware.max_hosts: hosts already
 * registered always (they keep reporting), new ones while the organization
 * has room, in batch order. Fail closed: no room means not registered.
 */
async function admitHosts(names: string[], projectId: string, organizationId: string, limit: number): Promise<string[]> {
  const known = new Set<string>();
  for (let i = 0; i < names.length; i += UPSERT_CHUNK) {
    const rows = await db
      .selectFrom('hardware_hosts')
      .select('host_name')
      .where('organization_id', '=', organizationId)
      .where('project_id', '=', projectId)
      .where('host_name', 'in', names.slice(i, i + UPSERT_CHUNK))
      .execute();
    for (const r of rows) known.add(r.host_name);
  }
  if (known.size === names.length) return names;

  const counted = await db
    .selectFrom('hardware_hosts')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  let room = Math.max(0, limit - (counted?.n ?? 0));
  return names.filter((name) => {
    if (known.has(name)) return true;
    if (room === 0) return false;
    room--;
    return true;
  });
}

function logRefused(projectId: string, organizationId: string, refused: number, limit: number, nowMs: number): void {
  const last = lastLimitLog.get(projectId);
  if (last !== undefined && nowMs - last < LIMIT_LOG_INTERVAL_MS) return;
  lastLimitLog.delete(projectId);
  lastLimitLog.set(projectId, nowMs);
  while (lastLimitLog.size > REGISTRATION_THROTTLE_MAX_ENTRIES) {
    const oldest = lastLimitLog.keys().next().value;
    if (oldest === undefined) break;
    lastLimitLog.delete(oldest);
  }
  const message = `[Hardware] ${HOST_LIMIT} reached (${limit.toLocaleString('en-US')}), ${refused.toLocaleString('en-US')} new host(s) not registered`;
  console.warn(`${message} for project ${projectId}`);
  if (isInternalLoggingEnabled()) {
    hub.captureLog('warn', message, { projectId, organizationId, limit, refused });
  }
}

/**
 * Upsert the hosts of a batch into hardware_hosts. Resolves once done; never
 * rejects. Returns the host names actually written (throttled ones and the
 * ones refused by the hardware.max_hosts capability skipped).
 */
export async function registerHardwareHosts(
  records: readonly MetricLike[],
  projectId: string,
  organizationId: string,
  now: Date = new Date()
): Promise<string[]> {
  let due: string[] = [];
  try {
    const names = hardwareHostNames(records);
    if (names.length === 0) return [];

    const nowMs = now.getTime();
    due = names.filter((name) => {
      const last = lastRegistered.get(`${projectId}\u0000${name}`);
      return last === undefined || nowMs - last >= REGISTRATION_THROTTLE_MS;
    });
    if (due.length === 0) return [];
    // Optimistic: concurrent batches of the same host do not pile up. Hosts
    // refused by the limit stay throttled too, so a refused host costs one
    // check per minute, not one per batch.
    for (const name of due) remember(`${projectId}\u0000${name}`, nowMs);

    const limit = await capabilities.getLimit(organizationId, HOST_LIMIT);
    if (limit === null) {
      await upsertHosts(due, projectId, organizationId, now);
      return due;
    }
    // Count, admit and insert under the capability lock, so concurrent
    // batches cannot push the organization past its limit.
    const cap = limit;
    return await withLimitLock(organizationId, HOST_LIMIT, async () => {
      const admitted = await admitHosts(due, projectId, organizationId, cap);
      if (admitted.length < due.length) logRefused(projectId, organizationId, due.length - admitted.length, cap, nowMs);
      await upsertHosts(admitted, projectId, organizationId, now);
      return admitted;
    });
  } catch (error) {
    // Let the next batch retry.
    for (const name of due) lastRegistered.delete(`${projectId}\u0000${name}`);
    console.error('[Hardware] host registration failed:', error);
    if (isInternalLoggingEnabled()) {
      hub.captureLog('warn', '[Hardware] Host registration failed', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return [];
  }
}
