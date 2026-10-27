import type { ChannelDisplayType } from '../utils/webhook-flavor.js';

// ============================================================================
// Notification Channel Types
// ============================================================================

/**
 * Notification channel type
 */
export type NotificationChannelType = 'email' | 'webhook' | 'pagerduty';

/**
 * Event types that can be associated with notification channels
 */
export type NotificationEventType = 'alert' | 'sigma' | 'incident' | 'error' | 'monitoring' | 'project_health';

/**
 * Event types in display order (routing page, previews)
 */
export const NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = [
  'alert',
  'sigma',
  'incident',
  'monitoring',
  'error',
  'project_health',
];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  alert: 'Alerts',
  sigma: 'Security detections',
  incident: 'Security incidents',
  monitoring: 'Uptime',
  error: 'Errors',
  project_health: 'Project health',
};

/**
 * Email channel configuration
 */
export interface EmailChannelConfig {
  recipients: string[];
}

/**
 * Webhook channel configuration
 */
export interface WebhookChannelConfig {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  auth?: {
    type: 'bearer' | 'basic';
    token?: string;
    username?: string;
    password?: string;
  };
}

/**
 * PagerDuty channel configuration (Events API v2 integration key)
 */
export interface PagerDutyChannelConfig {
  routingKey: string;
}

/**
 * Union of all channel configs
 */
export type ChannelConfig = EmailChannelConfig | WebhookChannelConfig | PagerDutyChannelConfig;

/**
 * Notification channel entity
 */
export interface NotificationChannel {
  id: string;
  organizationId: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  config: ChannelConfig;
  /** Server-computed destination flavor (slack, teams, discord...) from the raw URL; set on API responses. */
  displayType?: ChannelDisplayType;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a notification channel
 */
export interface CreateNotificationChannelInput {
  name: string;
  type: NotificationChannelType;
  config: ChannelConfig;
  description?: string;
}

/**
 * Input for updating a notification channel
 */
export interface UpdateNotificationChannelInput {
  name?: string;
  enabled?: boolean;
  config?: ChannelConfig;
  description?: string | null;
}

/**
 * Context passed to notification providers
 */
export interface NotificationContext {
  organizationId: string;
  organizationName: string;
  /** Set by the dispatch layer; identifies the channel being delivered to. */
  channelId?: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  metadata?: Record<string, unknown>;
  link?: string;
}

/**
 * Result of a notification delivery attempt
 */
export interface DeliveryResult {
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}
