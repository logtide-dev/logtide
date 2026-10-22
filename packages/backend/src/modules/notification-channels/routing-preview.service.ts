/**
 * Notification routing preview.
 *
 * Answers "who would be notified for this event type" before a rule is saved.
 *
 * Every notification job (alert, sigma, incident, error, monitoring) resolves
 * its destinations through resolveChannelsForEvent, the same function the
 * preview uses, so they agree by construction (see the parity test).
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
  'alert: jobs queued by a pre-1.6 worker (no kind) keep rule channels only: no organization defaults, no email fallback',
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
