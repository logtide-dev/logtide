/**
 * Incidents service: the single incident store for every source (sigma,
 * alert, monitor, manual). Imports nothing from `queue/` or Fastify so that
 * worker code (alert evaluation, monitor checks) can import it directly.
 */
import {
  expressionBuilder,
  sql,
  type Expression,
  type Kysely,
  type SqlBool,
  type Transaction,
  type Updateable,
} from 'kysely';
import type {
  IncidentComment,
  IncidentHistoryEntry,
  IncidentListItem,
  IncidentSource,
  IncidentSourceEvent,
  IncidentSourceEventMetadata,
  IncidentStatus,
  Severity,
} from '@logtide/shared';
import { db } from '../../database/connection.js';
import type { Database, IncidentsTable } from '../../database/types.js';
import { withIncidentActor } from './actor.js';
import { mapIncidentListRow, mapIncidentRow } from './mappers.js';
import { planStatusChange } from './status.js';
import {
  IncidentError,
  type IncidentListFilters,
  type IncidentRow,
  type OpenOrUpdateFromSourceInput,
  type ResolveFromSourceInput,
} from './types.js';

type Executor = Kysely<Database> | Transaction<Database>;

export interface IncidentPatch {
  status?: IncidentStatus;
  /** null unassigns. */
  assigneeId?: string | null;
  severity?: Severity;
  title?: string;
  description?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_UPDATED_SINCE_LIMIT = 100;

/** Escalate-only severity for the ON CONFLICT path (same order as `higherSeverity`). */
const ESCALATED_SEVERITY = sql<Severity>`case when array_position(array['informational','low','medium','high','critical'], excluded.severity) > array_position(array['informational','low','medium','high','critical'], incidents.severity) then excluded.severity else incidents.severity end`;

const SEVERITY_RANK = sql<number>`case incidents.severity when 'critical' then 5 when 'high' then 4 when 'medium' then 3 when 'low' then 2 else 1 end`;

function isSourceEventMetadata(value: unknown): value is IncidentSourceEventMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  return (
    (m.source === 'alert' || m.source === 'monitor') &&
    typeof m.sourceId === 'string' &&
    typeof m.occurredAt === 'string' &&
    (m.data === null || m.data === undefined || (typeof m.data === 'object' && !Array.isArray(m.data)))
  );
}

export class IncidentsService {
  constructor(private db: Kysely<Database>) {}

  // ==========================================================================
  // READ SIDE
  // ==========================================================================

  /**
   * Base query for list items: incidents of one organization with the joined
   * assignee (only when still a member of the organization), project, alert
   * rule and monitor names. Every join is scoped to the incident organization.
   */
  private selectItems(executor: Executor, organizationId: string) {
    return executor
      .selectFrom('incidents')
      .leftJoin('organization_members as assignee_member', (join) =>
        join
          .onRef('assignee_member.user_id', '=', 'incidents.assignee_id')
          .onRef('assignee_member.organization_id', '=', 'incidents.organization_id')
      )
      .leftJoin('users as assignee', 'assignee.id', 'assignee_member.user_id')
      .leftJoin('projects', (join) =>
        join
          .onRef('projects.id', '=', 'incidents.project_id')
          .onRef('projects.organization_id', '=', 'incidents.organization_id')
      )
      .leftJoin('alert_rules', (join) =>
        join
          .onRef('alert_rules.id', '=', 'incidents.alert_rule_id')
          .onRef('alert_rules.organization_id', '=', 'incidents.organization_id')
      )
      .leftJoin('monitors', (join) =>
        join
          .onRef('monitors.id', '=', 'incidents.monitor_id')
          .onRef('monitors.organization_id', '=', 'incidents.organization_id')
      )
      .where('incidents.organization_id', '=', organizationId)
      .selectAll('incidents')
      .select([
        'assignee.name as assignee_name',
        'assignee.email as assignee_email',
        'projects.name as project_name',
        'alert_rules.name as alert_rule_name',
        'monitors.name as monitor_name',
      ]);
  }

