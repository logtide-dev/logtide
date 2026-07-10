import { db } from '../../database/connection.js';
import type { Project, StatusPageVisibility } from '@logtide/shared';
import bcrypt from 'bcrypt';
import { validateSlug } from '../../utils/slug.js';
import { CacheManager } from '../../utils/cache.js';

function generateProjectSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'project';
}

export type DataAvailabilityKind = 'logs' | 'traces' | 'metrics';

const DATA_AVAILABILITY_COLUMNS: Record<DataAvailabilityKind, 'has_logs_at' | 'has_traces_at' | 'has_metrics_at'> = {
  logs: 'has_logs_at',
  traces: 'has_traces_at',
  metrics: 'has_metrics_at',
};

// Debounce window: after a successful UPDATE we skip further UPDATEs for the
// same (projectId, kind) for this many ms. Prevents UPDATE spam on hot ingest
// paths; the timestamp precision we need is "roughly this hour", not ms-accurate.
const MARK_HAS_DATA_DEBOUNCE_MS = 5 * 60 * 1000;
const markHasDataLastUpdate = new Map<string, number>();

export interface CreateProjectInput {
  organizationId: string;
  userId: string;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  slug?: string;
  statusPageVisibility?: StatusPageVisibility;
  statusPagePassword?: string;
}

