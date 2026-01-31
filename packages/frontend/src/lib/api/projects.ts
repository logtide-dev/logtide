import type { Project } from '@logtide/shared';
import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export interface CreateProjectInput {
  organizationId: string;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

export class ProjectsAPI {
  constructor(private getToken: () => string | null) {}

  private async request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    return response;
  }

  async getProjects(organizationId: string): Promise<{ projects: Project[] }> {
    const response = await this.request(`/projects?organizationId=${organizationId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch projects');
    }

    return response.json();
  }

  async getProject(id: string): Promise<{ project: Project }> {
    const response = await this.request(`/projects/${id}`);

    if (!response.ok) {
      throw new Error('Failed to fetch project');
    }

    return response.json();
  }

  async createProject(
    input: CreateProjectInput
  ): Promise<{ project: Project }> {
    const response = await this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create project');
    }

    return response.json();
  }

  async updateProject(
    organizationId: string,
    id: string,
    input: UpdateProjectInput
  ): Promise<{ project: Project }> {
    const response = await this.request(`/projects/${id}?organizationId=${organizationId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update project');
    }

    return response.json();
  }

  async deleteProject(organizationId: string, id: string): Promise<void> {
    const response = await this.request(`/projects/${id}?organizationId=${organizationId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete project');
    }
  }
}

export const projectsAPI = new ProjectsAPI(getAuthToken);
