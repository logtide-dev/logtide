import { sql } from 'kysely';
import type {
  DetectionEvent,
  SigmaRuleDetail,
  SigmaRuleListItem,
  SigmaRuleListQuery,
} from '@logtide/shared';
import { context } from '@logtide/shared/context';
import { db } from '../../database/index.js';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { classifySource, packIdFor, packSigmaIdPatterns, reconstructYaml } from './yaml.js';

export interface SigmaRuleListResult {
  rules: SigmaRuleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type BulkAction = 'enable' | 'disable' | 'delete';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;

/** Escape LIKE metacharacters (backslash is the Postgres default escape). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function toListItem(
  row: any,
  hits: Map<string, number>,
  exceptions: Map<string, number>
): SigmaRuleListItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sigmaId: row.sigma_id,
    title: row.title,
    description: row.description,
    author: row.author,
    date: toIso(row.date),
    level: row.level,
    status: row.status,
    logsource: row.logsource,
    detection: row.detection,
    emailRecipients: row.email_recipients,
    webhookUrl: row.webhook_url,
    alertRuleId: row.alert_rule_id,
    conversionStatus: row.conversion_status,
    conversionNotes: row.conversion_notes,
    enabled: row.enabled,
    tags: row.tags,
    mitreTactics: row.mitre_tactics,
    mitreTechniques: row.mitre_techniques,
    sigmahqPath: row.sigmahq_path,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    source: classifySource(row),
    packId: packIdFor(row.sigma_id),
    hits7d: hits.get(row.id) ?? 0,
    lastFiredAt: toIso(row.last_fired_at),
    exceptionCount: exceptions.get(row.id) ?? 0,
  };
}

const LEVEL_RANK_SQL = sql`CASE sigma_rules.level
  WHEN 'critical' THEN 5
  WHEN 'high' THEN 4
  WHEN 'medium' THEN 3
  WHEN 'low' THEN 2
  WHEN 'informational' THEN 1
  ELSE 0 END`;

/**
 * Detection rule management: paged list with 7-day hit counts, bulk actions.
 * Every query carries the organization id.
 */
export class RuleManagementService {
  /** Optional filters shared by the page query and the count query (the org filter is applied by callers). */
  private applyFilters(qb: any, q: SigmaRuleListQuery): any {
    let query = qb;

    const search = q.search?.trim().slice(0, MAX_SEARCH_LENGTH);
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      query = query.where((eb: any) =>
        eb.or([eb('sigma_rules.title', 'ilike', pattern), eb('sigma_rules.description', 'ilike', pattern)])
      );
    }
    if (q.severity?.length) query = query.where('sigma_rules.level', 'in', q.severity);
    if (q.tactic?.length) {
      const tactics = q.tactic.map((t) => t.toLowerCase());
      query = query.where(sql<boolean>`sigma_rules.mitre_tactics && ${tactics}::text[]`);
    }
    if (q.category?.length) query = query.where('sigma_rules.category', 'in', q.category);
    if (q.enabled !== undefined) query = query.where('sigma_rules.enabled', '=', q.enabled);
    if (q.projectId) {
      // Org-wide rules (no project) apply to every project.
      query = query.where((eb: any) =>
        eb.or([
          eb('sigma_rules.project_id', '=', q.projectId),
          eb('sigma_rules.project_id', 'is', null),
        ])
      );
    }
    if (q.source?.length) {
      const isPack = sql<boolean>`COALESCE(sigma_rules.sigma_id LIKE ANY(${packSigmaIdPatterns()}::text[]), false)`;
      const clauses = q.source.map((s) => {
        if (s === 'pack') return isPack;
        if (s === 'sigmahq') return sql<boolean>`(sigma_rules.sigmahq_path IS NOT NULL AND NOT ${isPack})`;
        return sql<boolean>`(sigma_rules.sigmahq_path IS NULL AND NOT ${isPack})`;
      });
      query = query.where(sql<boolean>`(${sql.join(clauses, sql` OR `)})`);
    }
    return query;
  }