  /** Every list filter except the organization, which each query applies itself. */
  private filterCondition(filters: IncidentListFilters): Expression<SqlBool> | null {
    const eb = expressionBuilder<Database, 'incidents'>();
    const conditions: Expression<SqlBool>[] = [];

    if (filters.projectIds && filters.projectIds.length > 0) {
      conditions.push(eb('incidents.project_id', 'in', filters.projectIds));
    }
    if (filters.status && filters.status.length > 0) {
      conditions.push(eb('incidents.status', 'in', filters.status));
    }
    if (filters.source && filters.source.length > 0) {
      conditions.push(eb('incidents.source', 'in', filters.source));
    }
    if (filters.severity && filters.severity.length > 0) {
      conditions.push(eb('incidents.severity', 'in', filters.severity));
    }
    if (filters.assigneeId === null) {
      conditions.push(eb('incidents.assignee_id', 'is', null));
    } else if (filters.assigneeId !== undefined) {
      conditions.push(eb('incidents.assignee_id', '=', filters.assigneeId));
    }
    if (filters.service) {
      conditions.push(sql<SqlBool>`${filters.service} = ANY(incidents.affected_services)`);
    }
    if (filters.technique) {
      conditions.push(sql<SqlBool>`${filters.technique} = ANY(incidents.mitre_techniques)`);
    }
    if (filters.ruleId) {
      conditions.push(
        eb.exists(
          eb
            .selectFrom('detection_events as de')
            .select(sql.lit(1).as('one'))
            .whereRef('de.incident_id', '=', 'incidents.id')
            .whereRef('de.organization_id', '=', 'incidents.organization_id')
            .where('de.sigma_rule_id', '=', filters.ruleId)
        )
      );
    }

    return conditions.length > 0 ? eb.and(conditions) : null;
  }

  async list(filters: IncidentListFilters): Promise<{ incidents: IncidentListItem[]; total: number }> {
    const sort = filters.sort ?? 'last_event_at';
    const order = filters.order ?? 'desc';
    const condition = this.filterCondition(filters);

    let items = this.selectItems(this.db, filters.organizationId);
    let count = this.db
      .selectFrom('incidents')
      .where('incidents.organization_id', '=', filters.organizationId);
    if (condition) {
      items = items.where(condition);
      count = count.where(condition);
    }

    if (sort === 'severity') {
      items = items.orderBy(SEVERITY_RANK, order).orderBy('incidents.last_event_at', 'desc');
    } else if (sort === 'created_at') {
      items = items.orderBy('incidents.created_at', order);
    } else {
      items = items.orderBy('incidents.last_event_at', order);
    }
    items = items.orderBy('incidents.id', order);

    const [rows, countRow] = await Promise.all([
      items
        .limit(filters.limit ?? DEFAULT_LIST_LIMIT)
        .offset(filters.offset ?? 0)
        .execute(),
      count.select(sql<number>`count(*)::int`.as('count')).executeTakeFirstOrThrow(),
    ]);

    return { incidents: rows.map(mapIncidentListRow), total: countRow.count };
  }

  async getItem(id: string, organizationId: string): Promise<IncidentListItem | null> {
    return this.getItemWith(this.db, id, organizationId);
  }

  protected async getItemWith(
    executor: Executor,
    id: string,
    organizationId: string
  ): Promise<IncidentListItem | null> {
    const row = await this.selectItems(executor, organizationId)
      .where('incidents.id', '=', id)
      .executeTakeFirst();
    return row ? mapIncidentListRow(row) : null;
  }

