/**
 * Discord formatter.
 *
 * Discord's execute-webhook endpoint accepts only bodies carrying content,
 * embeds or file parts, so the raw envelope comes back as HTTP 400. Each event
 * becomes a single embed: envelope metadata maps to color/timestamp/footer and
 * the per-type data maps to fields.
 */
import { isDiscordWebhookTarget } from '@logtide/shared';
import type { OutboundFormatter } from './types.js';

const COLOR = {
  critical: 0xdc2626,
  high: 0xea580c,
  medium: 0xd97706,
  low: 0x2563eb,
  neutral: 0x6b7280,
  success: 0x16a34a,
} as const;

const LIMIT = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 10,
  content: 2000,
  total: 6000,
} as const;

interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

interface Embed {
  title: string;
  description?: string;
  color: number;
  url?: string;
  timestamp?: string;
  footer?: { text: string };
  fields: EmbedField[];
}

interface Envelope {
  type: string;
  occurredAt?: string;
  data: Record<string, unknown>;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 3))}...`;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function field(name: string, value: unknown): EmbedField | null {
  const rendered = str(value);
  if (rendered === undefined) return null;
  return {
    name: truncate(name, LIMIT.fieldName),
    value: truncate(rendered, LIMIT.fieldValue),
    inline: true,
  };
}

function push(fields: EmbedField[], candidate: EmbedField | null): void {
  if (candidate && fields.length < LIMIT.fields) fields.push(candidate);
}

function isEnvelope(body: unknown): body is Envelope {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Envelope;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null
  );
}

/** Humanize an event type for the fallback title: monitor.status_changed -> Monitor status changed. */
function humanizeType(type: string): string {
  const words = type.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function severityColor(severity: unknown): number {
  const key = typeof severity === 'string' ? severity.toLowerCase() : '';
  if (key === 'critical') return COLOR.critical;
  if (key === 'high') return COLOR.high;
  if (key === 'medium') return COLOR.medium;
  if (key === 'low') return COLOR.low;
  return COLOR.neutral;
}

function jsonContent(body: unknown): { content: string } {
  try {
    const json = JSON.stringify(body, null, 2) ?? String(body);
    return { content: truncate('```json\n' + json + '\n```', LIMIT.content) };
  } catch {
    return { content: 'LogTide event (payload could not be rendered)' };
  }
}

/** Drop trailing fields, then shorten the description, until the embed fits. */
function enforceBudget(embed: Embed): Embed {
  while (JSON.stringify(embed).length > LIMIT.total && embed.fields.length > 0) {
    embed.fields.pop();
  }
  while (
    JSON.stringify(embed).length > LIMIT.total &&
    embed.description &&
    embed.description.length > 4
  ) {
    const overflow = JSON.stringify(embed).length - LIMIT.total;
    embed.description = truncate(embed.description, Math.max(4, embed.description.length - overflow));
  }
  return embed;
}

function buildEmbed(envelope: Envelope): Embed {
  const data = envelope.data;
  const organization = data.organization as { name?: string } | undefined;
  const fields: EmbedField[] = [];

  let title = str(data.title) ?? humanizeType(envelope.type);
  let description = str(data.message);
  let color = severityColor(data.severity);

  switch (envelope.type) {
    case 'monitor.status_changed': {
      if (str(data.status) !== 'down') color = COLOR.success;
      push(fields, field('Status', data.status));
      push(fields, field('Target', data.target));
      push(fields, field('Error code', data.error_code));
      push(
        fields,
        field(
          'Response time',
          typeof data.response_time_ms === 'number' ? `${data.response_time_ms} ms` : null
        )
      );
      push(fields, field('Consecutive failures', data.consecutive_failures));
      push(fields, field('Downtime', data.downtime_duration));
      break;
    }
    case 'alert.triggered': {
      // This event carries no title/message/severity (alertTriggeredDataSchema).
      title = `Alert triggered: ${str(data.alert_name) ?? 'unnamed rule'}`;
      description = `${str(data.log_count) ?? '0'} logs in ${str(data.time_window) ?? '0'}s (threshold: ${str(data.threshold) ?? '0'})`;
      color = COLOR.high;
      const baseline = data.baseline_metadata as Record<string, unknown> | null;
      if (baseline) {
        push(fields, field('Baseline', baseline.baseline_value));
        push(fields, field('Current', baseline.current_value));
        push(fields, field('Deviation', baseline.deviation_ratio));
      }
      push(fields, field('Log count', data.log_count));
      push(fields, field('Threshold', data.threshold));
      push(
        fields,
        field('Time window', typeof data.time_window === 'number' ? `${data.time_window}s` : null)
      );
      break;
    }
    case 'incident.created': {
      push(fields, field('Incident', data.incident_id));
      const services = data.affected_services;
      if (Array.isArray(services) && services.length > 0) {
        push(fields, field('Affected services', services.join(', ')));
      }
      break;
    }
    case 'error.detected': {
      const project = data.project as { name?: string } | undefined;
      push(fields, field('Project', project?.name));
      push(fields, field('Service', data.service));
      push(fields, field('Exception', data.exception_type));
      push(fields, field('Language', data.language));
      if (data.is_new === true) push(fields, field('New', 'yes'));
      break;
    }
    default: {
      const metadata = data.metadata;
      if (typeof metadata === 'object' && metadata !== null) {
        for (const [key, value] of Object.entries(metadata as Record<string, unknown>).slice(0, 5)) {
          push(fields, field(key, value));
        }
      }
      break;
    }
  }

  const embed: Embed = {
    title: truncate(title, LIMIT.title),
    color,
    fields,
  };
  if (description) embed.description = truncate(description, LIMIT.description);
  const link = str(data.link);
  if (link) embed.url = link;
  if (typeof envelope.occurredAt === 'string') embed.timestamp = envelope.occurredAt;
  embed.footer = { text: organization?.name ? `LogTide - ${organization.name}` : 'LogTide' };

  return enforceBudget(embed);
}

export const discordFormatter: OutboundFormatter = {
  name: 'discord',
  matches: isDiscordWebhookTarget,
  format(body: unknown): unknown {
    try {
      if (!isEnvelope(body)) return jsonContent(body);
      return { embeds: [buildEmbed(body)] };
    } catch {
      // A 400 costs five retries and a DLQ entry; anything sendable beats that.
      return jsonContent(body);
    }
  },
};
