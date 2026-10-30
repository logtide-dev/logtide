import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type {
  NotificationChannelType,
  NotificationEventType,
  ChannelConfig,
  EmailChannelConfig,
  WebhookChannelConfig,
  PagerDutyChannelConfig,
  ChannelDisplayType,
} from '@logtide/shared';

export type {
  NotificationChannelType,
  NotificationEventType,
  ChannelConfig,
  EmailChannelConfig,
  WebhookChannelConfig,
  PagerDutyChannelConfig,
  ChannelDisplayType,
};

export interface RoutingOverride {
  eventType: NotificationEventType;
  kind: 'alert_rule' | 'sigma_rule' | 'monitor' | 'error_group';
  id: string;
  name: string;
  channels: { id: string; name: string; type: ChannelDisplayType }[];
}

export interface TestUnsavedInput {
  organizationId: string;
  channelId?: string;
  type: NotificationChannelType;
  config: ChannelConfig;
}

export interface NotificationChannel {
  id: string;
  organizationId: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  config: ChannelConfig;
  /** Server-computed flavor; prefer it over deriving from the (host-only for members) URL. */
  displayType?: ChannelDisplayType;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotificationChannelInput {
  name: string;
  type: NotificationChannelType;
  config: ChannelConfig;
  description?: string;
}

export interface UpdateNotificationChannelInput {
  name?: string;
  enabled?: boolean;
  config?: ChannelConfig;
  description?: string | null;
}

export interface TestChannelResult {
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
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

export const notificationChannelsAPI = {
  /**
   * List all notification channels for an organization
   */
  async list(
    organizationId: string,
    options?: { enabledOnly?: boolean; type?: NotificationChannelType }
  ): Promise<NotificationChannel[]> {
    const params = new URLSearchParams({ organizationId });
    if (options?.enabledOnly) params.set('enabled', 'true');
    if (options?.type) params.set('type', options.type);

    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels?${params}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch destinations' }));
      throw new Error(error.error || 'Failed to fetch destinations');
    }

    const data = await response.json();
    return data.channels;
  },

  /**
   * Get a single notification channel
   */
  async get(id: string, organizationId: string): Promise<NotificationChannel> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels/${id}?${params}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch destination' }));
      throw new Error(error.error || 'Failed to fetch destination');
    }

    const data = await response.json();
    return data.channel;
  },

  /**
   * Create a new notification channel
   */
  async create(organizationId: string, input: CreateNotificationChannelInput): Promise<NotificationChannel> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels?${params}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create destination' }));
      throw new Error(error.error || 'Failed to create destination');
    }

    const data = await response.json();
    return data.channel;
  },

  /**
   * Update a notification channel
   */
  async update(
    id: string,
    organizationId: string,
    input: UpdateNotificationChannelInput
  ): Promise<NotificationChannel> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels/${id}?${params}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update destination' }));
      throw new Error(error.error || 'Failed to update destination');
    }

    const data = await response.json();
    return data.channel;
  },

  /**
   * Delete a notification channel
   */
  async delete(id: string, organizationId: string): Promise<void> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels/${id}?${params}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete destination' }));
      throw new Error(error.error || 'Failed to delete destination');
    }
  },

  /**
   * Test a notification channel
   */
  async test(id: string, organizationId: string): Promise<TestChannelResult> {
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to test destination' }));
      throw new Error(error.error || 'Failed to test destination');
    }

    const data = await response.json();
    return data.result;
  },

  /**
   * Test a destination configuration before it is saved. In edit mode pass
   * channelId so blank secrets fall back to the stored ones.
   */
  async testUnsaved(input: TestUnsavedInput): Promise<TestChannelResult> {
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels/test`, {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to test destination' }));
      throw new Error(error.error || 'Failed to test destination');
    }

    const data = await response.json();
    return data.result;
  },

  /**
   * Rules, monitors and error groups that override the default routing
   */
  async getOverrides(organizationId: string): Promise<RoutingOverride[]> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/notification-channels/overrides?${params}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch overrides' }));
      throw new Error(error.error || 'Failed to fetch overrides');
    }

    const data = await response.json();
    return data.overrides;
  },

  /**
   * Get all organization default channels
   */
  async getDefaults(organizationId: string): Promise<Record<NotificationEventType, NotificationChannel[]>> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/notification-channels/defaults?${params}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch defaults' }));
      throw new Error(error.error || 'Failed to fetch defaults');
    }

    const data = await response.json();
    return data.defaults;
  },

  /**
   * Get default channels for a specific event type
   */
  async getDefaultsForType(
    organizationId: string,
    eventType: NotificationEventType
  ): Promise<NotificationChannel[]> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/notification-channels/defaults/${eventType}?${params}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch defaults' }));
      throw new Error(error.error || 'Failed to fetch defaults');
    }

    const data = await response.json();
    return data.channels;
  },

  /**
   * Set default channels for an event type
   */
  async setDefaults(
    organizationId: string,
    eventType: NotificationEventType,
    channelIds: string[]
  ): Promise<void> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/notification-channels/defaults/${eventType}?${params}`,
      {
        method: 'PUT',
        body: JSON.stringify({ channelIds }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to set defaults' }));
      throw new Error(error.error || 'Failed to set defaults');
    }
  },

  /**
   * Get channels for an alert rule
   */
  async getAlertRuleChannels(alertRuleId: string): Promise<NotificationChannel[]> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/notification-channels/alert-rules/${alertRuleId}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch destinations' }));
      throw new Error(error.error || 'Failed to fetch destinations');
    }

    const data = await response.json();
    return data.channels;
  },

  /**
   * Get channels for a sigma rule
   */
  async getSigmaRuleChannels(sigmaRuleId: string): Promise<NotificationChannel[]> {
    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/notification-channels/sigma-rules/${sigmaRuleId}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch destinations' }));
      throw new Error(error.error || 'Failed to fetch destinations');
    }

    const data = await response.json();
    return data.channels;
  },
};
