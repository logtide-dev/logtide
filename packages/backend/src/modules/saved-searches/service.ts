// Saved log searches: named log explorer states, private to their creator or
// shared with the organization. Every query on saved_searches filters
// organization_id; visibility and edit rights are decided here, the routes
// only map the errors to HTTP.

import { sql } from 'kysely';
import { db } from '../../database/index.js';
import type {
  OrgRole,
  SavedSearch,
  SavedSearchState,
  SavedSearchUpdateInput,
  SavedSearchVisibility,
} from '@logtide/shared';

/** The search does not exist in the organization, or the caller may not see it (404). */
export class SavedSearchNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Saved search not found');
    this.name = 'SavedSearchNotFoundError';
  }
}

/** The caller sees the search but may not make this change (403). */
export class SavedSearchForbiddenError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'SavedSearchForbiddenError';
  }
}

export interface CreateSavedSearchInput {
  organizationId: string;
  userId: string;
  name: string;
  visibility: SavedSearchVisibility;
  state: SavedSearchState;
}

interface SavedSearchRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  created_by_name: string | null;
  name: string;
  visibility: SavedSearchVisibility;
  state: unknown;
  created_at: Date;
  updated_at: Date;
}

const MANAGER_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(['owner', 'admin']);

function isVisibleTo(row: Pick<SavedSearchRow, 'visibility' | 'created_by'>, userId: string): boolean {
  return row.visibility === 'organization' || row.created_by === userId;
}

function canEdit(row: Pick<SavedSearchRow, 'visibility' | 'created_by'>, userId: string, role: OrgRole): boolean {
  return row.created_by === userId || (row.visibility === 'organization' && MANAGER_ROLES.has(role));
}

function readState(value: unknown): SavedSearchState {
  if (typeof value === 'string') return JSON.parse(value) as SavedSearchState;
  return value as SavedSearchState;
}

function toSavedSearch(row: SavedSearchRow, userId: string, role: OrgRole): SavedSearch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    createdBy: row.created_by,
    createdByName: row.created_by === null ? null : row.created_by_name,
    name: row.name,
    visibility: row.visibility,
    state: readState(row.state),
    canEdit: canEdit(row, userId, role),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class SavedSearchesService {
  private selectRows(organizationId: string) {
    return db
      .selectFrom('saved_searches')
      .leftJoin('users', 'users.id', 'saved_searches.created_by')
      .select([
        'saved_searches.id',
        'saved_searches.organization_id',
        'saved_searches.created_by',
        'users.name as created_by_name',
        'saved_searches.name',
        'saved_searches.visibility',
        'saved_searches.state',
        'saved_searches.created_at',
        'saved_searches.updated_at',
      ])
      .where('saved_searches.organization_id', '=', organizationId);
  }

  private async findRow(id: string, organizationId: string): Promise<SavedSearchRow | undefined> {
    const row = await this.selectRows(organizationId).where('saved_searches.id', '=', id).executeTakeFirst();
    return row as SavedSearchRow | undefined;
  }

  /** The caller's role in the organization, null when not a member. */
  async getMemberRole(organizationId: string, userId: string): Promise<OrgRole | null> {
    const row = await db
      .selectFrom('organization_members')
      .select('role')
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return (row?.role as OrgRole | undefined) ?? null;
  }

  /** Every saved search of the organization, private ones included (capability limit input). */
  async countForOrg(organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('saved_searches')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** The caller's own private searches plus every organization one, by name (case-insensitive). */
  async list(organizationId: string, userId: string, role: OrgRole): Promise<SavedSearch[]> {
    const rows = await this.selectRows(organizationId)
      .where((eb) =>
        eb.or([
          eb('saved_searches.visibility', '=', 'organization'),
          eb('saved_searches.created_by', '=', userId),
        ]),
      )
      .orderBy(sql`lower(saved_searches.name)`)
      .orderBy('saved_searches.created_at')
      .execute();
    return (rows as SavedSearchRow[]).map((row) => toSavedSearch(row, userId, role));
  }

  async create(input: CreateSavedSearchInput): Promise<SavedSearch> {
    const inserted = await db
      .insertInto('saved_searches')
      .values({
        organization_id: input.organizationId,
        created_by: input.userId,
        name: input.name,
        visibility: input.visibility,
        state: JSON.stringify(input.state),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const row = await this.findRow(inserted.id, input.organizationId);
    if (!row) throw new SavedSearchNotFoundError();
    // The creator is always an editor, whatever their role.
    return toSavedSearch(row, input.userId, 'member');
  }

  /**
   * Applies a patch; `state` replaces the stored state as a whole. Only the
   * creator changes visibility; owners and admins may edit organization ones.
   */
  async update(
    id: string,
    organizationId: string,
    userId: string,
    role: OrgRole,
    patch: SavedSearchUpdateInput,
  ): Promise<SavedSearch> {
    const current = await this.findRow(id, organizationId);
    if (!current || !isVisibleTo(current, userId)) throw new SavedSearchNotFoundError();
    if (!canEdit(current, userId, role)) {
      throw new SavedSearchForbiddenError('You can only edit your own saved searches');
    }
    const isCreator = current.created_by === userId;
    if (patch.visibility !== undefined && patch.visibility !== current.visibility && !isCreator) {
      throw new SavedSearchForbiddenError('Only the creator can change visibility');
    }

    let query = db
      .updateTable('saved_searches')
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.state !== undefined ? { state: JSON.stringify(patch.state) } : {}),
        // Database clock, like created_at, so updated_at never precedes it.
        updated_at: sql<Date>`NOW()`,
      })
      .where('id', '=', id)
      .where('organization_id', '=', organizationId);
    // A non-creator edits only while the search is still shared: if the
    // creator made it private in the meantime, the edit finds nothing.
    if (!isCreator) query = query.where('visibility', '=', 'organization');
    const updated = await query.returning('id').executeTakeFirst();
    if (!updated) throw new SavedSearchNotFoundError();

    const row = await this.findRow(id, organizationId);
    if (!row) throw new SavedSearchNotFoundError();
    return toSavedSearch(row, userId, role);
  }

  async delete(
    id: string,
    organizationId: string,
    userId: string,
    role: OrgRole,
  ): Promise<{ id: string; name: string; visibility: SavedSearchVisibility }> {
    const current = await this.findRow(id, organizationId);
    if (!current || !isVisibleTo(current, userId)) throw new SavedSearchNotFoundError();
    if (!canEdit(current, userId, role)) {
      throw new SavedSearchForbiddenError('You can only delete your own saved searches');
    }

    let query = db
      .deleteFrom('saved_searches')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId);
    if (current.created_by !== userId) query = query.where('visibility', '=', 'organization');
    const deleted = await query.returning(['id', 'name', 'visibility']).executeTakeFirst();
    if (!deleted) throw new SavedSearchNotFoundError();
    return { id: deleted.id, name: deleted.name, visibility: deleted.visibility };
  }

  /** True when every id is a project of the organization (soft-deleted projects included). */
  async projectsBelongToOrg(organizationId: string, projectIds: string[]): Promise<boolean> {
    const unique = [...new Set(projectIds)];
    if (unique.length === 0) return true;
    const row = await db
      .selectFrom('projects')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .where('id', 'in', unique)
      .executeTakeFirst();
    return Number(row?.count ?? 0) === unique.length;
  }
}

export const savedSearchesService = new SavedSearchesService();
