import crypto from 'crypto';
import type { LogInput, ReceiverAdapterType, ReceiverFieldMapping } from '@logtide/shared';
import { db } from '../../database/connection.js';

export interface Receiver {
  id: string;
  projectId: string;
  name: string;
  adapterType: ReceiverAdapterType;
  fieldMapping: ReceiverFieldMapping | null;
  enabled: boolean;
  createdAt: Date;
  lastReceivedAt: Date | null;
}

export interface IngestReceiver {
  id: string;
  projectId: string;
  organizationId: string;
  name: string;
  adapterType: ReceiverAdapterType;
  fieldMapping: ReceiverFieldMapping | null;
  enabled: boolean;
  tokenHash: string;
}

export type ReceiverEventStatus = 'pending' | 'processed' | 'skipped' | 'failed';

export interface ReceiverEvent {
  id: string;
  receiverId: string;
  status: ReceiverEventStatus;
  rawPayload: Record<string, unknown>;
  normalized: unknown | null;
  error: string | null;
  receivedAt: Date;
}

export interface EventWithReceiver extends IngestReceiver {
  eventId: string;
  status: ReceiverEventStatus;
  rawPayload: Record<string, unknown>;
}

export interface CreateReceiverInput {
  projectId: string;
  name: string;
  adapterType: ReceiverAdapterType;
  fieldMapping?: ReceiverFieldMapping | null;
}

export class ReceiversService {
  static readonly MAX_EVENTS_PER_RECEIVER = 100;

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  generateToken(): string {
    return `lr_${crypto.randomBytes(32).toString('hex')}`;
  }

  /** Timing-safe comparison of a presented token against the stored hash. */
  tokenMatches(token: string, tokenHash: string): boolean {
    const presented = Buffer.from(this.hashToken(token), 'hex');
    const stored = Buffer.from(tokenHash, 'hex');
    return presented.length === stored.length && crypto.timingSafeEqual(presented, stored);
  }

