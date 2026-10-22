/**
 * Error group triage service
 *
 * Update, bulk update, trends, event paging and trace lookups for error
 * groups. ExceptionService keeps plain CRUD and delegates status changes here.
 */

import type { Kysely, SqlBool } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../database/types.js';
import { reservoir } from '../../database/reservoir.js';
import { ExceptionService, fetchLogsByProject, mapExceptionRow, mapFrameRow } from './service.js';
import type {
  ErrorGroup,
  ErrorGroupBulkAction,
  ErrorGroupBulkResult,
  ErrorGroupPatch,
  ErrorGroupEvent,
  ErrorGroupEventDirection,
  ErrorGroupEventsResult,
  ErrorGroupTraceMatch,
  ErrorGroupTrendsResult,
  StackFrameRecord,
} from './types.js';

export const MAX_BULK_IDS = 100;
export const MAX_IGNORE_COUNT = 1_000_000;
export const MAX_TREND_BUCKETS = 96;
export const DEFAULT_TREND_BUCKETS = 24;
export const MAX_EVENTS_LIMIT = 20;
const TRACE_LOG_LIMIT = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for invalid triage input; routes map it to HTTP 400. */
export class ErrorGroupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorGroupValidationError';
  }
}

interface NormalizedPatch {
  status?: 'open' | 'resolved' | 'ignored';
  assignedTo?: string | null;
  ignoredUntil: Date | null;
  ignoreUntilCount: number | null;
}

export interface BulkUpdateParams {
  organizationId: string;
  ids: string[];
  action: ErrorGroupBulkAction;
  assignedTo?: string | null;
  ignoredUntil?: string | null;
  ignoreUntilCount?: number | null;
  actorUserId: string;
}

export class ErrorGroupTriageService {
  private exceptions: ExceptionService;

  constructor(private db: Kysely<Database>) {
    this.exceptions = new ExceptionService(db);
  }

  /**
   * Update one error group. Returns null when the group is not in the
   * organization. Throws ErrorGroupValidationError before any write when the
   * patch is invalid.
   */
  async updateErrorGroup(
    groupId: string,
    organizationId: string,
    patch: ErrorGroupPatch,
    actorUserId: string | null
  ): Promise<ErrorGroup | null> {
    const normalized = this.normalizePatch(patch);
    if (!UUID_RE.test(groupId)) return null;

    const existing = await this.db
      .selectFrom('error_groups')
      .select('id')
      .where('id', '=', groupId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!existing) return null;

    await this.assertAssigneeIsMember(normalized.assignedTo, organizationId);

    await this.db
      .updateTable('error_groups')
      .set(this.buildSet(normalized, actorUserId) as never)
      .where('id', '=', groupId)
      .where('organization_id', '=', organizationId)
      .execute();

    return this.exceptions.getErrorGroupById(groupId);
  }

  /**
   * Apply one action to up to 100 groups with a single UPDATE. Ids that do not
   * belong to the organization are reported as skipped and never written.
   */
  async bulkUpdateErrorGroups(p: BulkUpdateParams): Promise<ErrorGroupBulkResult> {
    const ids = Array.from(new Set(p.ids));
    if (ids.length === 0) {
      throw new ErrorGroupValidationError('At least one id is required');
    }
    if (ids.length > MAX_BULK_IDS) {
      throw new ErrorGroupValidationError(`At most ${MAX_BULK_IDS} ids are allowed`);
    }
    if (ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
      throw new ErrorGroupValidationError('Invalid id');
    }

    let patch: ErrorGroupPatch;
    switch (p.action) {
      case 'resolve':
        patch = { status: 'resolved' };
        break;
      case 'reopen':
        patch = { status: 'open' };
        break;
      case 'ignore':
        patch = { status: 'ignored' };
        if (p.ignoredUntil !== undefined) patch.ignoredUntil = p.ignoredUntil;
        if (p.ignoreUntilCount !== undefined) patch.ignoreUntilCount = p.ignoreUntilCount;
        break;
      case 'assign':
        if (p.assignedTo === undefined) {
          throw new ErrorGroupValidationError('assignedTo is required for assign');
        }
        patch = { assignedTo: p.assignedTo };
        break;
      default:
        throw new ErrorGroupValidationError('Unknown action');
    }

    const normalized = this.normalizePatch(patch);
    await this.assertAssigneeIsMember(normalized.assignedTo, p.organizationId);

    const found = await this.db
      .selectFrom('error_groups')
      .select('id')
      .where('organization_id', '=', p.organizationId)
      .where('id', 'in', ids)
      .execute();
    const foundIds = new Set(found.map((r) => r.id));

    if (foundIds.size > 0) {
      await this.db
        .updateTable('error_groups')
        .set(this.buildSet(normalized, p.actorUserId) as never)
        .where('organization_id', '=', p.organizationId)
        .where('id', 'in', Array.from(foundIds))
        .execute();
    }

    return {
      updated: ids.filter((id) => foundIds.has(id)),
      skipped: ids.filter((id) => !foundIds.has(id)),
    };
  }

