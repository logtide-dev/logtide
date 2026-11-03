import { db } from '../../database/index.js';
import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import type { AuditCategory, Database, AuditActorType, AuditOutcome } from '../../database/types.js';
import { context } from '@logtide/shared/context';
import { hub } from '@logtide/core';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import { categoryFor, AUDIT_ACTIONS, type AuditAction } from './actions.js';

// Read-time normalization expressions for legacy rows (actor_type/outcome may be NULL).
const actorTypeExpr = sql<string>`COALESCE(actor_type, CASE WHEN user_id IS NULL THEN 'system' ELSE 'user' END)`;
const actorIdExpr = sql<string | null>`COALESCE(actor_id, user_id)`;
const outcomeExpr = sql<string>`COALESCE(outcome, 'success')`;

export interface AuditLogQueryParams {
  organizationId: string;
  category?: AuditCategory;
  action?: string;
  resourceType?: string;
  userId?: string;
  actorType?: AuditActorType;
  outcome?: AuditOutcome;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogRow {
  id: string;
  time: Date;
  organization_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action: string;
  category: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  /** Normalized at read time; never null (legacy rows default to 'user'/'system'). */
  actor_type: string;
  actor_id: string | null;
  /** Normalized at read time; never null (legacy rows default to 'success'). */
  outcome: string;
}

export interface AuditLogResult {
  entries: AuditLogRow[];
  total: number;
}

export interface AuditTarget {
  type: string;
  id: string | null;
}

export interface RecordInput {
  action: AuditAction;
  target?: AuditTarget;
  outcome?: AuditOutcome;
  metadata?: Record<string, unknown> | null;
  /** Override for flows without a usable request context (e.g. failed login). */
  actor?: { type: AuditActorType; id: string | null; label?: string | null };
  /** Override; otherwise taken from the request context. */
  organizationId?: string | null;
  /** Override for callers whose request context predates authentication. */
  ip?: string | null;
  /** Override for callers whose request context predates authentication. */
  userAgent?: string | null;
}

export interface RecordOptions {
  /** Record atomically with the caller's transaction. */
  trx?: Transaction<Database>;
  /**
   * High-volume paths only (query access logs): use the flush buffer.
   * Mutually exclusive with `trx`; when `buffered` is set, `trx` is ignored.
   */
  buffered?: boolean;
}

type AuditRow = {
  organization_id: string | null;
  actor_type: AuditActorType;
  actor_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action: string;
  category: AuditCategory;
  resource_type: string | null;
  resource_id: string | null;
  outcome: AuditOutcome;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
};

const BUFFER_MAX = 50;
const FLUSH_INTERVAL_MS = 1000;

export class AuditLogService {
  private buffer: AuditRow[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private bufferRow(row: AuditRow): void {
    this.buffer.push(row);
    if (this.buffer.length >= BUFFER_MAX) {
      void this.flush();
    }
  }

  private buildRow(input: RecordInput): AuditRow {
    const ctx = context.currentOrNull();
    const actor =
      input.actor ??
      (ctx
        ? {
            type: ctx.actor.type,
            id: ctx.actor.id,
            label: ctx.actor.type === 'user' ? (ctx.actor.email ?? null) : null,
          }
        : { type: 'system' as const, id: null, label: null });

    return {
      organization_id:
        input.organizationId !== undefined ? input.organizationId : (ctx?.organizationId ?? null),
      actor_type: actor.type,
      actor_id: actor.id,
      user_id: actor.type === 'user' ? actor.id : null,
      user_email: actor.label ?? null,
      action: input.action,
      category: categoryFor(input.action),
      resource_type: input.target?.type ?? null,
      resource_id: input.target?.id ?? null,
      outcome: input.outcome ?? 'success',
      ip_address: input.ip !== undefined ? input.ip : (ctx?.ip ?? null),
      user_agent: input.userAgent !== undefined ? input.userAgent : (ctx?.userAgent ?? null),
      metadata: input.metadata ?? null,
    };
  }

  async record(input: RecordInput, opts: RecordOptions = {}): Promise<void> {
    const row = this.buildRow(input);

    if (opts.buffered) {
      this.bufferRow(row);
      return;
    }

    try {
      await (opts.trx ?? db).insertInto('audit_log').values(row).execute();
    } catch (err) {
      if (opts.trx) throw err; // inside a transaction the caller owns failure
      console.error('[AuditLog] record error:', err);
      /* v8 ignore next 3 -- telemetry, disabled in tests */
      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', 'audit record failed', { action: input.action });
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    const toInsert = this.buffer.splice(0, this.buffer.length);
    if (toInsert.length === 0) {
      this.flushing = false;
      return;
    }
    try {
      await db
        .insertInto('audit_log')
        .values(toInsert)
        .execute();
    } catch (err) {
      console.error('[AuditLog] flush error:', err);
      // Re-queue the failed rows, but never let the buffer grow without bound on a
      // persistent DB failure: cap at BUFFER_MAX, dropping the oldest excess.
      this.buffer.unshift(...toInsert);
      if (this.buffer.length > BUFFER_MAX) {
        const dropped = this.buffer.length - BUFFER_MAX;
        this.buffer.splice(0, dropped);
        console.error(`[AuditLog] buffer overflow on flush failure, dropped ${dropped} oldest audit rows`);
      }
    } finally {
      this.flushing = false;
    }
  }

  async query(params: AuditLogQueryParams): Promise<AuditLogResult> {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    let baseQuery = db
      .selectFrom('audit_log')
      .where('organization_id', '=', params.organizationId);

    if (params.category) {
      baseQuery = baseQuery.where('category', '=', params.category);
    }
    if (params.action) {
      baseQuery = baseQuery.where('action', '=', params.action);
    }
    if (params.resourceType) {
      baseQuery = baseQuery.where('resource_type', '=', params.resourceType);
    }
    if (params.userId) {
      baseQuery = baseQuery.where('user_id', '=', params.userId);
    }
    if (params.actorType) {
      baseQuery = baseQuery.where(actorTypeExpr, '=', params.actorType);
    }
    if (params.outcome) {
      baseQuery = baseQuery.where(outcomeExpr, '=', params.outcome);
    }
    if (params.from) {
      baseQuery = baseQuery.where('time', '>=', params.from);
    }
    if (params.to) {
      baseQuery = baseQuery.where('time', '<=', params.to);
    }

    const [entries, countResult] = await Promise.all([
      baseQuery
        .select([
          'id',
          'time',
          'organization_id',
          'user_id',
          'user_email',
          'action',
          'category',
          'resource_type',
          'resource_id',
          'ip_address',
          'user_agent',
          'metadata',
          actorTypeExpr.as('actor_type'),
          actorIdExpr.as('actor_id'),
          outcomeExpr.as('outcome'),
        ])
        .orderBy('time', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      baseQuery
        .select(db.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
    ]);

    return {
      entries: entries as AuditLogRow[],
      total: Number(countResult.count),
    };
  }

  async getDistinctActions(organizationId: string): Promise<string[]> {
    const results = await db
      .selectFrom('audit_log')
      .select('action')
      .distinct()
      .where('organization_id', '=', organizationId)
      .execute();
    const dbActions = results.map((r) => r.action);
    return Array.from(new Set([...Object.keys(AUDIT_ACTIONS), ...dbActions])).sort();
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }
}

export const auditLogService = new AuditLogService();
