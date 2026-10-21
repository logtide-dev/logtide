import { sql } from 'kysely';
import type { ExceptionCondition, SigmaException } from '@logtide/shared';
import { db } from '../../database/index.js';
import type { ActiveException } from './exceptions.js';
import { isExceptionActive } from './exceptions.js';

type ExceptionRow = {
  id: string;
  sigma_rule_id: string;
  conditions: ExceptionCondition[];
  reason: string | null;
  expires_at: Date | null;
  hit_count: string | number;
  last_hit_at: Date | null;
  created_by: string | null;
  created_at: Date;
};

function toApi(row: ExceptionRow): SigmaException {
  return {
    id: row.id,
    ruleId: row.sigma_rule_id,
    conditions: row.conditions,
    reason: row.reason,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    hitCount: Number(row.hit_count),
    lastHitAt: row.last_hit_at ? new Date(row.last_hit_at).toISOString() : null,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export interface CreateExceptionInput {
  ruleId: string;
  organizationId: string;
  conditions: ExceptionCondition[];
  reason?: string;
  expiresAt?: string;
  userId: string;
}

/**
 * Rule exceptions: conditions that suppress a match of one Sigma rule before
 * any detection event or notification exists. Every query carries the
 * organization id.
 */
export class SigmaExceptionsService {
  /** Newest first. Expired exceptions are included (flagged by expiresAt). */
  async list(ruleId: string, organizationId: string): Promise<SigmaException[]> {
    const rows = await db
      .selectFrom('sigma_rule_exceptions')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('sigma_rule_id', '=', ruleId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map((r) => toApi(r as unknown as ExceptionRow));
  }

  async create(input: CreateExceptionInput): Promise<SigmaException> {
    const row = await db
      .insertInto('sigma_rule_exceptions')
      .values({
        organization_id: input.organizationId,
        sigma_rule_id: input.ruleId,
        conditions: JSON.stringify(input.conditions),
        reason: input.reason ?? null,
        expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
        created_by: input.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toApi(row as unknown as ExceptionRow);
  }

  async remove(id: string, ruleId: string, organizationId: string): Promise<boolean> {
    const res = await db
      .deleteFrom('sigma_rule_exceptions')
      .where('id', '=', id)
      .where('sigma_rule_id', '=', ruleId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }

  async countForRule(ruleId: string, organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('sigma_rule_exceptions')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .where('sigma_rule_id', '=', ruleId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** One query for every rule id; only exceptions that are still active. */
  async loadActiveForRules(
    organizationId: string,
    ruleIds: string[],
    now: Date
  ): Promise<Map<string, ActiveException[]>> {
    const result = new Map<string, ActiveException[]>();
    if (ruleIds.length === 0) return result;

    const rows = await db
      .selectFrom('sigma_rule_exceptions')
      .select(['id', 'sigma_rule_id', 'conditions', 'expires_at'])
      .where('organization_id', '=', organizationId)
      .where('sigma_rule_id', '=', sql<string>`ANY(${ruleIds}::uuid[])`)
      .execute();

    for (const row of rows) {
      const exception: ActiveException = {
        id: row.id,
        ruleId: row.sigma_rule_id,
        conditions: row.conditions,
        expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      };
      if (!isExceptionActive(exception, now)) continue;
      const list = result.get(exception.ruleId) ?? [];
      list.push(exception);
      result.set(exception.ruleId, list);
    }
    return result;
  }

  async recordHits(organizationId: string, hits: Map<string, number>, now: Date): Promise<void> {
    for (const [exceptionId, count] of hits) {
      if (count <= 0) continue;
      await db
        .updateTable('sigma_rule_exceptions')
        .set({
          hit_count: sql<string>`hit_count + ${count}`,
          last_hit_at: now,
        })
        .where('id', '=', exceptionId)
        .where('organization_id', '=', organizationId)
        .execute();
    }
  }
}

export const sigmaExceptionsService = new SigmaExceptionsService();
