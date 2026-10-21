/**
 * PagerDuty Events API v2 body builder (pure, no I/O).
 */

export const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export type PagerDutyAction = 'trigger' | 'resolve';
export type PagerDutyInputSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export interface PagerDutyEventInput {
  routingKey: string;
  action: PagerDutyAction;
  dedupKey: string;
  summary?: string;
  source?: string;
  severity?: PagerDutyInputSeverity;
  link?: string;
  component?: string;
  details?: Record<string, unknown>;
  occurredAt?: Date;
}

const SUMMARY_MAX = 1024;
const DEDUP_MAX = 255;
const DETAILS_MAX_BYTES = 20000;

export function toPagerDutySeverity(
  severity: PagerDutyInputSeverity | string | undefined
): 'critical' | 'error' | 'warning' | 'info' {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'informational':
      return 'info';
    default:
      return 'error';
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function safeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  try {
    const json = JSON.stringify(details);
    if (json !== undefined && Buffer.byteLength(json) <= DETAILS_MAX_BYTES) return details;
    return { truncated: true };
  } catch {
    return { truncated: true };
  }
}

export function buildPagerDutyEvent(input: PagerDutyEventInput): Record<string, unknown> {
  const dedupKey = truncate(input.dedupKey, DEDUP_MAX);

  if (input.action === 'resolve') {
    return { routing_key: input.routingKey, event_action: 'resolve', dedup_key: dedupKey };
  }

  const payload: Record<string, unknown> = {
    summary: truncate(input.summary || 'LogTide notification', SUMMARY_MAX),
    source: input.source || 'LogTide',
    severity: toPagerDutySeverity(input.severity),
    timestamp: (input.occurredAt ?? new Date()).toISOString(),
  };
  if (input.component) payload.component = input.component;
  const details = safeDetails(input.details);
  if (details) payload.custom_details = details;

  const body: Record<string, unknown> = {
    routing_key: input.routingKey,
    event_action: 'trigger',
    dedup_key: dedupKey,
    payload,
    client: 'LogTide',
  };
  if (input.link && isHttpUrl(input.link)) {
    body.client_url = input.link;
    body.links = [{ href: input.link, text: 'Open in LogTide' }];
  }
  return body;
}
