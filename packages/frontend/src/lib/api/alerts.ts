import { getApiUrl } from '$lib/config';

export interface AlertRule {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  enabled: boolean;
  service: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold: number;
  timeWindow: number;
  emailRecipients: string[];
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertRuleInput {
  organizationId: string;
  projectId?: string | null;
  name: string;
  enabled?: boolean;
  service?: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold: number;
  timeWindow: number;
  emailRecipients: string[];
  webhookUrl?: string | null;
}

export interface UpdateAlertRuleInput {
  name?: string;
  enabled?: boolean;
  service?: string | null;
  level?: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold?: number;
  timeWindow?: number;
  emailRecipients?: string[];
  webhookUrl?: string | null;
}

export interface GetAlertsOptions {
  projectId?: string;
  enabledOnly?: boolean;
}

export interface AlertHistory {
  id: string;
  ruleId: string;
  ruleName: string;
  projectId: string | null;
  projectName: string | null;
  triggeredAt: string;
  logCount: number;
  notified: boolean;
  error: string | null;
  // Alert rule details
  threshold: number;
  timeWindow: number;
  service: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
}

export interface GetHistoryOptions {
  projectId?: string;
  limit?: number;
  offset?: number;
}

export class AlertsAPI {
  private getToken: () => string | null;

  constructor(getToken: () => string | null) {
    this.getToken = getToken;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const token = this.getToken();

    const response = await fetch(`${getApiUrl()}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async getAlertRules(
    organizationId: string,
    options: GetAlertsOptions = {}
  ): Promise<{ alertRules: AlertRule[] }> {
    const params = new URLSearchParams({ organizationId });
    if (options.projectId) params.append('projectId', options.projectId);
    if (options.enabledOnly) params.append('enabledOnly', 'true');

    return this.request(`/api/v1/alerts?${params.toString()}`);
  }

  async getAlertRule(
    id: string,
    organizationId: string
  ): Promise<{ alertRule: AlertRule }> {
    return this.request(`/api/v1/alerts/${id}?organizationId=${organizationId}`);
  }

  async createAlertRule(input: CreateAlertRuleInput): Promise<{ alertRule: AlertRule }> {
    return this.request('/api/v1/alerts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateAlertRule(
    organizationId: string,
    id: string,
    input: UpdateAlertRuleInput
  ): Promise<{ alertRule: AlertRule }> {
    return this.request(`/api/v1/alerts/${id}?organizationId=${organizationId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteAlertRule(id: string, organizationId: string): Promise<void> {
    return this.request(`/api/v1/alerts/${id}?organizationId=${organizationId}`, {
      method: 'DELETE',
    });
  }

  async getAlertHistory(
    organizationId: string,
    options: GetHistoryOptions = {}
  ): Promise<{ history: AlertHistory[]; total: number }> {
    const params = new URLSearchParams({ organizationId });
    if (options.projectId) params.append('projectId', options.projectId);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    return this.request(`/api/v1/alerts/history?${params.toString()}`);
  }
}

// Singleton instance
export const alertsAPI = new AlertsAPI(() => {
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