  /** Items for the given ids in input order; unknown ids and ids of other organizations are dropped. */
  async listByIds(organizationId: string, ids: string[]): Promise<IncidentListItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.selectItems(this.db, organizationId)
      .where('incidents.id', 'in', ids)
      .execute();
    const byId = new Map(rows.map((r) => [r.id, mapIncidentListRow(r)]));
    const seen = new Set<string>();
    const out: IncidentListItem[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (item && !seen.has(id)) {
        seen.add(id);
        out.push(item);
      }
    }
    return out;
  }

  /** Incidents with `updated_at > since`, oldest change first (live stream polling). */
  async listUpdatedSince(input: {
    organizationId: string;
    since: Date;
    projectId?: string;
    sources?: IncidentSource[];
    limit?: number;
  }): Promise<IncidentListItem[]> {
    let query = this.selectItems(this.db, input.organizationId).where('incidents.updated_at', '>', input.since);
    if (input.projectId) {
      query = query.where('incidents.project_id', '=', input.projectId);
    }
    if (input.sources && input.sources.length > 0) {
      query = query.where('incidents.source', 'in', input.sources);
    }
    const rows = await query
      .orderBy('incidents.updated_at', 'asc')
      .orderBy('incidents.id', 'asc')
      .limit(input.limit ?? DEFAULT_UPDATED_SINCE_LIMIT)
      .execute();
    return rows.map(mapIncidentListRow);
  }

  private async findScoped(id: string, organizationId: string) {
    return this.db
      .selectFrom('incidents')
      .select(['id', 'source'])
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
  }

  /** Comments oldest first, with author name and email; null when the incident is not in the organization. */
  async listComments(id: string, organizationId: string): Promise<IncidentComment[] | null> {
    if (!(await this.findScoped(id, organizationId))) return null;
    const rows = await this.db
      .selectFrom('incident_comments')
      .innerJoin('incidents', 'incidents.id', 'incident_comments.incident_id')
      .innerJoin('users', 'users.id', 'incident_comments.user_id')
      .select([
        'incident_comments.id',
        'incident_comments.incident_id',
        'incident_comments.user_id',
        'incident_comments.comment',
        'incident_comments.edited',
        'incident_comments.edited_at',
        'incident_comments.created_at',
        'users.name as user_name',
        'users.email as user_email',
      ])
      .where('incident_comments.incident_id', '=', id)
      .where('incidents.organization_id', '=', organizationId)
      .orderBy('incident_comments.created_at', 'asc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      userId: row.user_id,
      comment: row.comment,
      edited: row.edited,
      editedAt: row.edited_at,
      createdAt: row.created_at,
      userName: row.user_name,
      userEmail: row.user_email,
    }));
  }

  /** History newest first, with the acting user when there is one; null when the incident is not in the organization. */
  async listHistory(id: string, organizationId: string): Promise<IncidentHistoryEntry[] | null> {
    if (!(await this.findScoped(id, organizationId))) return null;
    const rows = await this.db
      .selectFrom('incident_history')
      .innerJoin('incidents', 'incidents.id', 'incident_history.incident_id')
      .leftJoin('users', 'users.id', 'incident_history.user_id')
      .select([
        'incident_history.id',
        'incident_history.incident_id',
        'incident_history.user_id',
        'incident_history.action',
        'incident_history.field_name',
        'incident_history.old_value',
        'incident_history.new_value',
        'incident_history.metadata',
        'incident_history.created_at',
        'users.name as user_name',
        'users.email as user_email',
      ])
      .where('incident_history.incident_id', '=', id)
      .where('incidents.organization_id', '=', organizationId)
      .orderBy('incident_history.created_at', 'desc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      userId: row.user_id,
      action: row.action,
      fieldName: row.field_name,
      oldValue: row.old_value,
      newValue: row.new_value,
      metadata: row.metadata,
      createdAt: row.created_at,
      userName: row.user_name ?? undefined,
      userEmail: row.user_email ?? undefined,
    }));
  }

  /**
   * The alert triggers or monitor checks behind an alert or uptime incident,
   * newest first, read from its `created` and `source_event` history rows.
   * Empty for sigma and manual incidents; null when the incident is not in
   * the organization.
   */
  async listSourceEvents(id: string, organizationId: string): Promise<IncidentSourceEvent[] | null> {
    const incident = await this.findScoped(id, organizationId);
    if (!incident) return null;
    if (incident.source !== 'alert' && incident.source !== 'monitor') return [];

    const rows = await this.db
      .selectFrom('incident_history')
      .innerJoin('incidents', 'incidents.id', 'incident_history.incident_id')
      .select(['incident_history.id', 'incident_history.metadata', 'incident_history.created_at'])
      .where('incident_history.incident_id', '=', id)
      .where('incidents.organization_id', '=', organizationId)
      .where('incident_history.action', 'in', ['created', 'source_event'])
      .execute();

    const events: { event: IncidentSourceEvent; createdAt: number }[] = [];
    for (const row of rows) {
      const meta = row.metadata;
      if (!isSourceEventMetadata(meta)) continue;
      const data = meta.data ?? null;
      const kind = meta.source === 'alert' ? 'alert_trigger' : 'monitor_check';
      const summary =
        data && typeof data.summary === 'string'
          ? data.summary
          : kind === 'alert_trigger'
            ? 'Alert triggered'
            : 'Monitor check failed';
      events.push({
        event: { id: row.id, kind, time: meta.occurredAt, summary, ...(data && { detail: data }) },
        createdAt: new Date(row.created_at).getTime(),
      });
    }

    events.sort(
      (a, b) => Date.parse(b.event.time) - Date.parse(a.event.time) || b.createdAt - a.createdAt
    );
    return events.map((e) => e.event);
  }

  // ==========================================================================
  // WRITE SIDE (user actions)
  // ==========================================================================

  /** Throws IncidentError('invalid_assignee') unless the user is a member of the organization. */
  async assertAssignableUser(organizationId: string, userId: string): Promise<void> {
    const member = UUID_RE.test(userId)
      ? await this.db
          .selectFrom('organization_members')
          .select('id')
          .where('organization_id', '=', organizationId)
          .where('user_id', '=', userId)
          .executeTakeFirst()
      : undefined;
    if (!member) {
      throw new IncidentError('invalid_assignee', 'Assignee is not a member of this organization');
    }
  }

  /**
   * Applies a user patch. History rows name `actorId` (null = no user).
   * Returns null when the incident is not in the organization. Throws
   * IncidentError `invalid_transition` for false positive on a non-security
   * incident and `invalid_assignee` for an assignee outside the organization;
   * nothing is written in either case.
   */
  async update(
    id: string,
    organizationId: string,
    patch: IncidentPatch,
    actorId: string | null
  ): Promise<IncidentListItem | null> {
    if (patch.assigneeId) {
      await this.assertAssignableUser(organizationId, patch.assigneeId);
    }

    const found = await withIncidentActor(this.db, { userId: actorId }, async (trx) => {
      const current = await trx
        .selectFrom('incidents')
        .select(['id', 'status', 'source'])
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return false;

      const set: Updateable<IncidentsTable> = {};
      if (patch.status !== undefined) {
        const plan = planStatusChange(
          { status: current.status, source: current.source as IncidentSource },
          patch.status,
          actorId,
          new Date()
        );
        if (!plan.ok) {
          throw new IncidentError('invalid_transition', 'False positive applies to security incidents only');
        }
        Object.assign(set, plan.set);
      }
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.severity !== undefined) set.severity = patch.severity;
      if (patch.assigneeId !== undefined) set.assignee_id = patch.assigneeId;

      if (Object.keys(set).length > 0) {
        await trx
          .updateTable('incidents')
          .set(set)
          .where('id', '=', id)
          .where('organization_id', '=', organizationId)
          .execute();
      }
      return true;
    });

    return found ? this.getItem(id, organizationId) : null;
  }

  /**
   * Acknowledges an open incident (status investigating, shown as
   * Acknowledged) on behalf of `userId`. Already acknowledged: returned
   * unchanged. Resolved or false positive: IncidentError
   * `invalid_transition`. Not in the organization: null.
   */
  async acknowledge(id: string, organizationId: string, userId: string): Promise<IncidentRow | null> {
    return withIncidentActor(this.db, { userId }, async (trx) => {
      const current = await trx
        .selectFrom('incidents')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return null;
      if (current.status === 'investigating') return mapIncidentRow(current);
      if (current.status !== 'open') {
        throw new IncidentError('invalid_transition', 'Only open incidents can be acknowledged');
      }

      const plan = planStatusChange(
        { status: current.status, source: current.source as IncidentSource },
        'investigating',
        userId,
        new Date()
      );
      if (!plan.ok) {
        throw new IncidentError('invalid_transition', 'Only open incidents can be acknowledged');
      }
      const updated = await trx
        .updateTable('incidents')
        .set(plan.set)
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapIncidentRow(updated);
    });
  }

  // ==========================================================================
  // SOURCE LIFECYCLE (alert rules, monitors)
  // ==========================================================================

  /**
   * Opens an incident for an alert rule or a monitor, or updates the active
   * one (open or acknowledged) of that source. Contract for alert evaluation
   * and monitor checks:
   * - Call it on state transitions (ok to firing, up to down) and on
   *   renotify only, not on every evaluation: each call writes one history
   *   row (`created` or `source_event`, metadata IncidentSourceEventMetadata
   *   with `data` = `metadata ?? null`, no user). An escalation also gets the
   *   trigger's `severity_change` row.
   * - Create: status open, `alert_rule_id` (source alert) or `monitor_id`
   *   (source monitor) = `sourceId`, the other one null,
   *   `last_event_at = time_window_start = time_window_end = occurredAt`.
   * - Update: `last_event_at` and `time_window_end` only move forward,
   *   severity only escalates; title, description, status and assignee stay.
   * - At most one active incident per source is a database guarantee
   *   (partial unique indexes of migration 062 + INSERT ... ON CONFLICT), so
   *   concurrent callers all get the same incident and exactly one gets
   *   `created: true`. A resolved incident is never reopened: the next call
   *   opens a new one.
   * - The source (and the project, when given) must belong to
   *   `organizationId`, otherwise IncidentError('source_not_found') is thrown
   *   and nothing is written.
   * - Never sends an "incident created" notification (the source
   *   notification already went out).
   */
  async openOrUpdateFromSource(
    input: OpenOrUpdateFromSourceInput
  ): Promise<{ incident: IncidentRow; created: boolean }> {
    const notFound = () => new IncidentError('source_not_found', 'Incident source not found');
    if (!UUID_RE.test(input.sourceId) || (input.projectId !== null && !UUID_RE.test(input.projectId))) {
      throw notFound();
    }

    return withIncidentActor(this.db, { userId: null, reason: 'source_event' }, async (trx) => {
      const owned =
        input.source === 'alert'
          ? await trx
              .selectFrom('alert_rules')
              .select('id')
              .where('id', '=', input.sourceId)
              .where('organization_id', '=', input.organizationId)
              .executeTakeFirst()
          : await trx
              .selectFrom('monitors')
              .select('id')
              .where('id', '=', input.sourceId)
              .where('organization_id', '=', input.organizationId)
              .executeTakeFirst();
      if (!owned) throw notFound();

      if (input.projectId !== null) {
        const project = await trx
          .selectFrom('projects')
          .select('id')
          .where('id', '=', input.projectId)
          .where('organization_id', '=', input.organizationId)
          .executeTakeFirst();
        if (!project) throw notFound();
      }

      const target = input.source === 'alert' ? 'alert_rule_id' : 'monitor_id';
      const row = await trx
        .insertInto('incidents')
        .values({
          organization_id: input.organizationId,
          project_id: input.projectId,
          title: input.title,
          description: input.description ?? null,
          severity: input.severity,
          status: 'open',
          source: input.source,
          alert_rule_id: input.source === 'alert' ? input.sourceId : null,
          monitor_id: input.source === 'monitor' ? input.sourceId : null,
          time_window_start: input.occurredAt,
          time_window_end: input.occurredAt,
          last_event_at: input.occurredAt,
        })
        .onConflict((oc) =>
          oc
            // Literal predicate (no bind parameters) matching the partial
            // unique index, so Postgres can infer it as the arbiter.
            .columns(['source', target])
            .where(sql<SqlBool>`${sql.ref(target)} is not null and status in ('open', 'investigating')`)
            .doUpdateSet({
              last_event_at: sql`greatest(incidents.last_event_at, excluded.last_event_at)`,
              time_window_end: sql`greatest(coalesce(incidents.time_window_end, excluded.time_window_end), excluded.time_window_end)`,
              severity: ESCALATED_SEVERITY,
            })
            .where(sql<SqlBool>`incidents.organization_id = excluded.organization_id`)
        )
        .returningAll()
        .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
        .executeTakeFirst();
      // Only reachable if the same source id were active in another
      // organization, which the ownership check above rules out.
      if (!row) throw notFound();

      const { inserted, ...incidentRow } = row;
      const metadata: IncidentSourceEventMetadata = {
        source: input.source,
        sourceId: input.sourceId,
        occurredAt: input.occurredAt.toISOString(),
        data: input.metadata ?? null,
      };
      await trx
        .insertInto('incident_history')
        .values({
          incident_id: incidentRow.id,
          user_id: null,
          action: inserted ? 'created' : 'source_event',
          field_name: null,
          old_value: null,
          new_value: null,
          metadata: { ...metadata },
        })
        .execute();

      return { incident: mapIncidentRow(incidentRow), created: inserted === true };
    });
  }

  /**
   * Resolves the active (open or acknowledged) incident of an alert rule or
   * a monitor: status resolved, `resolved_at = resolvedAt`, no resolver; the
   * history row carries `metadata.reason`. Returns null when nothing was
   * active (idempotent). Use reason `manual` when the source stops being
   * evaluated because a user disabled or deleted it (call it before the
   * delete: the incident keeps its row but loses the source id).
   */
  async resolveFromSource(input: ResolveFromSourceInput): Promise<IncidentRow | null> {
    if (!UUID_RE.test(input.sourceId)) return null;
    const column = input.source === 'alert' ? 'alert_rule_id' : 'monitor_id';

    return withIncidentActor(this.db, { userId: null, reason: input.reason }, async (trx) => {
      const row = await trx
        .updateTable('incidents')
        .set({ status: 'resolved', resolved_at: input.resolvedAt, resolved_by: null })
        .where('organization_id', '=', input.organizationId)
        .where('source', '=', input.source)
        .where(column, '=', input.sourceId)
        .where('status', 'in', ['open', 'investigating'])
        .returningAll()
        .executeTakeFirst();
      return row ? mapIncidentRow(row) : null;
    });
  }
}

export const incidentsService = new IncidentsService(db);
