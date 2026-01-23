/**
 * Identifier Patterns API Client
 *
 * Handles pattern management API calls for custom identifier patterns
 */

import { getApiBaseUrl } from '$lib/config';

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
  private getToken(): string | null {
    return sessionStorage.getItem('logtide_token');
  }

  private async fetch<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
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

  /**
   * Get all patterns for the organization (custom + defaults)
   */
  async listPatterns(): Promise<PatternListResponse> {
    const url = `${getApiBaseUrl()}/patterns`;
    const response = await this.fetch<{ success: boolean; data: PatternListResponse }>(url);
    return response.data;
  }

  /**
   * Get default patterns only
   */
  async getDefaultPatterns(): Promise<DefaultPattern[]> {
    const url = `${getApiBaseUrl()}/patterns/defaults`;
    const response = await this.fetch<{ success: boolean; data: DefaultPattern[] }>(url);
    return response.data;
  }

  /**
   * Create a new custom pattern
   */
  async createPattern(input: CreatePatternInput): Promise<IdentifierPattern> {
    const url = `${getApiBaseUrl()}/patterns`;
    const response = await this.fetch<{ success: boolean; data: IdentifierPattern }>(url, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return response.data;
  }

  /**
   * Update a pattern
   */
  async updatePattern(id: string, input: UpdatePatternInput): Promise<IdentifierPattern> {
    const url = `${getApiBaseUrl()}/patterns/${id}`;
    const response = await this.fetch<{ success: boolean; data: IdentifierPattern }>(url, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return response.data;
  }

  /**
   * Delete a pattern
   */
  async deletePattern(id: string): Promise<void> {
    const url = `${getApiBaseUrl()}/patterns/${id}`;
    await this.fetch<{ success: boolean }>(url, {
      method: 'DELETE',
    });
  }

  /**
   * Test a pattern against sample text
   */
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
