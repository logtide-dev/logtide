import { db } from '../../database/connection.js';
import { reservoir } from '../../database/reservoir.js';
import type { Project, StatusPageVisibility } from '@logtide/shared';
import bcrypt from 'bcrypt';

function generateProjectSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'project';
}

export interface CreateProjectInput {
  organizationId: string;
  userId: string;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  statusPageVisibility?: StatusPageVisibility;
  statusPagePassword?: string;
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

    // Check if project with same name already exists in this organization
    const existing = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', input.organizationId)
      .where('name', '=', input.name)
      .executeTakeFirst();

    if (existing) {
      throw new Error('A project with this name already exists in this organization');
    }

    // Generate a globally unique slug
    const baseSlug = generateProjectSlug(input.name);
    let slug = baseSlug;
    let suffix = 2;
    while (true) {
      const conflict = await db
        .selectFrom('projects')
        .select('id')
        .where('slug', '=', slug)
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
      .returning(['id', 'organization_id', 'name', 'description', 'slug', 'status_page_visibility', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();

    return {
      id: project.id,
      organizationId: project.organization_id,
      name: project.name,
      description: project.description || undefined,
      slug: project.slug,
      statusPageVisibility: project.status_page_visibility,
      createdAt: new Date(project.created_at),
      updatedAt: new Date(project.updated_at),
    };
  }

  /**
   * Get all projects for an organization
   */
  async getOrganizationProjects(organizationId: string, userId: string): Promise<Project[]> {
    // Check if user has access to organization
    await this.checkOrganizationAccess(organizationId, userId);

    const projects = await db
      .selectFrom('projects')
      .select(['id', 'organization_id', 'name', 'description', 'slug', 'status_page_visibility', 'created_at', 'updated_at'])
      .where('organization_id', '=', organizationId)
      .orderBy('created_at', 'desc')
      .execute();

    return projects.map((p) => ({
      id: p.id,
      organizationId: p.organization_id,
      name: p.name,
      description: p.description || undefined,
      slug: p.slug,
      statusPageVisibility: p.status_page_visibility,
      createdAt: new Date(p.created_at),
      updatedAt: new Date(p.updated_at),
    }));
  }

  /**
   * Get a project by ID
   */
  async getProjectById(projectId: string, userId: string): Promise<Project | null> {
    const project = await db
      .selectFrom('projects')
      .innerJoin('organization_members', 'projects.organization_id', 'organization_members.organization_id')
      .select(['projects.id', 'projects.organization_id', 'projects.name', 'projects.description', 'projects.slug', 'projects.status_page_visibility', 'projects.created_at', 'projects.updated_at'])
      .where('projects.id', '=', projectId)
      .where('organization_members.user_id', '=', userId)
      .executeTakeFirst();

    if (!project) {
      return null;
    }

    return {
      id: project.id,
      organizationId: project.organization_id,
      name: project.name,
      description: project.description || undefined,
      slug: project.slug,
      statusPageVisibility: project.status_page_visibility,
      createdAt: new Date(project.created_at),
      updatedAt: new Date(project.updated_at),
    };
  }

  /**
   * Update a project
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

    // If name is being changed, check for conflicts in organization
    if (input.name && input.name !== existing.name) {
      const conflict = await db
        .selectFrom('projects')
        .select('id')
        .where('organization_id', '=', existing.organizationId)
        .where('name', '=', input.name)
        .where('id', '!=', projectId)
        .executeTakeFirst();

      if (conflict) {
        throw new Error('A project with this name already exists in this organization');
      }
    }

    // Build update set
    const updateSet: Record<string, unknown> = { updated_at: new Date() };
    if (input.name) updateSet.name = input.name;
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
      .returning(['id', 'organization_id', 'name', 'description', 'slug', 'status_page_visibility', 'created_at', 'updated_at'])
      .executeTakeFirst();

    if (!project) {
      return null;
    }

    return {
      id: project.id,
      organizationId: project.organization_id,
      name: project.name,
      description: project.description || undefined,
      slug: project.slug,
      statusPageVisibility: project.status_page_visibility,
      createdAt: new Date(project.created_at),
      updatedAt: new Date(project.updated_at),
    };
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
   * Get which projects have data per category (logs, traces, metrics)
   */
  async getProjectDataAvailability(
    organizationId: string,
    userId: string,
  ): Promise<{ logs: string[]; traces: string[]; metrics: string[] }> {
    await this.checkOrganizationAccess(organizationId, userId);

    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return { logs: [], traces: [], metrics: [] };
    }

    const isTimescale = reservoir.getEngineType() === 'timescale';
    const epoch = new Date(0);
    const now = new Date();

    if (isTimescale) {
      const [logsResult, tracesResult, metricsResult] = await Promise.all([
        db
          .selectFrom('logs')
          .select('project_id')
          .where('project_id', 'in', projectIds)
          .groupBy('project_id')
          .execute()
          .catch(() => []),
        db
          .selectFrom('traces')
          .select('project_id')
          .where('project_id', 'in', projectIds)
          .groupBy('project_id')
          .execute()
          .catch(() => []),
        db
          .selectFrom('metrics')
          .select('project_id')
          .where('project_id', 'in', projectIds)
          .groupBy('project_id')
          .execute()
          .catch(() => []),
      ]);

      return {
        logs: logsResult.map((r) => r.project_id).filter((id): id is string => id !== null),
        traces: tracesResult.map((r) => r.project_id),
        metrics: metricsResult.map((r) => r.project_id),
      };
    }

    // Non-timescale (ClickHouse/MongoDB): query via reservoir
    const [logChecks, traceChecks, metricChecks] = await Promise.all([
      Promise.all(
        projectIds.map((id) =>
          reservoir
            .count({ projectId: id, from: epoch, to: now })
            .then((r) => (r.count > 0 ? id : null))
            .catch(() => null),
        ),
      ),
      Promise.all(
        projectIds.map((id) =>
          reservoir
            .queryTraces({ projectId: id, from: epoch, to: now, limit: 1 })
            .then((r) => (r.traces.length > 0 ? id : null))
            .catch(() => null),
        ),
      ),
      Promise.all(
        projectIds.map((id) =>
          reservoir
            .queryMetrics({ projectId: id, from: epoch, to: now, limit: 1 })
            .then((r) => (r.metrics.length > 0 ? id : null))
            .catch(() => null),
        ),
      ),
    ]);

    return {
      logs: logChecks.filter((id): id is string => id !== null),
      traces: traceChecks.filter((id): id is string => id !== null),
      metrics: metricChecks.filter((id): id is string => id !== null),
    };
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string, userId: string): Promise<boolean> {
    // Check if project exists and user has access
    const project = await this.getProjectById(projectId, userId);
    if (!project) {
      return false;
    }

    const result = await db
      .deleteFrom('projects')
      .where('id', '=', projectId)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0) > 0;
  }
}

export const projectsService = new ProjectsService();
