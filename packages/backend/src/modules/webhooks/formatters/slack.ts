/**
 * Slack formatter.
 *
 * Slack incoming webhooks expect `text` and/or Block Kit `blocks`. The event
 * view becomes a header, an optional description, a fields section, a context
 * line and an "Open in LogTide" button. Every piece of dynamic text is escaped
 * (`&`, `<`, `>`) so a log message containing `<!channel>` cannot ping anyone.
 */
import { isSlackWebhookTarget } from '@logtide/shared';
import type { OutboundFormatter } from './types.js';
import { describeEvent, rawJsonFallback, type EventView } from './event-view.js';

const LIMIT = {
  header: 150,
  section: 3000,
  fieldText: 2000,
  fields: 10,
  blocks: 50,
  text: 3000,
  url: 3000,
} as const;

export function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Cut to `max` characters without leaving half an escape entity behind. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, Math.max(1, max - 3)).replace(/&[a-z]*$/, '');
  return `${cut}...`;
}

function escaped(value: string, max: number): string {
  return truncate(escapeSlack(value), max);
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function buildBlocks(view: EventView): unknown[] {
  const blocks: unknown[] = [];

  // plain_text is never parsed for mentions or links, so the header is only truncated.
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: truncate(view.title, LIMIT.header), emoji: false },
  });

  if (view.description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: escaped(view.description, LIMIT.section) },
    });
  }

  if (view.fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: view.fields.slice(0, LIMIT.fields).map((f) => ({
        type: 'mrkdwn',
        text: truncate(`*${escapeSlack(f.name)}*\n${escapeSlack(f.value)}`, LIMIT.fieldText),
      })),
    });
  }

  const footer = view.orgName ? `LogTide - ${view.orgName}` : 'LogTide';
  const context = view.occurredAt ? `${footer} - ${view.occurredAt}` : footer;
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: escaped(context, LIMIT.section) }],
  });

  if (view.link && isHttpUrl(view.link) && view.link.length <= LIMIT.url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in LogTide', emoji: false },
          url: view.link,
        },
      ],
    });
  }

  return blocks.slice(0, LIMIT.blocks);
}

function jsonText(body: unknown): { text: string } {
  const json = escapeSlack(rawJsonFallback(body));
  return { text: '```' + truncate(json, LIMIT.text - 6) + '```' };
}

export const slackFormatter: OutboundFormatter = {
  name: 'slack',
  matches: isSlackWebhookTarget,
  format(body: unknown): unknown {
    try {
      const view = describeEvent(body);
      if (!view) return jsonText(body);
      return { text: escaped(view.title, LIMIT.text), blocks: buildBlocks(view) };
    } catch {
      return jsonText(body);
    }
  },
};
