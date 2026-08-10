import type { OutboundFormatter } from './types.js';
import { discordFormatter } from './discord.js';

export type { OutboundFormatter } from './types.js';
export { discordFormatter } from './discord.js';

const FORMATTERS: OutboundFormatter[] = [discordFormatter];

/**
 * Rewrite an outbound body for destinations that refuse the event envelope.
 * Returns the body unchanged when no formatter claims the URL, so documented
 * receivers keep getting the envelope byte for byte.
 */
export function formatOutbound(url: string, body: unknown): unknown {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return body;
  }
  for (const formatter of FORMATTERS) {
    if (formatter.matches(parsed)) return formatter.format(body);
  }
  return body;
}