  async createReceiver(input: CreateReceiverInput): Promise<{ id: string; token: string }> {
    const token = this.generateToken();
    const result = await db
      .insertInto('receivers')
      .values({
        project_id: input.projectId,
        name: input.name,
        adapter_type: input.adapterType,
        token_hash: this.hashToken(token),
        field_mapping: input.fieldMapping ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: result.id, token };
  }

  async listReceivers(projectId: string): Promise<Receiver[]> {
    const rows = await db
      .selectFrom('receivers')
      .select([
        'id',
        'project_id',
        'name',
        'adapter_type',
        'field_mapping',
        'enabled',
        'created_at',
        'last_received_at',
      ])
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      adapterType: r.adapter_type as ReceiverAdapterType,
      fieldMapping: (r.field_mapping as ReceiverFieldMapping | null) ?? null,
      enabled: r.enabled,
      createdAt: new Date(r.created_at),
      lastReceivedAt: r.last_received_at ? new Date(r.last_received_at) : null,
    }));
  }

  async updateReceiver(
    id: string,
    projectId: string,
    patch: { name?: string; enabled?: boolean; fieldMapping?: ReceiverFieldMapping | null }
  ): Promise<boolean> {
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.fieldMapping !== undefined) values.field_mapping = patch.fieldMapping;
    if (Object.keys(values).length === 0) return false;
    const result = await db
      .updateTable('receivers')
      .set(values)
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows || 0) > 0;
  }

  async deleteReceiver(id: string, projectId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('receivers')
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return Number(result.numDeletedRows || 0) > 0;
  }

  /** Count receivers across all projects of an organization (capability limit input). */
  async countReceiversForOrg(organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('receivers')
      .innerJoin('projects', 'projects.id', 'receivers.project_id')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('projects.organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** Load a receiver for the public ingest endpoint (org derived via projects join). */
  async getReceiverForIngest(receiverId: string): Promise<IngestReceiver | null> {
    const row = await db
      .selectFrom('receivers')
      .innerJoin('projects', 'projects.id', 'receivers.project_id')
      .select([
        'receivers.id',
        'receivers.project_id',
        'receivers.name',
        'receivers.adapter_type',
        'receivers.field_mapping',
        'receivers.enabled',
        'receivers.token_hash',
        'projects.organization_id',
      ])
      .where('receivers.id', '=', receiverId)
      .where('projects.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      name: row.name,
      adapterType: row.adapter_type as ReceiverAdapterType,
      fieldMapping: (row.field_mapping as ReceiverFieldMapping | null) ?? null,
      enabled: row.enabled,
      tokenHash: row.token_hash,
    };
  }

  async recordEvent(receiverId: string, rawPayload: Record<string, unknown>): Promise<string> {
    const result = await db
      .insertInto('receiver_events')
      .values({ receiver_id: receiverId, status: 'pending', raw_payload: rawPayload })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return result.id;
  }

  async getEventWithReceiver(eventId: string): Promise<EventWithReceiver | null> {
    const row = await db
      .selectFrom('receiver_events')
      .innerJoin('receivers', 'receivers.id', 'receiver_events.receiver_id')
      .innerJoin('projects', 'projects.id', 'receivers.project_id')
      .select([
        'receiver_events.id as event_id',
        'receiver_events.status',
        'receiver_events.raw_payload',
        'receivers.id',
        'receivers.project_id',
        'receivers.name',
        'receivers.adapter_type',
        'receivers.field_mapping',
        'receivers.enabled',
        'receivers.token_hash',
        'projects.organization_id',
      ])
      .where('receiver_events.id', '=', eventId)
      .where('projects.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    return {
      eventId: row.event_id,
      status: row.status as ReceiverEventStatus,
      rawPayload: row.raw_payload as Record<string, unknown>,
      id: row.id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      name: row.name,
      adapterType: row.adapter_type as ReceiverAdapterType,
      fieldMapping: (row.field_mapping as ReceiverFieldMapping | null) ?? null,
      enabled: row.enabled,
      tokenHash: row.token_hash,
    };
  }

  async completeEvent(
    eventId: string,
    outcome: {
      status: Exclude<ReceiverEventStatus, 'pending'>;
      normalized?: LogInput[] | null;
      error?: string | null;
    }
  ): Promise<void> {
    await db
      .updateTable('receiver_events')
      .set({
        status: outcome.status,
        // JSON.stringify because the pg driver would serialize a JS array root
        // as a Postgres array literal, which is invalid for JSONB.
        normalized: outcome.normalized != null ? JSON.stringify(outcome.normalized) : null,
        error: outcome.error ?? null,
      })
      .where('id', '=', eventId)
      .execute();
  }

  async listEvents(receiverId: string, limit = 50): Promise<ReceiverEvent[]> {
    const rows = await db
      .selectFrom('receiver_events')
      .select(['id', 'receiver_id', 'status', 'raw_payload', 'normalized', 'error', 'received_at'])
      .where('receiver_id', '=', receiverId)
      .orderBy('received_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      receiverId: r.receiver_id,
      status: r.status as ReceiverEventStatus,
      rawPayload: r.raw_payload as Record<string, unknown>,
      normalized: r.normalized ?? null,
      error: r.error,
      receivedAt: new Date(r.received_at),
    }));
  }

  async touchLastReceived(receiverId: string): Promise<void> {
    await db
      .updateTable('receivers')
      .set({ last_received_at: new Date() })
      .where('id', '=', receiverId)
      .execute();
  }

  /** Keep only the newest `keep` events for a receiver. */
  async pruneEvents(receiverId: string, keep = ReceiversService.MAX_EVENTS_PER_RECEIVER): Promise<void> {
    await db
      .deleteFrom('receiver_events')
      .where('receiver_id', '=', receiverId)
      .where('id', 'not in', (eb) =>
        eb
          .selectFrom('receiver_events')
          .select('id')
          .where('receiver_id', '=', receiverId)
          .orderBy('received_at', 'desc')
          .limit(keep)
      )
      .execute();
  }
}

export const receiversService = new ReceiversService();
