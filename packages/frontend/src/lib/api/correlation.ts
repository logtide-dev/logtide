/**
 * Correlation API Client
 *
 * Handles event correlation API calls for the correlation feature
 */

import { getApiBaseUrl } from '$lib/config';

export interface IdentifierMatch {
  type: string;
  value: string;
  sourceField: string;
}

export interface CorrelatedLog {
  id: string;
  time: string;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  metadata: Record<string, unknown> | null;
  traceId: string | null;
  projectId: string | null;
}

export interface CorrelationResult {
  identifier: {
    type: string;
    value: string;
  };
  logs: CorrelatedLog[];
  total: number;
  timeWindow: {
    from: string;
    to: string;
  };
}

export interface CorrelationParams {
  projectId: string;
  identifierValue: string;
  referenceTime?: string;
  timeWindowMinutes?: number;
  limit?: number;
}

class CorrelationAPI {
  private getToken(): string | null {
    try {
      const stored = localStorage.getItem('logtide_auth');
      if (stored) {
        const data = JSON.parse(stored);
        return data.token || null;
      }
    } catch {
      // ignore
    }
    return null;
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
   * Get correlated logs by identifier value
   */
  async getCorrelatedLogs(params: CorrelationParams): Promise<CorrelationResult> {
    const queryParams = new URLSearchParams({
      projectId: params.projectId,
    });

    if (params.referenceTime) {
      queryParams.set('referenceTime', params.referenceTime);
    }
    if (params.timeWindowMinutes) {
      queryParams.set('timeWindowMinutes', params.timeWindowMinutes.toString());
    }
    if (params.limit) {
      queryParams.set('limit', params.limit.toString());
    }

    const url = `${getApiBaseUrl()}/correlation/${encodeURIComponent(params.identifierValue)}?${queryParams}`;

    const response = await this.fetch<{ success: boolean; data: CorrelationResult }>(url);
    return response.data;
  }

  /**
   * Get identifiers for a specific log
   */
  async getLogIdentifiers(logId: string): Promise<IdentifierMatch[]> {
    const url = `${getApiBaseUrl()}/logs/${logId}/identifiers`;
    const response = await this.fetch<{ success: boolean; data: { identifiers: IdentifierMatch[] } }>(url);
    return response.data.identifiers;
  }

  /**
   * Get identifiers for multiple logs (batch)
   */
  async getLogIdentifiersBatch(logIds: string[]): Promise<Record<string, IdentifierMatch[]>> {
    if (logIds.length === 0) {
      return {};
    }

    const url = `${getApiBaseUrl()}/logs/identifiers/batch`;
    const response = await this.fetch<{
      success: boolean;
      data: { identifiers: Record<string, IdentifierMatch[]> };
    }>(url, {
      method: 'POST',
      body: JSON.stringify({ logIds }),
    });

    return response.data.identifiers;
  }
}

export const correlationAPI = new CorrelationAPI();
