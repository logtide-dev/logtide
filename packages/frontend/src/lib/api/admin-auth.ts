import { getApiBaseUrl } from '$lib/config';

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

/**
 * Error text from a failed response: the backend sends { error } or { message },
 * and validation failures add a details array of { path, message }. The body can
 * also be empty or not JSON.
 */
export async function readAuthError(response: Response, fallback: string): Promise<string> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return fallback;
  }
  if (!text) return fallback;
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown; details?: unknown };
    const head =
      typeof body?.error === 'string' && body.error.trim()
        ? body.error
        : typeof body?.message === 'string' && body.message.trim()
          ? body.message
          : fallback;
    if (Array.isArray(body?.details)) {
      const parts = body.details
        .slice(0, 3)
        .map((d: { path?: unknown; message?: unknown }) => {
          if (!d || typeof d.message !== 'string') return null;
          const path = Array.isArray(d.path) ? d.path.join('.') : '';
          return path ? `${path}: ${d.message}` : d.message;
        })
        .filter((x: string | null): x is string => !!x);
      if (parts.length) return `${head} (${parts.join(', ')})`;
    }
    return head;
  } catch {
    return fallback;
  }
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
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(await readAuthError(response, 'Request failed'));
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text().catch(() => '');
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
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

  /** Tests the saved configuration of a provider (not unsaved form values). */
  async testConnection(id: string): Promise<TestConnectionResult> {
    const res = await this.request<Partial<TestConnectionResult> | undefined>(
      `/admin/auth/providers/${id}/test`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    if (!res || typeof res.success !== 'boolean') {
      return { success: false, message: 'The server returned an unexpected response' };
    }
    return { success: res.success, message: res.message || (res.success ? 'Connection works' : 'Connection failed') };
  }
}
