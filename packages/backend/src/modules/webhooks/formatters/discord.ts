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
import { describeEvent, rawJsonFallback, type EventView, type EventViewField, type Tone } from './event-view.js';

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

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 3))}...`;
}

function toColor(tone: Tone): number {
  return COLOR[tone];
}

function toField(f: EventViewField): EmbedField {
  return {
    name: truncate(f.name, LIMIT.fieldName),
    value: truncate(f.value, LIMIT.fieldValue),
    inline: true,
  };
}

function jsonContent(body: unknown): { content: string } {
  const json = rawJsonFallback(body);
  return { content: truncate('```json\n' + json + '\n```', LIMIT.content) };
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

function buildEmbed(view: EventView): Embed {
  const embed: Embed = {
    title: truncate(view.title, LIMIT.title),
    color: toColor(view.tone),
    fields: view.fields.slice(0, LIMIT.fields).map(toField),
  };
  if (view.description) embed.description = truncate(view.description, LIMIT.description);
  if (view.link) embed.url = view.link;
  if (view.occurredAt) embed.timestamp = view.occurredAt;
  embed.footer = { text: view.orgName ? `LogTide - ${view.orgName}` : 'LogTide' };

  return enforceBudget(embed);
}

export const discordFormatter: OutboundFormatter = {
  name: 'discord',
  matches: isDiscordWebhookTarget,
  format(body: unknown): unknown {
    try {
      const view = describeEvent(body);
      if (!view) return jsonContent(body);
      return { embeds: [buildEmbed(view)] };
    } catch {
      // A 400 costs five retries and a DLQ entry; anything sendable beats that.
      return jsonContent(body);
    }
  },
};
