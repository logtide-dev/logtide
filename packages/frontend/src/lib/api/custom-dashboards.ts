// ============================================================================
// Custom Dashboards API client
// ============================================================================

import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type {
  CustomDashboard,
  PanelConfig,
  PanelInstance,
  PanelTimeRange,
  PanelType,
} from '@logtide/shared';

export type { CustomDashboard, PanelInstance } from '@logtide/shared';

export interface CreateDashboardPayload {
  organizationId: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  isPersonal?: boolean;
  panels?: PanelInstance[];
}

export interface UpdateDashboardPayload {
  name?: string;
  description?: string | null;
  isPersonal?: boolean;
  panels?: PanelInstance[];
}

/** Mirror of the backend DashboardTemplateSummary. */
export interface DashboardTemplateSummary {
  id: 'service-health' | 'errors-overview' | 'web-vitals' | 'security-overview';
  name: string;
  description: string;
  panelCount: number;
  panelTypes: PanelType[];
}

export interface CreateFromTemplatePayload {
  organizationId: string;
  templateId: string;
  projectId?: string | null;
  name?: string;
}

export interface PickerOptionsParams {
  organizationId: string;
  kind: 'metric-names' | 'services';
  source?: 'logs' | 'traces' | 'metrics';
  projectId?: string | null;
}

export interface PanelDataResult {
  data: unknown;
  error?: string;
}

export interface PanelDataBatchResponse {
  panels: Record<string, PanelDataResult>;
}

class CustomDashboardsAPI {
  constructor(private getToken: () => string | null) {}

  private headers(extra?: HeadersInit): HeadersInit {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return { ...headers, ...(extra ?? {}) };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${getApiUrl()}/api/v1/custom-dashboards${path}`;
    const response = await fetch(url, {
      ...init,
      headers: this.headers(init?.headers),
    });
    if (!response.ok) {
      let message = `Request failed: ${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async list(organizationId: string, projectId?: string | null): Promise<CustomDashboard[]> {
    const params = new URLSearchParams({ organizationId });
    if (projectId !== undefined && projectId !== null) {
      params.set('projectId', projectId);
    }
    const result = await this.request<{ dashboards: CustomDashboard[] }>(
      `?${params.toString()}`
    );
    return result.dashboards;
  }

  async getDefault(organizationId: string): Promise<CustomDashboard> {
    const params = new URLSearchParams({ organizationId });
    const result = await this.request<{ dashboard: CustomDashboard }>(
      `/default?${params.toString()}`
    );
    return result.dashboard;
  }

  async getById(id: string, organizationId: string): Promise<CustomDashboard> {
    const params = new URLSearchParams({ organizationId });
    const result = await this.request<{ dashboard: CustomDashboard }>(
      `/${id}?${params.toString()}`
    );
    return result.dashboard;
  }

  async create(payload: CreateDashboardPayload): Promise<CustomDashboard> {
    const result = await this.request<{ dashboard: CustomDashboard }>('', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result.dashboard;
  }

  async update(
    id: string,
    organizationId: string,
    payload: UpdateDashboardPayload
  ): Promise<CustomDashboard> {
    const params = new URLSearchParams({ organizationId });
    const result = await this.request<{ dashboard: CustomDashboard }>(
      `/${id}?${params.toString()}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
    return result.dashboard;
  }

  async setAsDefault(id: string, organizationId: string): Promise<CustomDashboard> {
    const params = new URLSearchParams({ organizationId });
    const result = await this.request<{ dashboard: CustomDashboard }>(
      `/${id}/set-default?${params.toString()}`,
      { method: 'POST', body: '{}' }
    );
    return result.dashboard;
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const params = new URLSearchParams({ organizationId });
    await this.request<void>(`/${id}?${params.toString()}`, {
      method: 'DELETE',
    });
  }

  async duplicate(id: string, organizationId: string, name?: string): Promise<CustomDashboard> {
    const params = new URLSearchParams({ organizationId });
    const result = await this.request<{ dashboard: CustomDashboard }>(
      `/${id}/duplicate?${params.toString()}`,
      { method: 'POST', body: JSON.stringify(name ? { name } : {}) }
    );
    return result.dashboard;
  }

  async listTemplates(): Promise<DashboardTemplateSummary[]> {
    const result = await this.request<{ templates: DashboardTemplateSummary[] }>('/templates');
    return result.templates;
  }

  async createFromTemplate(input: CreateFromTemplatePayload): Promise<CustomDashboard> {
    const result = await this.request<{ dashboard: CustomDashboard }>('/from-template', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.dashboard;
  }

  /** Append one panel; the "Add to dashboard" contract used by other pages. */
  async addPanel(
    id: string,
    organizationId: string,
    config: PanelConfig,
    layout?: { w?: number; h?: number }
  ): Promise<{ dashboard: CustomDashboard; panel: PanelInstance }> {
    const params = new URLSearchParams({ organizationId });
    return this.request<{ dashboard: CustomDashboard; panel: PanelInstance }>(
      `/${id}/panels?${params.toString()}`,
      { method: 'POST', body: JSON.stringify({ config, layout }) }
    );
  }

  /** Suggestions for the panel form pickers (metric names, services). */
  async getOptions(params: PickerOptionsParams): Promise<string[]> {
    const q = new URLSearchParams({ organizationId: params.organizationId, kind: params.kind });
    if (params.source) q.set('source', params.source);
    if (params.projectId) q.set('projectId', params.projectId);
    const result = await this.request<{ options: string[] }>(`/options?${q.toString()}`);
    return result.options;
  }

  async fetchPanelData(
    dashboardId: string,
    organizationId: string,
    panelIds?: string[],
    timeRange?: PanelTimeRange
  ): Promise<PanelDataBatchResponse> {
    return this.request<PanelDataBatchResponse>(
      `/${dashboardId}/panels/data`,
      {
        method: 'POST',
        body: JSON.stringify({ organizationId, panelIds, timeRange }),
      }
    );
  }

  /**
   * Returns the raw YAML text. Frontend triggers a download.
   */
  async exportYaml(id: string, organizationId: string): Promise<string> {
    const params = new URLSearchParams({ organizationId });
    const url = `${getApiUrl()}/api/v1/custom-dashboards/${id}/export-yaml?${params.toString()}`;
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) {
      throw new Error(`Failed to export dashboard: ${response.statusText}`);
    }
    return response.text();
  }

  async importYaml(organizationId: string, yamlText: string): Promise<CustomDashboard> {
    const result = await this.request<{ dashboard: CustomDashboard }>(
      '/import-yaml',
      {
        method: 'POST',
        body: JSON.stringify({ organizationId, yaml: yamlText }),
      }
    );
    return result.dashboard;
  }
}

export const customDashboardsAPI = new CustomDashboardsAPI(getAuthToken);
