/**
 * Microsoft Teams formatter.
 *
 * Emits an Adaptive Card wrapped in the `message` envelope that both the
 * Office 365 connector URLs (`*.webhook.office.com`) and Power Automate
 * Workflows accept. The serialized card is kept under a 24 KB budget (Teams
 * rejects bodies around 28 KB).
 */
import { isTeamsWebhookTarget } from '@logtide/shared';
import type { OutboundFormatter } from './types.js';
import { describeEvent, rawJsonFallback, type EventView, type Tone } from './event-view.js';

const LIMIT = {
  title: 500,
  description: 4000,
  factName: 100,
  factValue: 1000,
  facts: 10,
  bytes: 24000,
  json: 8000,
} as const;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 3))}...`;
}

function textColor(tone: Tone): string {
  if (tone === 'critical' || tone === 'high') return 'Attention';
  if (tone === 'medium') return 'Warning';
  if (tone === 'success') return 'Good';
  return 'Default';
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

interface CardParts {
  title: string;
  color: string;
  description?: string;
  facts: { title: string; value: string }[];
  footer: string;
  link?: string;
}

function cardFromParts(parts: CardParts): Record<string, unknown> {
  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: parts.title,
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
      color: parts.color,
    },
  ];
  if (parts.description) {
    body.push({ type: 'TextBlock', text: parts.description, wrap: true });
  }
  if (parts.facts.length > 0) {
    body.push({ type: 'FactSet', facts: parts.facts });
  }
  body.push({
    type: 'TextBlock',
    text: parts.footer,
    isSubtle: true,
    size: 'Small',
    wrap: true,
  });

  const content: Record<string, unknown> = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body,
  };
  if (parts.link) {
    content.actions = [{ type: 'Action.OpenUrl', title: 'Open in LogTide', url: parts.link }];
  }

  return {
    type: 'message',
    attachments: [
      { contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content },
    ],
  };
}

function size(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** Drop trailing facts, then shorten the description, until the card fits. */
function enforceBudget(parts: CardParts): Record<string, unknown> {
  let card = cardFromParts(parts);
  while (size(card) > LIMIT.bytes && parts.facts.length > 0) {
    parts.facts.pop();
    card = cardFromParts(parts);
  }
  while (size(card) > LIMIT.bytes && parts.description && parts.description.length > 4) {
    const overflow = size(card) - LIMIT.bytes;
    parts.description = truncate(
      parts.description,
      Math.max(4, parts.description.length - Math.max(overflow, 100))
    );
    card = cardFromParts(parts);
  }
  return card;
}

function buildCard(view: EventView): Record<string, unknown> {
  return enforceBudget({
    title: truncate(view.title, LIMIT.title),
    color: textColor(view.tone),
    description: view.description ? truncate(view.description, LIMIT.description) : undefined,
    facts: view.fields.slice(0, LIMIT.facts).map((f) => ({
      title: truncate(f.name, LIMIT.factName),
      value: truncate(f.value, LIMIT.factValue),
    })),
    footer: view.orgName ? `LogTide - ${view.orgName}` : 'LogTide',
    link: view.link && view.link.length <= 2000 && isHttpUrl(view.link) ? view.link : undefined,
  });
}

function jsonCard(body: unknown): Record<string, unknown> {
  return enforceBudget({
    title: 'LogTide event',
    color: 'Default',
    description: truncate(rawJsonFallback(body), LIMIT.json),
    facts: [],
    footer: 'LogTide',
  });
}

export const teamsFormatter: OutboundFormatter = {
  name: 'teams',
  matches: isTeamsWebhookTarget,
  format(body: unknown): unknown {
    try {
      const view = describeEvent(body);
      if (!view) return jsonCard(body);
      return buildCard(view);
    } catch {
      return jsonCard(body);
    }
  },
};
