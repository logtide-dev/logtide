import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type ReceiverAdapterType = 'github' | 'uptime' | 'generic';
export type ReceiverEventStatus = 'pending' | 'processed' | 'skipped' | 'failed';

export interface ReceiverFieldMapping {
  message?: string;
  level?: string;
  service?: string;
  timestamp?: string;
  levelMap?: Record<string, string>;
  defaults?: { level?: string; service?: string };
}

export interface Receiver {
  id: string;
  projectId: string;
  name: string;
  adapterType: ReceiverAdapterType;
  fieldMapping: ReceiverFieldMapping | null;
  enabled: boolean;
  createdAt: string;
  lastReceivedAt: string | null;
}

export interface ReceiverEvent {
  id: string;
  receiverId: string;
  status: ReceiverEventStatus;
  rawPayload: Record<string, unknown>;
  normalized: unknown | null;
  error: string | null;
  receivedAt: string;
}

export interface CreateReceiverInput {
  name: string;
  adapterType: ReceiverAdapterType;
  fieldMapping?: ReceiverFieldMapping | null;
}

export interface CreateReceiverResponse {
  id: string;
  token: string;
  ingestPath: string;
  message: string;
}

export class ReceiversAPI {
  constructor(private getToken: () => string | null) {}

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    return fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  }

  async list(projectId: string): Promise<{ receivers: Receiver[] }> {
    const response = await this.request(`/projects/${projectId}/receivers`);
    if (!response.ok) {
      throw new Error('Failed to fetch receivers');
    }
    return response.json();
  }

  async create(projectId: string, input: CreateReceiverInput): Promise<CreateReceiverResponse> {
    const response = await this.request(`/projects/${projectId}/receivers`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create receiver');
    }
    return response.json();
  }

  async update(
    projectId: string,
    id: string,
    patch: { name?: string; enabled?: boolean; fieldMapping?: ReceiverFieldMapping | null }
  ): Promise<void> {
    const response = await this.request(`/projects/${projectId}/receivers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      throw new Error('Failed to update receiver');
    }
  }

  async delete(projectId: string, id: string): Promise<void> {
    const response = await this.request(`/projects/${projectId}/receivers/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 204) {
      throw new Error('Failed to delete receiver');
    }
  }

  async listEvents(projectId: string, id: string, limit = 50): Promise<{ events: ReceiverEvent[] }> {
    const response = await this.request(`/projects/${projectId}/receivers/${id}/events?limit=${limit}`);
    if (!response.ok) {
      throw new Error('Failed to fetch receiver events');
    }
    return response.json();
  }
}

export const receiversAPI = new ReceiversAPI(getAuthToken);
