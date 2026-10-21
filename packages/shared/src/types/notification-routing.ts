import type { NotificationEventType } from './notification-channel.js';

/** Event types accepted by GET /api/v1/notification-routing/preview. */
export const NOTIFICATION_ROUTING_EVENT_TYPES: readonly NotificationEventType[] = [
  'alert',
  'sigma',
  'incident',
  'error',
  'monitoring',
] as const;

/** One destination in the GET /api/v1/notification-routing/preview response. */
export interface NotificationRoutingDestination {
  id: string;
  name: string;
  /** Stored channel type as a plain string (new channel types are added over time). */
  type: string;
}

/** Fallback audience in the GET /api/v1/notification-routing/preview response. */
export type NotificationRoutingFallback = 'owners_admins_email';

/** Response of GET /api/v1/notification-routing/preview. */
export interface NotificationRoutingPreview {
  destinations: NotificationRoutingDestination[];
  fallback: NotificationRoutingFallback | null;
}