// All columns returned on every Project fetch
const PROJECT_COLUMNS = [
  'id',
  'organization_id',
  'name',
  'description',
  'slug',
  'status_page_visibility',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

function mapProject(p: {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  slug: string;
  status_page_visibility: StatusPageVisibility;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}): Project {
  return {
    id: p.id,
    organizationId: p.organization_id,
    name: p.name,
    description: p.description || undefined,
    slug: p.slug,
    statusPageVisibility: p.status_page_visibility,
    deletedAt: p.deleted_at ? new Date(p.deleted_at) : null,
    createdAt: new Date(p.created_at),
    updatedAt: new Date(p.updated_at),
  };
}

export class ProjectsService {
  /**
   * Check if user has access to organization
   */
  private async checkOrganizationAccess(organizationId: string, userId: string): Promise<void> {
    const member = await db
      .selectFrom('organization_members')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!member) {
      throw new Error('You do not have access to this organization');
    }
  }

  /**
   * Create a new project
   */
  async createProject(input: CreateProjectInput): Promise<Project> {
    // Check if user has access to organization
    await this.checkOrganizationAccess(input.organizationId, input.userId);

    // Check if active project with same name already exists in this organization
    const existing = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', input.organizationId)
      .where('name', '=', input.name)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (existing) {
      throw new Error('A project with this name already exists in this organization');
    }

    // Generate a unique slug among active projects within the organization
    const baseSlug = generateProjectSlug(input.name);
    let slug = baseSlug;
    let suffix = 2;
    while (true) {
      const conflict = await db
        .selectFrom('projects')
        .select('id')
        .where('organization_id', '=', input.organizationId)
        .where('slug', '=', slug)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!conflict) break;
      slug = `${baseSlug}-${suffix++}`;
    }

    const project = await db
      .insertInto('projects')
      .values({
        organization_id: input.organizationId,
        user_id: input.userId,
        name: input.name,
        description: input.description || null,
        slug,
      })
      .returning(PROJECT_COLUMNS)
      .executeTakeFirstOrThrow();

    return mapProject(project);
  }

  /**
   * Get all active (non-deleted) projects for an organization
   */
  async getOrganizationProjects(organizationId: string, userId: string): Promise<Project[]> {
    await this.checkOrganizationAccess(organizationId, userId);

    const projects = await db
      .selectFrom('projects')
      .select(PROJECT_COLUMNS)
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();

    return projects.map(mapProject);
  }

  /**
   * Get all projects for an organization, including soft-deleted ones.
   * Used by the GET /projects?includeDeleted=true endpoint.
   */
  async getOrganizationProjectsIncludingDeleted(organizationId: string, userId: string): Promise<Project[]> {
    await this.checkOrganizationAccess(organizationId, userId);

    const projects = await db
      .selectFrom('projects')
      .select(PROJECT_COLUMNS)
      .where('organization_id', '=', organizationId)
      .orderBy('deleted_at', 'desc') // active (null) first — DESC puts NULLs first in Postgres
      .orderBy('created_at', 'desc')
      .execute();

    return projects.map(mapProject);
  }

  /**
   * Check that a project exists and belongs to the given organization.
   *
   * Used to prevent cross-tenant access when a request supplies both an
   * organizationId (membership-checked) and an untrusted projectId. Project
   * UUIDs appear in dashboard URLs and client API calls, so they must never be
   * treated as authorization tokens on their own.
   *
   * Intentionally includes soft-deleted projects so ACL semantics remain
   * consistent during the grace window.
   */
  async projectBelongsToOrg(projectId: string, organizationId: string): Promise<boolean> {
    const row = await db
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return !!row;
  }

  /**
   * Get a project by ID.
   *
   * Returns soft-deleted projects too — callers that only want active projects
   * should check project.deletedAt themselves.
   */
  async getProjectById(projectId: string, userId: string): Promise<Project | null> {
    const project = await db
      .selectFrom('projects')
      .innerJoin('organization_members', 'projects.organization_id', 'organization_members.organization_id')
      .select([
        'projects.id',
        'projects.organization_id',
        'projects.name',
        'projects.description',
        'projects.slug',
        'projects.status_page_visibility',
        'projects.deleted_at',
        'projects.created_at',
        'projects.updated_at',
      ])
      .where('projects.id', '=', projectId)
      .where('organization_members.user_id', '=', userId)
      .executeTakeFirst();

    if (!project) {
      return null;
    }

    return mapProject(project);
  }

  /**
   * Update a project (only active projects can be updated)
   */
  async updateProject(
    projectId: string,
    userId: string,
    input: UpdateProjectInput
  ): Promise<Project | null> {
    // Check if project exists and user has access
    const existing = await this.getProjectById(projectId, userId);
    if (!existing) {
      return null;
    }

    // Prevent updating a soft-deleted project
    if (existing.deletedAt) {
      throw new Error('Cannot update a deleted project');
    }

    // If name is being changed, check for conflicts in organization (active only)
    if (input.name && input.name !== existing.name) {
      const conflict = await db
        .selectFrom('projects')
        .select('id')
        .where('organization_id', '=', existing.organizationId)
        .where('name', '=', input.name)
        .where('id', '!=', projectId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      if (conflict) {
        throw new Error('A project with this name already exists in this organization');
      }
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const validationError = validateSlug(input.slug);
      if (validationError) {
        throw new Error(validationError);
      }
      const slugConflict = await db
        .selectFrom('projects')
        .select('id')
        .where('organization_id', '=', existing.organizationId)
        .where('slug', '=', input.slug)
        .where('id', '!=', projectId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (slugConflict) {
        throw new Error('A project with this slug already exists in this organization');
      }
    }

    // Build update set
    const updateSet: Record<string, unknown> = { updated_at: new Date() };
    if (input.name) updateSet.name = input.name;
    if (input.slug !== undefined) updateSet.slug = input.slug;
    if (input.description !== undefined) updateSet.description = input.description || null;
    if (input.statusPageVisibility !== undefined) {
      updateSet.status_page_visibility = input.statusPageVisibility;
      // Clear password hash when switching away from password mode
      if (input.statusPageVisibility !== 'password') {
        updateSet.status_page_password_hash = null;
      }
    }
    // Only hash password when setting visibility to 'password' (or already in password mode)
    const effectiveVisibility = input.statusPageVisibility ?? existing.statusPageVisibility;
    if (input.statusPagePassword !== undefined && effectiveVisibility === 'password') {
      updateSet.status_page_password_hash = await bcrypt.hash(input.statusPagePassword, 10);
    }

    const project = await db
      .updateTable('projects')
      .set(updateSet)
      .where('id', '=', projectId)
      .where('organization_id', '=', existing.organizationId)
      .returning(PROJECT_COLUMNS)
      .executeTakeFirst();

    if (!project) {
      return null;
    }

    return mapProject(project);
  }

  /**
   * Verify a password against a project's status page password hash
   */
  async verifyStatusPagePassword(projectId: string, password: string): Promise<boolean> {
    const row = await db
      .selectFrom('projects')
      .select('status_page_password_hash')
      .where('id', '=', projectId)
      .executeTakeFirst();

    if (!row?.status_page_password_hash) return false;
    return bcrypt.compare(password, row.status_page_password_hash);
  }

  /**
   * Mark that a project has received data of a given kind. Debounced in-memory
   * to avoid hammering Postgres with UPDATE on every ingest batch. Fire-and-forget
   * from the caller: failures are logged but never bubble up into ingest.
   */
  async markHasData(projectId: string, kind: DataAvailabilityKind): Promise<void> {
    const cacheKey = `${projectId}:${kind}`;
    const lastUpdate = markHasDataLastUpdate.get(cacheKey) ?? 0;
    const now = Date.now();
    if (now - lastUpdate < MARK_HAS_DATA_DEBOUNCE_MS) return;

    // Set the cache entry optimistically so concurrent callers don't pile up
    // on the same UPDATE.
    markHasDataLastUpdate.set(cacheKey, now);

    const column = DATA_AVAILABILITY_COLUMNS[kind];
    try {
      await db
        .updateTable('projects')
        .set({ [column]: new Date() } as Record<string, Date>)
        .where('id', '=', projectId)
        .execute();
    } catch (err) {
      // Roll back the debounce so a later call can retry.
      markHasDataLastUpdate.delete(cacheKey);
      console.error(`[projects] markHasData(${projectId}, ${kind}) failed:`, err);
    }
  }

  /**
   * Get which active projects have data per category (logs, traces, metrics).
   *
   * Reads from the cached flags on `projects` (populated by ingest-side
   * markHasData + one-shot backfill at boot). A flag is considered empty if
   * its timestamp is older than the organization retention window, which
   * handles the "data aged out" case without a background worker.
   *
   * Soft-deleted projects are excluded so they don't pollute org-wide widget counts.
   */
  async getProjectDataAvailability(
    organizationId: string,
    userId: string,
  ): Promise<{ logs: string[]; traces: string[]; metrics: string[] }> {
    await this.checkOrganizationAccess(organizationId, userId);

    const org = await db
      .selectFrom('organizations')
      .select('retention_days')
      .where('id', '=', organizationId)
      .executeTakeFirst();

    const retentionDays = org?.retention_days ?? 90;
    const staleThreshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const projects = await db
      .selectFrom('projects')
      .select(['id', 'has_logs_at', 'has_traces_at', 'has_metrics_at'])
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .execute();

    const isFresh = (ts: Date | string | null): boolean => {
      if (ts === null) return false;
      const t = ts instanceof Date ? ts : new Date(ts);
      return t >= staleThreshold;
    };

    return {
      logs: projects.filter((p) => isFresh(p.has_logs_at)).map((p) => p.id),
      traces: projects.filter((p) => isFresh(p.has_traces_at)).map((p) => p.id),
      metrics: projects.filter((p) => isFresh(p.has_metrics_at)).map((p) => p.id),
    };
  }

  /**
   * Soft-delete a project.
   *
   * Sets deleted_at = NOW(). The project row and all its historical
   * logs/spans/metrics remain intact. A background worker hard-deletes projects
   * past the grace window (default 30 days).
   */
  async deleteProject(projectId: string, userId: string): Promise<boolean> {
    const project = await this.getProjectById(projectId, userId);
    if (!project || project.deletedAt) {
      return false;
    }

    const result = await db
      .updateTable('projects')
      .set({ deleted_at: new Date() })
      .where('id', '=', projectId)
      .where('organization_id', '=', project.organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    const updated = Number(result.numUpdatedRows || 0) > 0;

    if (updated) {
      // Invalidate cached API key verifications for this project so ingestion is
      // rejected immediately rather than waiting for the cache TTL to expire.
      const keyHashes = await db
        .selectFrom('api_keys')
        .select('key_hash')
        .where('project_id', '=', projectId)
        .execute();
      await Promise.all(keyHashes.map((k) => CacheManager.invalidateApiKey(k.key_hash)));
    }

    return updated;
  }

  /**
   * Restore a previously soft-deleted project.
   */
  async restoreProject(projectId: string, userId: string): Promise<boolean> {
    const project = await this.getProjectById(projectId, userId);
    if (!project || !project.deletedAt) {
      return false;
    }

    // Name and slug are only unique among ACTIVE projects (partial unique
    // indexes), so while this project sat soft-deleted another active project
    // may have taken its name or slug. Restoring would then violate those
    // indexes; reject with a clear error instead of surfacing a raw DB failure.
    const conflict = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', project.organizationId)
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('name', '=', project.name), eb('slug', '=', project.slug)]))
      .executeTakeFirst();

    if (conflict) {
      throw new Error('A project with this name or slug already exists in this organization');
    }

    const result = await db
      .updateTable('projects')
      .set({ deleted_at: null })
      .where('id', '=', projectId)
      .where('organization_id', '=', project.organizationId)
      .where('deleted_at', 'is not', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows || 0) > 0;
  }
}

export const projectsService = new ProjectsService();
