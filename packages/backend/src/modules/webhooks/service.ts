/**
 * Persistence for webhook deliveries (#218). One logical delivery row plus a
 * bounded per-delivery attempt log. The DLQ is simply status='dead'.
 */
import { db } from '../../database/connection.js';
import type { Selectable } from 'kysely';
import type { WebhookDeliveriesTable, WebhookDeliveryAttemptsTable } from '../../database/types.js';

export type DeliveryRow = Selectable<WebhookDeliveriesTable>;
export type DeliveryAttemptRow = Selectable<WebhookDeliveryAttemptsTable>;

interface CreateDeliveryInput {
  organizationId: string;
  eventType: string;
  eventId: string;
  url: string;
  maxAttempts: number;
  metadata?: Record<string, unknown>;
}

interface RecordAttemptInput {
  attemptNumber: number;
  statusCode?: number | null;
  durationMs?: number | null;
  responseExcerpt?: string | null;
  error?: string | null;
}

interface ListOptions {
  status?: string;
  limit: number;
  offset: number;
}

export const webhookDeliveryService = {
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryRow> {
    return db
      .insertInto('webhook_deliveries')
      .values({
        organization_id: input.organizationId,
        event_type: input.eventType,
        event_id: input.eventId,
        url: input.url,
        status: 'pending',
        attempt_count: 0,
        max_attempts: input.maxAttempts,
        metadata: input.metadata ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  /**
   * Find a delivery for the same logical event that is still in flight and was
   * created after `since`. Used to suppress double-enqueues without letting the
   * suppression outlive the event: terminal rows (delivered, dead) and rows
   * older than the window never match.
   */
  async findInFlightDelivery(input: {
    organizationId: string;
    eventType: string;
    eventId: string;
    since: Date;
  }): Promise<DeliveryRow | undefined> {
    return db
      .selectFrom('webhook_deliveries')
      .selectAll()
      .where('organization_id', '=', input.organizationId)
      .where('event_type', '=', input.eventType)
      .where('event_id', '=', input.eventId)
      .where('status', 'in', ['pending', 'failed'])
      .where('created_at', '>=', input.since)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  },

  async getDelivery(id: string): Promise<DeliveryRow | undefined> {
    return db.selectFrom('webhook_deliveries').selectAll().where('id', '=', id).executeTakeFirst();
  },

  async recordAttempt(deliveryId: string, input: RecordAttemptInput, logLimit: number): Promise<void> {
    await db
      .insertInto('webhook_delivery_attempts')
      .values({
        delivery_id: deliveryId,
        attempt_number: input.attemptNumber,
        status_code: input.statusCode ?? null,
        duration_ms: input.durationMs ?? null,
        response_excerpt: input.responseExcerpt ?? null,
        error: input.error ?? null,
      })
      .execute();

    // Prune to the last `logLimit` attempts for this delivery.
    // Order by created_at desc, attempt_number desc for determinism when timestamps collide.
    const keep = await db
      .selectFrom('webhook_delivery_attempts')
      .select('id')
      .where('delivery_id', '=', deliveryId)
      .orderBy('created_at', 'desc')
      .orderBy('attempt_number', 'desc')
      .limit(logLimit)
      .execute();
    const keepIds = keep.map((r) => r.id);
    if (keepIds.length > 0) {
      await db
        .deleteFrom('webhook_delivery_attempts')
        .where('delivery_id', '=', deliveryId)
        .where('id', 'not in', keepIds)
        .execute();
    }
  },

  async markDelivered(id: string): Promise<void> {
    await db
      .updateTable('webhook_deliveries')
      .set({ status: 'delivered', updated_at: new Date(), next_attempt_at: null })
      .where('id', '=', id)
      .execute();
  },

  async markRetrying(id: string, attemptCount: number, nextAttemptAt: Date, lastError: string): Promise<void> {
    await db
      .updateTable('webhook_deliveries')
      .set({ status: 'failed', attempt_count: attemptCount, next_attempt_at: nextAttemptAt, last_error: lastError, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  },

  async markDead(id: string, attemptCount: number, lastError: string): Promise<void> {
    await db
      .updateTable('webhook_deliveries')
      .set({ status: 'dead', attempt_count: attemptCount, next_attempt_at: null, last_error: lastError, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  },

  async resetForReplay(id: string): Promise<DeliveryRow | undefined> {
    return db
      .updateTable('webhook_deliveries')
      .set({ status: 'pending', attempt_count: 0, next_attempt_at: null, last_error: null, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  },

  async listDeliveries(organizationId: string, opts: ListOptions): Promise<DeliveryRow[]> {
    let q = db
      .selectFrom('webhook_deliveries')
      .selectAll()
      .where('organization_id', '=', organizationId);
    if (opts.status) q = q.where('status', '=', opts.status);
    return q.orderBy('created_at', 'desc').limit(opts.limit).offset(opts.offset).execute();
  },

  async listAttempts(deliveryId: string): Promise<DeliveryAttemptRow[]> {
    return db
      .selectFrom('webhook_delivery_attempts')
      .selectAll()
      .where('delivery_id', '=', deliveryId)
      .orderBy('created_at', 'desc')
      .execute();
  },
};

/**
 * Strip delivery-internal secrets from a row's metadata before it crosses the
 * API boundary. The worker reads `signingSecret`/`headers` from metadata to send
 * the request, but those must never be returned to API clients.
 */
export function redactDeliveryForApi<T extends DeliveryRow | undefined>(row: T): T {
  if (!row) return row;
  const metadata = row.metadata as Record<string, unknown> | null;
  if (!metadata) return row;
  const { signingSecret: _s, headers: _h, ...safe } = metadata;
  return { ...row, metadata: safe };
}