  async list(q: SigmaRuleListQuery): Promise<SigmaRuleListResult> {
    const paged = q.page !== undefined || q.pageSize !== undefined;
    const pageSize = paged
      ? Math.min(Math.max(q.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
      : 0;
    const page = paged ? Math.max(q.page ?? 1, 1) : 1;
    const sortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';
    const sortBy = q.sortBy ?? 'createdAt';

    const countRow: any = await this.applyFilters(
      db.selectFrom('sigma_rules').where('sigma_rules.organization_id', '=', q.organizationId),
      q
    )
      .select((eb: any) => eb.fn.countAll().as('count'))
      .executeTakeFirst();
    const total = Number(countRow?.count ?? 0);

    let query: any = this.applyFilters(
      db.selectFrom('sigma_rules').where('sigma_rules.organization_id', '=', q.organizationId),
      q
    ).selectAll('sigma_rules');

    if (sortBy === 'hits7d') {
      // The one costlier path: a grouped 7-day aggregate over this org's
      // detection events joined to the rules (uses idx_detection_events_rule
      // and idx_detection_events_org_time). Every other sort avoids it.
      query = query
        .leftJoin(
          sql`(
            SELECT sigma_rule_id, count(*) AS hits
            FROM detection_events
            WHERE organization_id = ${q.organizationId}
              AND time >= now() - interval '7 days'
            GROUP BY sigma_rule_id
          )`.as('h'),
          (join: any) => join.onRef('h.sigma_rule_id', '=', 'sigma_rules.id')
        )
        .orderBy(sql`COALESCE(h.hits, 0)`, sortOrder);
    } else if (sortBy === 'title') {
      query = query.orderBy(sql`lower(sigma_rules.title)`, sortOrder);
    } else if (sortBy === 'level') {
      query = query.orderBy(LEVEL_RANK_SQL, sortOrder);
    } else if (sortBy === 'lastFiredAt') {
      query = query.orderBy(sql`sigma_rules.last_fired_at ${sql.raw(sortOrder)} NULLS LAST`);
    } else {
      query = query.orderBy('sigma_rules.created_at', sortOrder);
    }
    query = query.orderBy('sigma_rules.id', 'asc');

    if (paged) query = query.limit(pageSize).offset((page - 1) * pageSize);

    const rows: any[] = await query.execute();
    const ids = rows.map((r) => r.id as string);
    const [hits, exceptions] = await Promise.all([
      this.hitsFor(q.organizationId, ids),
      this.exceptionCountsFor(q.organizationId, ids),
    ]);

    return {
      rules: rows.map((r) => toListItem(r, hits, exceptions)),
      total,
      page,
      pageSize: paged ? pageSize : total,
    };
  }

  /** hits7d for a set of rule ids (events of the last 7 days). */
  async hitsFor(organizationId: string, ruleIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (ruleIds.length === 0) return result;
    const rows = await db
      .selectFrom('detection_events')
      .select(['sigma_rule_id', (eb) => eb.fn.countAll().as('count')])
      .where('organization_id', '=', organizationId)
      .where('sigma_rule_id', '=', sql<string>`ANY(${ruleIds}::uuid[])`)
      .where('time', '>=', sql<Date>`now() - interval '7 days'`)
      .groupBy('sigma_rule_id')
      .execute();
    for (const r of rows) result.set(r.sigma_rule_id, Number(r.count));
    return result;
  }

  /** Number of still-active exceptions per rule. */
  async exceptionCountsFor(
    organizationId: string,
    ruleIds: string[]
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (ruleIds.length === 0) return result;
    const rows = await db
      .selectFrom('sigma_rule_exceptions')
      .select(['sigma_rule_id', (eb) => eb.fn.countAll().as('count')])
      .where('organization_id', '=', organizationId)
      .where('sigma_rule_id', '=', sql<string>`ANY(${ruleIds}::uuid[])`)
      .where((eb) =>
        eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`now()`)])
      )
      .groupBy('sigma_rule_id')
      .execute();
    for (const r of rows) result.set(r.sigma_rule_id, Number(r.count));
    return result;
  }

  /** One rule with its stored (or reconstructed) YAML, or null outside the org. */
  async getDetail(id: string, organizationId: string): Promise<SigmaRuleDetail | null> {
    const row = await db
      .selectFrom('sigma_rules')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!row) return null;

    const [hits, exceptions] = await Promise.all([
      this.hitsFor(organizationId, [id]),
      this.exceptionCountsFor(organizationId, [id]),
    ]);
    const item = toListItem(row, hits, exceptions);
    return {
      ...item,
      yaml: row.raw_yaml ?? reconstructYaml(row),
      yamlReconstructed: row.raw_yaml == null,
      editable: item.source === 'custom',
    };
  }

  /** Recent detection events of one rule, newest first. */
  async listMatches(input: {
    ruleId: string;
    organizationId: string;
    limit: number;
    offset: number;
    days: number;
  }): Promise<{ matches: DetectionEvent[]; total: number }> {
    const since = sql<Date>`now() - (${input.days} * interval '1 day')`;
    const base = db
      .selectFrom('detection_events')
      .where('organization_id', '=', input.organizationId)
      .where('sigma_rule_id', '=', input.ruleId)
      .where('time', '>=', since);

    const [rows, count] = await Promise.all([
      base
        .selectAll()
        .orderBy('time', 'desc')
        .orderBy('id', 'asc')
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      base.select((eb) => eb.fn.countAll().as('count')).executeTakeFirst(),
    ]);

    return {
      matches: rows.map((row) => ({
        id: row.id,
        time: new Date(row.time).toISOString(),
        organizationId: row.organization_id,
        projectId: row.project_id,
        sigmaRuleId: row.sigma_rule_id,
        logId: row.log_id,
        severity: row.severity,
        ruleTitle: row.rule_title,
        ruleDescription: row.rule_description,
        mitreTactics: row.mitre_tactics,
        mitreTechniques: row.mitre_techniques,
        service: row.service,
        logLevel: row.log_level,
        logMessage: row.log_message,
        traceId: row.trace_id,
        matchedFields: row.matched_fields,
        incidentId: row.incident_id,
        category: row.category ?? 'security',
      })),
      total: Number(count?.count ?? 0),
    };
  }

  /**
   * Enable, disable or delete many rules at once. Ids of other organizations
   * are ignored silently. Enable is all-or-nothing against
   * `sigma.max_active_rules`; CapabilityError propagates to the caller.
   * Returns the number of rules actually changed.
   */
  async bulk(organizationId: string, ids: string[], action: BulkAction): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    const owned = await db
      .selectFrom('sigma_rules')
      .select(['id', 'enabled', 'alert_rule_id'])
      .where('organization_id', '=', organizationId)
      .where('id', '=', sql<string>`ANY(${uniqueIds}::uuid[])`)
      .execute();
    if (owned.length === 0) return 0;

    if (action === 'delete') {
      const ruleIds = owned.map((r) => r.id);
      const alertRuleIds = owned.map((r) => r.alert_rule_id).filter((x): x is string => !!x);
      await db.transaction().execute(async (trx) => {
        if (alertRuleIds.length > 0) {
          await trx
            .deleteFrom('alert_rules')
            .where('organization_id', '=', organizationId)
            .where('id', 'in', alertRuleIds)
            .execute();
        }
        await trx
          .deleteFrom('sigma_rules')
          .where('organization_id', '=', organizationId)
          .where('id', 'in', ruleIds)
          .execute();
      });
      return ruleIds.length;
    }

    if (action === 'disable') {
      const enabledIds = owned.filter((r) => r.enabled).map((r) => r.id);
      if (enabledIds.length === 0) return 0;
      await db
        .updateTable('sigma_rules')
        .set({ enabled: false, updated_at: new Date() })
        .where('organization_id', '=', organizationId)
        .where('id', 'in', enabledIds)
        .execute();
      return enabledIds.length;
    }

    const disabledIds = owned.filter((r) => !r.enabled).map((r) => r.id);
    if (disabledIds.length === 0) return 0;

    await withLimitLock(organizationId, 'sigma.max_active_rules', async () => {
      await context.runAsSystem('sigma:bulk-enable-limit-check', async () => {
        await context.with({ organizationId }, async () => {
          const row = await db
            .selectFrom('sigma_rules')
            .select((eb) => eb.fn.countAll().as('count'))
            .where('organization_id', '=', organizationId)
            .where('enabled', '=', true)
            .executeTakeFirst();
          await assertWithinLimit(
            'sigma.max_active_rules',
            Number(row?.count ?? 0),
            disabledIds.length
          );
        });
      });
      await db
        .updateTable('sigma_rules')
        .set({ enabled: true, updated_at: new Date() })
        .where('organization_id', '=', organizationId)
        .where('id', 'in', disabledIds)
        .execute();
    });
    return disabledIds.length;
  }
}

export const ruleManagementService = new RuleManagementService();