  // ==========================================================================
  // Trends
  // ==========================================================================

  /**
   * Occurrence counts per fixed time bucket for many groups at once. Buckets
   * align to `from`; every group the organization owns gets exactly `buckets`
   * counts (zero filled). Unknown or foreign ids are omitted.
   */
  async getTrends(p: {
    organizationId: string;
    ids: string[];
    from: Date;
    to: Date;
    buckets?: number;
  }): Promise<ErrorGroupTrendsResult> {
    const requested = Math.floor(Number(p.buckets ?? DEFAULT_TREND_BUCKETS));
    const buckets = Math.min(
      MAX_TREND_BUCKETS,
      Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_TREND_BUCKETS)
    );
    const spanMs = p.to.getTime() - p.from.getTime();
    const bucketMs = Math.max(1, Math.ceil(spanMs / buckets));
    const result: ErrorGroupTrendsResult = {
      trends: {},
      from: p.from.toISOString(),
      bucketMs,
      buckets,
    };

    const ids = Array.from(new Set(p.ids.filter((id) => UUID_RE.test(id))));
    if (ids.length === 0 || spanMs <= 0) return result;

    const owned = await this.db
      .selectFrom('error_groups')
      .select('id')
      .where('organization_id', '=', p.organizationId)
      .where('id', 'in', ids)
      .execute();
    if (owned.length === 0) return result;
    for (const g of owned) {
      result.trends[g.id] = new Array<number>(buckets).fill(0);
    }

    const bucketSecs = bucketMs / 1000;
    const idList = sql.join(owned.map((g) => sql`${g.id}::uuid`));
    const rows = await sql<{ group_id: string; bucket: number; count: number }>`
      SELECT g.id AS group_id,
             LEAST(
               floor(extract(epoch from (e.created_at - ${p.from}::timestamptz)) / ${bucketSecs}::float8),
               ${buckets - 1}
             )::int AS bucket,
             count(*)::int AS count
      FROM exceptions e
      JOIN error_groups g
        ON g.organization_id = e.organization_id
       AND g.fingerprint = e.fingerprint
       AND g.project_id IS NOT DISTINCT FROM e.project_id
      WHERE g.organization_id = ${p.organizationId}::uuid
        AND e.organization_id = ${p.organizationId}::uuid
        AND g.id IN (${idList})
        AND e.created_at >= ${p.from}::timestamptz
        AND e.created_at <= ${p.to}::timestamptz
      GROUP BY g.id, 2
    `.execute(this.db);

    for (const r of rows.rows) {
      const arr = result.trends[r.group_id];
      if (arr && r.bucket >= 0 && r.bucket < buckets) arr[r.bucket] += Number(r.count);
    }
    return result;
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  /**
   * Page through the individual events (exceptions) of a group, newest first.
   * Order is (created_at, id); the cursor is an exception id compared with a
   * row-value subquery so microsecond precision is exact.
   */
  async getEvents(p: {
    groupId: string;
    organizationId: string;
    cursor?: string;
    direction?: ErrorGroupEventDirection;
    limit?: number;
  }): Promise<ErrorGroupEventsResult | null> {
    const limit = p.limit ?? 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS_LIMIT) {
      throw new ErrorGroupValidationError(`limit must be an integer between 1 and ${MAX_EVENTS_LIMIT}`);
    }
    if (!UUID_RE.test(p.groupId)) return null;

    const group = await this.db
      .selectFrom('error_groups')
      .select(['fingerprint', 'project_id'])
      .where('id', '=', p.groupId)
      .where('organization_id', '=', p.organizationId)
      .executeTakeFirst();
    if (!group) return null;

    const scope = (qb: ReturnType<typeof this.eventsBase>) => qb;
    void scope;

    const direction: ErrorGroupEventDirection = p.direction ?? 'older';
    let query = this.eventsBase(p.organizationId, group.fingerprint, group.project_id);

    if (p.cursor !== undefined) {
      if (!UUID_RE.test(p.cursor)) throw new ErrorGroupValidationError('Invalid cursor');
      const anchor = await this.db
        .selectFrom('exceptions')
        .select('id')
        .where('id', '=', p.cursor)
        .where('organization_id', '=', p.organizationId)
        .where('fingerprint', '=', group.fingerprint)
        .where((eb) =>
          group.project_id === null
            ? eb('project_id', 'is', null)
            : eb('project_id', '=', group.project_id)
        )
        .executeTakeFirst();
      if (!anchor) throw new ErrorGroupValidationError('Invalid cursor');

      const op = direction === 'newer' ? sql.raw('>') : sql.raw('<');
      query = query.where(
        sql<SqlBool>`(exceptions.created_at, exceptions.id) ${op} (
          SELECT c.created_at, c.id FROM exceptions c
          WHERE c.id = ${p.cursor}::uuid AND c.organization_id = ${p.organizationId}::uuid
        )`
      );
    }

