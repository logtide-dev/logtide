import { sql, type Kysely, type Transaction } from 'kysely';
import type { IncidentChangeReason } from '@logtide/shared';
import type { Database } from '../../database/types.js';

/**
 * Runs `fn` in a transaction where the incident history trigger (migration
 * 062) attributes every change to `actor.userId` (null = no user, e.g. an
 * alert rule or a monitor) and stores `actor.reason` as metadata.reason.
 * Both settings are transaction-local (`set_config(..., true)`), so they never
 * leak to another request served by the same pooled connection.
 */
export async function withIncidentActor<T>(
  db: Kysely<Database>,
  actor: { userId: string | null; reason?: IncidentChangeReason },
  fn: (trx: Transaction<Database>) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('logtide.actor_user_id', ${actor.userId ?? ''}, true), set_config('logtide.change_reason', ${actor.reason ?? ''}, true)`.execute(
      trx
    );
    return fn(trx);
  });
}
