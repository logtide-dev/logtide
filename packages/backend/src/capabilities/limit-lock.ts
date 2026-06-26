import { sql } from 'kysely';
import { db } from '../database/connection.js';

// Namespace for the (int4, int4) Postgres advisory lock keyspace used by
// capability limit enforcement, kept distinct from other advisory locks.
const CAP_LOCK_NAMESPACE = 0x4c54; // 'LT'

/** Deterministic 32-bit signed hash (FNV-1a) for advisory lock keys. */
function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0; // coerce to signed int32 for pg_advisory_xact_lock(int4, int4)
}

// In-process serialization tails, keyed by org+capability. This bounds the
// number of callers that block on the DB advisory lock to ONE per key per
// process, so concurrent requests don't each hold a transaction connection
// while waiting (which would exhaust the pool).
const localTails = new Map<string, Promise<void>>();

async function runExclusiveInProcess<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prevTail = localTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  localTails.set(key, tail);
  await prevTail; // wait for the previous holder of this key
  try {
    return await fn();
  } finally {
    release();
    // Drop the entry once we are the last in line, to keep the map bounded.
    if (localTails.get(key) === tail) localTails.delete(key);
  }
}

/**
 * Serialize a "count current usage -> assert under limit -> create" sequence
 * against concurrent callers for the same (organization, capability).
 *
 * The enforcement pattern (COUNT -> assertWithinLimit -> insert) is a
 * check-then-act: without serialization, parallel requests can each read a count
 * below the limit and then all insert, pushing usage past a finite cap.
 *
 * Serialization happens at two levels: an in-process mutex per org+capability
 * (so within one backend instance only one such create runs at a time, and
 * waiters do not hold a database connection while queued), wrapping a
 * transaction-scoped Postgres advisory lock on the same key (so the guarantee
 * also holds across multiple backend instances sharing the database). The
 * advisory lock is released automatically on commit/rollback.
 *
 * Different organizations and different capabilities use distinct keys and do
 * not contend. When no finite limit is configured (the OSS default) the only
 * added cost is one advisory lock/unlock round-trip.
 */
export async function withLimitLock<T>(
  organizationId: string,
  capabilityKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${organizationId}:${capabilityKey}`;
  const key2 = hash32(key);
  return runExclusiveInProcess(key, () =>
    db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${key2})`.execute(trx);
      return fn();
    }),
  );
}
