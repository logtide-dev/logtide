import type { Organization, OrganizationWithRole } from '@logward/shared';
import { getApiBaseUrl } from '$lib/config';

export interface CreateOrganizationInput {
  name: string;
  description?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  description?: string;
}

export class OrganizationsAPI {
  constructor(private getToken: () => string | null) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    // Handle 204 No Content responses (like DELETE)
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Get all organizations for the current user
   */
  async getOrganizations(): Promise<{ organizations: OrganizationWithRole[] }> {
    return this.request('/organizations');
  }

  /**
   * Get an organization by ID
   */
  async getOrganization(id: string): Promise<{ organization: OrganizationWithRole }> {
    return this.request(`/organizations/${id}`);
  }

  /**
   * Get an organization by slug
   */
  async getOrganizationBySlug(slug: string): Promise<{ organization: OrganizationWithRole }> {
    return this.request(`/organizations/slug/${slug}`);
  }

  /**
   * Create a new organization
   */
  async createOrganization(input: CreateOrganizationInput): Promise<{ organization: Organization }> {
    return this.request('/organizations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /**
   * Update an organization
   */
  async updateOrganization(
    id: string,
    input: UpdateOrganizationInput
  ): Promise<{ organization: Organization }> {
    return this.request(`/organizations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  /**
   * Get organization members
   */
  async getOrganizationMembers(id: string): Promise<{ members: any[] }> {
    return this.request(`/organizations/${id}/members`);
  }

  /**
   * Delete an organization
   */
  async deleteOrganization(id: string): Promise<void> {
    await this.request(`/organizations/${id}`, {
      method: 'DELETE',
    });
  }
}

// Singleton instance
export const organizationsAPI = new OrganizationsAPI(() => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('logward_auth');
      if (stored) {
        const data = JSON.parse(stored);
        return data.token;
      }
    } catch (e) {
      console.error('Failed to get token:', e);
    }
  }
  return null;
});
