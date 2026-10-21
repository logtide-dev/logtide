/**
 * Notification routing preview.
 *
 * Answers "who would be notified for this event type" before a rule is saved.
 *
 * What the dispatch paths do today (evidence for the rules below):
 *
 * | Event type | Job                                              | Specific channels      | Org defaults | Email fallback today                          |
 * |------------|--------------------------------------------------|------------------------|--------------|-----------------------------------------------|
 * | incident   | queue/jobs/incident-notification.ts:111-132,176-181 | getIncidentChannels    | yes          | members (all if critical/high, else owners/admins) |
 * | error      | queue/jobs/error-notification.ts:187-208,262-265 | getErrorGroupChannels  | yes          | owners/admins                                 |
 * | monitoring | queue/jobs/monitor-notification.ts:113-116,183-186 | getMonitorChannels     | yes          | same as incident                              |
 * | alert      | queue/jobs/alert-notification.ts:101-112         | getAlertRuleChannels   | NO           | none                                          |
 * | sigma      | queue/jobs/sigma-detection.ts:170-184 (via alert job) | NOT consumed      | NO           | none                                          |
 *
 * The preview implements the TARGET precedence for every type (spec section 9):
 * explicit channels first, else organization defaults; when nothing resolved
 * and SMTP is configured the notification goes by email to the organization
 * owners and admins. Destinations and fallback are mutually exclusive.
 * Known divergences from dispatch are listed in ROUTING_DISPATCH_GAPS.
 */

import type {
  NotificationEventType,
  NotificationRoutingPreview,
} from '@logtide/shared';
import { resolveChannelsForEvent, toPreview } from './resolver.js';

export interface RoutingPreviewInput {
  organizationId: string;
  eventType: NotificationEventType;
  channelIds?: string[];
}

export const ROUTING_DISPATCH_GAPS: readonly string[] = [
  'alert: organization default channels are not consulted by alert-notification.ts',
  'sigma: rule channels and organization defaults are not consumed by sigma-detection.ts',
  'all types: email fallback differs per job today (members by severity, owners and admins, or none); target is owners and admins when nothing resolved',
];

export async function resolveRoutingPreview(
  input: RoutingPreviewInput
): Promise<NotificationRoutingPreview> {
  // The same resolution the notification jobs use (resolver.ts).
  const routing = await resolveChannelsForEvent({
    organizationId: input.organizationId,
    eventType: input.eventType,
    explicitChannelIds: input.channelIds,
  });
  return toPreview(routing);
}
