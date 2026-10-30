import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type {
  NotificationEventType,
  NotificationRoutingDestination,
  NotificationRoutingFallback,
  NotificationRoutingPreview,
} from '@logtide/shared';

export type {
  NotificationEventType,
  NotificationRoutingDestination,
  NotificationRoutingFallback,
  NotificationRoutingPreview,
};

export interface RoutingPreviewParams {
  organizationId: string;
  eventType: NotificationEventType;
  projectId?: string | null;
  channelIds?: string[];
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}

export const notificationRoutingAPI = {
  /**
   * Preview who would be notified for an event type, optionally for an
   * explicit channel selection.
   */
  async preview(
    params: RoutingPreviewParams,
    signal?: AbortSignal
  ): Promise<NotificationRoutingPreview> {
    const query = new URLSearchParams({
      organizationId: params.organizationId,
      eventType: params.eventType,
    });
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.channelIds && params.channelIds.length > 0) {
      query.set('channelIds', [...params.channelIds].sort().join(','));
    }

    const response = await fetchWithAuth(
      `${getApiUrl()}/api/v1/notification-routing/preview?${query}`,
      { signal }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to load routing preview');
    }

    return response.json();
  },
};
