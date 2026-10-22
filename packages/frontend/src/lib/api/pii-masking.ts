import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type PiiAction = 'mask' | 'redact' | 'hash';
export type PiiPatternType = 'builtin' | 'field_name' | 'custom';

export interface PiiMaskingRule {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  displayName: string;
  description: string | null;
  patternType: PiiPatternType;
  regexPattern: string | null;
  fieldNames: string[];
  action: PiiAction;
  enabled: boolean;
  priority: number;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePiiRuleInput {
  name: string;
  displayName: string;
  description?: string;
  patternType: PiiPatternType;
  regexPattern?: string;
  fieldNames?: string[];
  action: PiiAction;
  enabled?: boolean;
  priority?: number;
  projectId?: string;
}

export interface UpdatePiiRuleInput {
  displayName?: string;
  description?: string;
  regexPattern?: string;
  fieldNames?: string[];
  action?: PiiAction;
  enabled?: boolean;
  priority?: number;
}

export interface TestMaskingResult {
  message?: string;
  metadata?: Record<string, unknown>;
  maskedFields: string[];
}

class PiiMaskingAPI {
  private async fetch<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = getAuthToken();
    const headers: HeadersInit = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Every call names the organization explicitly: the backend no longer falls back
  // to the user's newest organization.
  private orgQuery(organizationId: string, extra?: Record<string, string | undefined>): string {
    const params = new URLSearchParams({ organizationId });
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (v) params.set(k, v);
    }
    return `?${params.toString()}`;
  }

  async listRules(organizationId: string, projectId?: string): Promise<PiiMaskingRule[]> {
    const url = `${getApiBaseUrl()}/pii-masking/rules${this.orgQuery(organizationId, { projectId })}`;
    const response = await this.fetch<{ success: boolean; data: PiiMaskingRule[] }>(url);
    return response.data;
  }

  async createRule(organizationId: string, input: CreatePiiRuleInput): Promise<PiiMaskingRule> {
    const url = `${getApiBaseUrl()}/pii-masking/rules${this.orgQuery(organizationId)}`;
    const response = await this.fetch<{ success: boolean; data: PiiMaskingRule }>(url, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return response.data;
  }

  async updateRule(organizationId: string, id: string, input: UpdatePiiRuleInput): Promise<PiiMaskingRule> {
    const url = `${getApiBaseUrl()}/pii-masking/rules/${id}${this.orgQuery(organizationId)}`;
    const response = await this.fetch<{ success: boolean; data: PiiMaskingRule }>(url, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return response.data;
  }

  async deleteRule(organizationId: string, id: string): Promise<void> {
    const url = `${getApiBaseUrl()}/pii-masking/rules/${id}${this.orgQuery(organizationId)}`;
    await this.fetch<{ success: boolean }>(url, {
      method: 'DELETE',
    });
  }

  async testMasking(
    organizationId: string,
    message?: string,
    metadata?: Record<string, unknown>,
    projectId?: string
  ): Promise<TestMaskingResult> {
    const url = `${getApiBaseUrl()}/pii-masking/test${this.orgQuery(organizationId)}`;
    const response = await this.fetch<{ success: boolean; data: TestMaskingResult }>(url, {
      method: 'POST',
      body: JSON.stringify({ message, metadata, projectId }),
    });
    return response.data;
  }
}

export const piiMaskingAPI = new PiiMaskingAPI();
