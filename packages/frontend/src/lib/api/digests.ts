import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type DigestFrequency = 'daily' | 'weekly';

export interface DigestConfig {
  id: string;
  frequency: DigestFrequency;
  delivery_hour: number;
  delivery_day_of_week: number | null;
  enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DigestRecipient {
  id: string;
  email: string;
  user_id: string | null;
  subscribed: boolean;
  created_at: string;
}

export interface DigestConfigInput {
  frequency: DigestFrequency;
  deliveryHour: number;
  deliveryDayOfWeek?: number | null;
  enabled: boolean;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}

async function unwrapError(response: Response, fallback: string): Promise<never> {
  const error = await response.json().catch(() => ({ error: fallback }));
  throw new Error(error.error || fallback);
}

export const digestsAPI = {
  async getConfig(
    organizationId: string
  ): Promise<{ config: DigestConfig | null; recipients: DigestRecipient[] }> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/digests/config?organizationId=${organizationId}`
    );
    if (!response.ok) await unwrapError(response, 'Failed to load digest settings');
    return response.json();
  },

  async saveConfig(organizationId: string, input: DigestConfigInput): Promise<DigestConfig> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/digests/config?organizationId=${organizationId}`,
      { method: 'PUT', body: JSON.stringify(input) }
    );
    if (!response.ok) await unwrapError(response, 'Failed to save digest settings');
    return (await response.json()).config;
  },

  async deleteConfig(organizationId: string): Promise<void> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/digests/config?organizationId=${organizationId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) await unwrapError(response, 'Failed to delete digest settings');
  },

  async addRecipient(organizationId: string, email: string): Promise<DigestRecipient> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/digests/recipients?organizationId=${organizationId}`,
      { method: 'POST', body: JSON.stringify({ email }) }
    );
    if (!response.ok) await unwrapError(response, 'Failed to add recipient');
    return (await response.json()).recipient;
  },

  async removeRecipient(organizationId: string, recipientId: string): Promise<void> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/digests/recipients/${recipientId}?organizationId=${organizationId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) await unwrapError(response, 'Failed to remove recipient');
  },

  async resubscribeRecipient(
    organizationId: string,
    recipientId: string
  ): Promise<DigestRecipient> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/digests/recipients/${recipientId}/resubscribe?organizationId=${organizationId}`,
      { method: 'POST' }
    );
    if (!response.ok) await unwrapError(response, 'Failed to resubscribe recipient');
    return (await response.json()).recipient;
  },

  /**
   * Public one-click unsubscribe. No auth: the token from the email link is
   * the credential.
   */
  async unsubscribe(token: string): Promise<{ success: boolean; email: string }> {
    const response = await fetch(`${getApiUrl()}/api/v1/digests/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) await unwrapError(response, 'Invalid or expired unsubscribe link');
    return response.json();
  },
};
