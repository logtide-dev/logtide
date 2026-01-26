import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export interface ApiKey {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
  revoked: boolean;
}

export interface CreateApiKeyInput {
  name: string;
}

export interface CreateApiKeyResponse {
  id: string;
  apiKey: string;
  message: string;
}

export class ApiKeysAPI {
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

  async list(projectId: string): Promise<{ apiKeys: ApiKey[] }> {
    const response = await this.request(`/projects/${projectId}/api-keys`);

    if (!response.ok) {
      throw new Error('Failed to fetch API keys');
    }

    return response.json();
  }

  async create(
    projectId: string,
    input: CreateApiKeyInput
  ): Promise<CreateApiKeyResponse> {
    const response = await this.request(`/projects/${projectId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create API key');
    }

    return response.json();
  }

  async delete(projectId: string, id: string): Promise<void> {
    const response = await this.request(
      `/projects/${projectId}/api-keys/${id}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok && response.status !== 204) {
      throw new Error('Failed to delete API key');
    }
  }
}

export const apiKeysAPI = new ApiKeysAPI(getAuthToken);
