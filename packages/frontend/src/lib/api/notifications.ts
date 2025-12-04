import { getApiBaseUrl } from '$lib/config';

export interface Notification {
  id: string;
  userId: string;
  type: 'alert' | 'system' | 'organization_invite' | 'project_update';
  title: string;
  message: string;
  read: boolean;
  organizationId: string | null;
  projectId: string | null;
  organizationName?: string;
  organizationSlug?: string;
  projectName?: string;
  metadata: any;
  createdAt: Date;
}

export interface GetNotificationsResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

export class NotificationsAPI {
  constructor(private getToken: () => string | null) { }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Get all notifications for current user
   */
  async getNotifications(options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<GetNotificationsResponse> {
    const params = new URLSearchParams();
    if (options?.unreadOnly) params.set('unreadOnly', 'true');
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());

    const queryString = params.toString();
    return this.request(`/notifications${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    await this.request(`/notifications/${notificationId}/read`, {
      method: 'PUT',
      body: JSON.stringify({}),
    });
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    await this.request('/notifications/read-all', {
      method: 'PUT',
      body: JSON.stringify({}),
    });
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    await this.request(`/notifications/${notificationId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Delete all notifications
   */
  async deleteAllNotifications(): Promise<void> {
    await this.request('/notifications/all', {
      method: 'DELETE',
    });
  }
}
