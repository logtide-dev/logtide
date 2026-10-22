import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export interface IdentifierPattern {
  id?: string;
  name: string;
  displayName: string;
  description: string | null;
  pattern: string;
  fieldNames: string[];
  enabled: boolean;
  priority: number;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DefaultPattern {
  name: string;
  displayName: string;
  pattern: string;
  fieldNames: string[];
  priority: number;
  isBuiltIn: true;
}

export interface PatternListResponse {
  custom: IdentifierPattern[];
  defaults: DefaultPattern[];
}

export interface CreatePatternInput {
  name: string;
  displayName: string;
  description?: string;
  pattern: string;
  fieldNames?: string[];
  enabled?: boolean;
  priority?: number;
}

export interface UpdatePatternInput {
  displayName?: string;
  description?: string;
  pattern?: string;
  fieldNames?: string[];
  enabled?: boolean;
  priority?: number;
}

export interface PatternTestResult {
  matches: string[];
  count: number;
}

class PatternsAPI {
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

  // Every org-scoped call names the organization explicitly: the backend no longer
  // falls back to the user's newest organization.
  private orgQuery(organizationId: string): string {
    return `?organizationId=${encodeURIComponent(organizationId)}`;
  }

  async listPatterns(organizationId: string): Promise<PatternListResponse> {
    const url = `${getApiBaseUrl()}/patterns${this.orgQuery(organizationId)}`;
    const response = await this.fetch<{ success: boolean; data: PatternListResponse }>(url);
    return response.data;
  }

  async getDefaultPatterns(): Promise<DefaultPattern[]> {
    const url = `${getApiBaseUrl()}/patterns/defaults`;
    const response = await this.fetch<{ success: boolean; data: DefaultPattern[] }>(url);
    return response.data;
  }

  async createPattern(organizationId: string, input: CreatePatternInput): Promise<IdentifierPattern> {
    const url = `${getApiBaseUrl()}/patterns${this.orgQuery(organizationId)}`;
    const response = await this.fetch<{ success: boolean; data: IdentifierPattern }>(url, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return response.data;
  }

  async updatePattern(organizationId: string, id: string, input: UpdatePatternInput): Promise<IdentifierPattern> {
    const url = `${getApiBaseUrl()}/patterns/${id}${this.orgQuery(organizationId)}`;
    const response = await this.fetch<{ success: boolean; data: IdentifierPattern }>(url, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return response.data;
  }

  async deletePattern(organizationId: string, id: string): Promise<void> {
    const url = `${getApiBaseUrl()}/patterns/${id}${this.orgQuery(organizationId)}`;
    await this.fetch<{ success: boolean }>(url, {
      method: 'DELETE',
    });
  }

  async testPattern(pattern: string, text: string): Promise<PatternTestResult> {
    const url = `${getApiBaseUrl()}/patterns/test`;
    const response = await this.fetch<{ success: boolean; data: PatternTestResult }>(url, {
      method: 'POST',
      body: JSON.stringify({ pattern, text }),
    });
    return response.data;
  }
}

export const patternsAPI = new PatternsAPI();