    query =
      p.cursor !== undefined && direction === 'newer'
        ? query.orderBy('exceptions.created_at', 'asc').orderBy('exceptions.id', 'asc')
        : query.orderBy('exceptions.created_at', 'desc').orderBy('exceptions.id', 'desc');

    const fetched = await query.limit(limit + 1).execute();
    const overFetched = fetched.length > limit;
    let rows = fetched.slice(0, limit);
    if (p.cursor !== undefined && direction === 'newer') rows = rows.reverse();

    // The cursor row itself is the probe for the side we came from.
    let hasOlder: boolean;
    let hasNewer: boolean;
    if (p.cursor === undefined) {
      hasOlder = overFetched;
      hasNewer = false;
    } else if (direction === 'newer') {
      hasNewer = overFetched;
      hasOlder = true;
    } else {
      hasOlder = overFetched;
      hasNewer = true;
    }

    if (rows.length === 0) return { events: [], hasOlder, hasNewer };

    const frameRows = await this.db
      .selectFrom('stack_frames')
      .selectAll()
      .where('exception_id', 'in', rows.map((r) => r.id))
      .orderBy('frame_index', 'asc')
      .execute();
    const framesByException = new Map<string, StackFrameRecord[]>();
    for (const f of frameRows) {
      const list = framesByException.get(f.exception_id);
      const mapped = mapFrameRow(f);
      if (list) list.push(mapped);
      else framesByException.set(f.exception_id, [mapped]);
    }

    const logs = await fetchLogsByProject(rows);

    const events: ErrorGroupEvent[] = rows.map((r) => {
      const l = logs.get(r.log_id);
      return {
        cursor: r.id,
        exception: mapExceptionRow(r),
        frames: framesByException.get(r.id) ?? [],
        log: l
          ? {
              id: l.id,
              time: l.time,
              service: l.service,
              message: l.message,
              level: l.level,
              traceId: l.traceId ?? null,
              spanId: l.spanId ?? null,
              sessionId: l.sessionId ?? null,
              hostname: l.hostname ?? null,
              metadata: l.metadata ?? null,
            }
          : null,
      };
    });

