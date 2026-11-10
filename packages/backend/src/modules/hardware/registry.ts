/**
 * Hardware host registry: hosts register themselves by sending `hw.*` metrics.
 *
 * Called from the metrics ingest path after the batch is stored. It never
 * throws and never blocks ingestion: the caller does not await it, every
 * error is logged and swallowed. Upserts are throttled in process to one per
 * (project, host) every REGISTRATION_THROTTLE_MS; `last_seen_at` is the server
 * receive time, so a sender with a wrong clock still counts as alive.
 */
import { sql } from 'kysely';
import { hub } from '@logtide/core';
import { isHardwareMetric } from '@logtide/shared';
import { db } from '../../database/index.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';

export const REGISTRATION_THROTTLE_MS = 60_000;
/** Upper bound of the throttle map; the oldest entries are dropped first. */
export const REGISTRATION_THROTTLE_MAX_ENTRIES = 10_000;
/** Matches the hardware_hosts.host_name check. */
const MAX_HOST_NAME_LENGTH = 255;
const UPSERT_CHUNK = 500;

const lastRegistered = new Map<string, number>();

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

export function hardwareRegistrationThrottleSize(): number {
  return lastRegistered.size;
}

/**
 * Upsert the hosts of a batch into hardware_hosts. Resolves once done; never
 * rejects. Returns the host names actually written (throttled ones skipped).
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
    // Optimistic: concurrent batches of the same host do not pile up.
    for (const name of due) remember(`${projectId}\u0000${name}`, nowMs);

    for (let i = 0; i < due.length; i += UPSERT_CHUNK) {
      await db
        .insertInto('hardware_hosts')
        .values(
          due.slice(i, i + UPSERT_CHUNK).map((name) => ({
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
    return due;
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
