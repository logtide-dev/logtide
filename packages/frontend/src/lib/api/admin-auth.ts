import { getApiBaseUrl } from '$lib/config';
import type { AuthProvider } from './auth';

export interface AuthProviderConfig {
  id: string;
  type: 'local' | 'oidc' | 'ldap';
  name: string;
  slug: string;
  enabled: boolean;
  isDefault: boolean;
  displayOrder: number;
  icon: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderInput {
  type: 'oidc' | 'ldap';
  name: string;
  slug: string;
  enabled?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  icon?: string;
  config: Record<string, unknown>;
}

export interface UpdateProviderInput {
  name?: string;
  enabled?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  icon?: string | null;
  config?: Record<string, unknown>;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

export interface ErrorResponse {
  error: string;
  details?: unknown;
}

export class AdminAuthAPI {
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
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  async getProviders(): Promise<{ providers: AuthProviderConfig[] }> {
    return this.request('/admin/auth/providers');
  }

  async getProvider(id: string): Promise<{ provider: AuthProviderConfig }> {
    return this.request(`/admin/auth/providers/${id}`);
  }

  async createProvider(input: CreateProviderInput): Promise<{ provider: AuthProviderConfig }> {
    return this.request('/admin/auth', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<{ provider: AuthProviderConfig }> {
    return this.request(`/admin/auth/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteProvider(id: string): Promise<void> {
    return this.request(`/admin/auth/providers/${id}`, {
      method: 'DELETE',
    });
  }

  async testConnection(id: string): Promise<TestConnectionResult> {
    return this.request(`/admin/auth/providers/${id}/test`, {
      method: 'POST',
    });
  }

  async reorderProviders(order: string[]): Promise<{ success: boolean }> {
    return this.request('/admin/auth/providers/reorder', {
      method: 'POST',
      body: JSON.stringify({ order }),
    });
  }
}
