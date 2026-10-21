/**
 * Error group triage service
 *
 * Update, bulk update, trends, event paging and trace lookups for error
 * groups. ExceptionService keeps plain CRUD and delegates status changes here.
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../database/types.js';
import { ExceptionService } from './service.js';
import type {
  ErrorGroup,
  ErrorGroupBulkAction,
  ErrorGroupBulkResult,
  ErrorGroupPatch,
} from './types.js';

export const MAX_BULK_IDS = 100;
export const MAX_IGNORE_COUNT = 1_000_000;

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
