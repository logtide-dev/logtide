import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export interface FirstSignal {
  logs: boolean;
  traces: boolean;
  metrics: boolean;
  errors: boolean;
  firstAt: string | null;
  lastEventAt: string | null;
}

export class FirstSignalAPI {
  constructor(private getToken: () => string | null) {}

  async get(projectId: string): Promise<FirstSignal> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    const response = await fetch(
      `${getApiBaseUrl()}/projects/${encodeURIComponent(projectId)}/first-signal`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      throw new Error('Failed to check for the first signal');
    }
    return response.json();
  }
}

export class ProjectLastEventsAPI {
  constructor(private getToken: () => string | null) {}

  async get(organizationId: string): Promise<Record<string, string | null>> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    const response = await fetch(
      `${getApiBaseUrl()}/projects/last-events?organizationId=${encodeURIComponent(organizationId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      throw new Error('Failed to load last events');
    }
    const body = (await response.json()) as { lastEvents: Record<string, string | null> };
    return body.lastEvents;
  }
}

export const firstSignalAPI = new FirstSignalAPI(getAuthToken);
export const projectLastEventsAPI = new ProjectLastEventsAPI(getAuthToken);
