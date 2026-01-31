import { getApiBaseUrl } from '$lib/config';

export interface UpdateUserInput {
  name?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface DeleteUserInput {
  password: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  is_admin?: boolean;
  createdAt: Date;
  lastLogin: Date | null;
}

export class UsersAPI {
  constructor(private getToken: () => string | null) { }

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

  async getCurrentUser(): Promise<{ user: UserProfile }> {
    return this.request('/auth/me');
  }

  async updateCurrentUser(input: UpdateUserInput): Promise<{ user: UserProfile }> {
    return this.request('/auth/me', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteCurrentUser(input: DeleteUserInput): Promise<void> {
    await this.request('/auth/me', {
      method: 'DELETE',
      body: JSON.stringify(input),
    });
  }
}
