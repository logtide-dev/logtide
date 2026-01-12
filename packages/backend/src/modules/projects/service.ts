import { db } from '../../database/connection.js';
import type { Project } from '@logtide/shared';

export interface CreateProjectInput {
  organizationId: string;
  userId: string;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
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

    const project = await db
      .insertInto('projects')
      .values({
        organization_id: input.organizationId,
        user_id: input.userId,
        name: input.name,
        description: input.description || null,
      })
      .returning(['id', 'organization_id', 'name', 'description', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();

    return {
      id: project.id,
      organizationId: project.organization_id,
      name: project.name,
      description: project.description || undefined,
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
      .select(['id', 'organization_id', 'name', 'description', 'created_at', 'updated_at'])
      .where('organization_id', '=', organizationId)
      .orderBy('created_at', 'desc')
      .execute();

    return projects.map((p) => ({
      id: p.id,
      organizationId: p.organization_id,
      name: p.name,
      description: p.description || undefined,
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
      .select(['projects.id', 'projects.organization_id', 'projects.name', 'projects.description', 'projects.created_at', 'projects.updated_at'])
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

    const project = await db
      .updateTable('projects')
      .set({
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description || null }),
        updated_at: new Date(),
      })
      .where('id', '=', projectId)
      .returning(['id', 'organization_id', 'name', 'description', 'created_at', 'updated_at'])
      .executeTakeFirst();

    if (!project) {
      return null;
    }

    return {
      id: project.id,
      organizationId: project.organization_id,
      name: project.name,
      description: project.description || undefined,
      createdAt: new Date(project.created_at),
      updatedAt: new Date(project.updated_at),
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
