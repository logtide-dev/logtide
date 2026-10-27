import type {
  ProjectHealthCheckKey,
  ProjectHealthIssue,
  ProjectHealthMuteDuration,
  ProjectHealthSeverity,
  ProjectHealthStatus,
} from '@logtide/shared';
import { apiErrorMessage } from '$lib/utils/email-verification';
import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type { ProjectSkewHealthMap } from './projects';

export interface ProjectHealthSummaryEntry {
  status: ProjectHealthStatus;
  openIssues: Array<{
    checkKey: ProjectHealthCheckKey;
    severity: ProjectHealthSeverity;
    muted: boolean;
  }>;
}

export interface ProjectHealthSettings {
  silentMinutes: number;
  healthChannelIds: string[];
}

export interface ProjectHealth {
  status: ProjectHealthStatus;
  lastEventAt: string | null;
  /** Open issues plus issues resolved in the last 7 days. */
  issues: ProjectHealthIssue[];
  checks: {
    receiving: boolean;
    piiRejected24h: number;
    skew: ProjectSkewHealthMap;
    revokedKey24h: number;
  };
  settings: ProjectHealthSettings;
}

export interface UpdateNotificationSettingsInput {
  healthChannelIds?: string[];
  silentMinutes?: number;
}

export class ProjectHealthAPI {
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

  private async fail(response: Response, fallback: string): Promise<never> {
    const body = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage((body as { error?: string }).error, fallback));
  }

  async getSummary(organizationId: string): Promise<{ projects: Record<string, ProjectHealthSummaryEntry> }> {
    const response = await this.request(
      `/projects/health-summary?${new URLSearchParams({ organizationId })}`,
    );
    if (!response.ok) return this.fail(response, 'Failed to fetch project health summary');
    return response.json();
  }

  async getProjectHealth(projectId: string): Promise<ProjectHealth> {
    const response = await this.request(`/projects/${projectId}/health`);
    if (!response.ok) return this.fail(response, 'Failed to fetch project health');
    return response.json();
  }

  /** duration null clears the mute. */
  async setMute(
    projectId: string,
    checkKey: ProjectHealthCheckKey,
    duration: ProjectHealthMuteDuration | null,
  ): Promise<void> {
    const response = await this.request(`/projects/${projectId}/health/mutes/${checkKey}`, {
      method: 'PUT',
      body: JSON.stringify({ duration }),
    });
    if (!response.ok) return this.fail(response, 'Failed to update mute');
  }

  async updateSettings(
    projectId: string,
    body: UpdateNotificationSettingsInput,
  ): Promise<ProjectHealthSettings> {
    const response = await this.request(`/projects/${projectId}/notification-settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!response.ok) return this.fail(response, 'Failed to update notification settings');
    return response.json();
  }
}

export const projectHealthAPI = new ProjectHealthAPI(getAuthToken);