    return { events, hasOlder, hasNewer };
  }

  private eventsBase(organizationId: string, fingerprint: string, projectId: string | null) {
    return this.db
      .selectFrom('exceptions')
      .selectAll('exceptions')
      .where('exceptions.organization_id', '=', organizationId)
      .where('exceptions.fingerprint', '=', fingerprint)
      .where((eb) =>
        projectId === null
          ? eb('exceptions.project_id', 'is', null)
          : eb('exceptions.project_id', '=', projectId)
      );
  }

  // ==========================================================================
  // By trace
  // ==========================================================================

  /**
   * Error groups behind the error logs of a trace, one entry per
   * (group, span) pair. Returns null when the project is not in the
   * organization or is soft-deleted.
   */
  async getErrorGroupsByTrace(p: {
    organizationId: string;
    projectId: string;
    traceId: string;
  }): Promise<ErrorGroupTraceMatch[] | null> {
    if (!UUID_RE.test(p.projectId)) return null;
    const project = await this.db
      .selectFrom('projects')
      .select('id')
      .where('id', '=', p.projectId)
      .where('organization_id', '=', p.organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!project) return null;

    // All-time on purpose, same as trace correlation in the query module.
    const logsResult = await reservoir.query({
      projectId: p.projectId,
      traceId: p.traceId,
      level: ['error', 'critical'],
      from: new Date(0),
      to: new Date(),
      sortOrder: 'asc',
      limit: TRACE_LOG_LIMIT,
    });
    const logs = logsResult.logs as Array<{ id: string; time: Date; spanId?: string }>;
    if (logs.length === 0) return [];

    const exceptions = await this.db
      .selectFrom('exceptions')
      .select(['log_id', 'fingerprint'])
      .where('organization_id', '=', p.organizationId)
      .where('project_id', '=', p.projectId)
      .where('log_id', 'in', logs.map((l) => l.id))
      .execute();
    if (exceptions.length === 0) return [];
    const fingerprintByLog = new Map(exceptions.map((e) => [e.log_id, e.fingerprint]));

    const groups = await this.db
      .selectFrom('error_groups')
      .select(['id', 'fingerprint', 'status', 'exception_type', 'exception_message', 'project_id'])
      .where('organization_id', '=', p.organizationId)
      .where('project_id', '=', p.projectId)
      .where('fingerprint', 'in', Array.from(new Set(exceptions.map((e) => e.fingerprint))))
      .execute();
    const groupByFingerprint = new Map(groups.map((g) => [g.fingerprint, g]));

    const seen = new Set<string>();
    const matches: ErrorGroupTraceMatch[] = [];
    for (const log of logs) {
      const fp = fingerprintByLog.get(log.id);
      const group = fp ? groupByFingerprint.get(fp) : undefined;
      if (!group) continue;
      const spanId = log.spanId ?? null;
      const key = `${group.id}|${spanId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        errorGroupId: group.id,
        status: group.status as ErrorGroupTraceMatch['status'],
        exceptionType: group.exception_type,
        exceptionMessage: group.exception_message,
        projectId: group.project_id,
        logId: log.id,
        spanId,
        occurredAt: new Date(log.time).toISOString(),
      });
    }
    return matches;
  }

  // ==========================================================================
  // Validation and update building
  // ==========================================================================

  private normalizePatch(patch: ErrorGroupPatch): NormalizedPatch {
    const has = (k: keyof ErrorGroupPatch) => patch[k] !== undefined;

    if (!has('status') && !has('assignedTo') && !has('ignoredUntil') && !has('ignoreUntilCount')) {
      throw new ErrorGroupValidationError('At least one field is required');
    }
    if (has('status') && !['open', 'resolved', 'ignored'].includes(patch.status as string)) {
      throw new ErrorGroupValidationError('Invalid status');
    }

    const ignoreFieldsSent = has('ignoredUntil') || has('ignoreUntilCount');
    if (ignoreFieldsSent && patch.status !== 'ignored') {
      throw new ErrorGroupValidationError('ignoredUntil and ignoreUntilCount require status ignored');
    }

    let ignoredUntil: Date | null = null;
    if (patch.ignoredUntil !== undefined && patch.ignoredUntil !== null) {
      const d = new Date(patch.ignoredUntil);
      if (typeof patch.ignoredUntil !== 'string' || Number.isNaN(d.getTime())) {
        throw new ErrorGroupValidationError('ignoredUntil must be a valid date');
      }
      if (d.getTime() <= Date.now()) {
        throw new ErrorGroupValidationError('ignoredUntil must be in the future');
      }
      ignoredUntil = d;
    }

    let ignoreUntilCount: number | null = null;
    if (patch.ignoreUntilCount !== undefined && patch.ignoreUntilCount !== null) {
      const n = patch.ignoreUntilCount;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_IGNORE_COUNT) {
        throw new ErrorGroupValidationError(
          `ignoreUntilCount must be an integer between 1 and ${MAX_IGNORE_COUNT.toLocaleString('en-US')}`
        );
      }
      ignoreUntilCount = n;
    }

    if (patch.assignedTo !== undefined && patch.assignedTo !== null) {
      if (typeof patch.assignedTo !== 'string' || !UUID_RE.test(patch.assignedTo)) {
        throw new ErrorGroupValidationError('assignedTo must be a user id or null');
      }
    }

    return {
      status: patch.status,
      assignedTo: patch.assignedTo,
      ignoredUntil,
      ignoreUntilCount,
    };
  }

  private async assertAssigneeIsMember(
    assignedTo: string | null | undefined,
    organizationId: string
  ): Promise<void> {
    if (assignedTo === undefined || assignedTo === null) return;
    const member = await this.db
      .selectFrom('organization_members')
      .select('user_id')
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', assignedTo)
      .executeTakeFirst();
    if (!member) {
      throw new ErrorGroupValidationError('Assignee is not a member of this organization');
    }
  }

  private buildSet(p: NormalizedPatch, actor: string | null): Record<string, unknown> {
    const set: Record<string, unknown> = { updated_at: new Date() };

    if (p.status === 'resolved') {
      // An already resolved row keeps its original resolver and time.
      set.resolved_at = sql`CASE WHEN status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE now() END`;
      set.resolved_by = sql`CASE WHEN status = 'resolved' THEN COALESCE(resolved_by, ${actor}::uuid) ELSE ${actor}::uuid END`;
      set.regressed_at = null;
      set.ignored_until = null;
      set.ignore_until_count = null;
      set.ignored_event_count = 0;
      set.status = 'resolved';
    } else if (p.status === 'open') {
      set.resolved_at = null;
      set.resolved_by = null;
      set.ignored_until = null;
      set.ignore_until_count = null;
      set.ignored_event_count = 0;
      set.status = 'open';
    } else if (p.status === 'ignored') {
      set.resolved_at = null;
      set.resolved_by = null;
      set.ignored_until = p.ignoredUntil;
      set.ignore_until_count = p.ignoreUntilCount;
      set.ignored_event_count = 0;
      set.status = 'ignored';
    }

    if (p.assignedTo !== undefined) {
      set.assigned_to = p.assignedTo;
    }

    return set;
  }
}
