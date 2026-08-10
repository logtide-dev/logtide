/**
 * Discord webhook URL detection.
 *
 * Shared by the backend outbound formatter and the frontend channel form badge
 * so both agree on exactly which destinations get Discord-shaped payloads.
 */

const WEBHOOK_PATH = /^\/api(\/v\d+)?\/webhooks\//;

/** True when the URL is a Discord webhook endpoint expecting Discord's own JSON. */
export function isDiscordWebhookTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const isDiscordHost =
    host === 'discord.com' ||
    host === 'discordapp.com' ||
    host.endsWith('.discord.com') ||
    host.endsWith('.discordapp.com');
  if (!isDiscordHost) return false;

  const path = url.pathname;
  if (!WEBHOOK_PATH.test(path)) return false;

  // Discord also exposes Slack- and GitHub-compatible endpoints on the same
  // webhook. Whoever appended those suffixes wants that payload shape, so the
  // body is left untouched.
  if (path.endsWith('/slack') || path.endsWith('/github')) return false;

  return true;
}

/** String variant; malformed input is simply not a Discord target. */
export function isDiscordWebhookUrl(url: string): boolean {
  try {
    return isDiscordWebhookTarget(new URL(url));
  } catch {
    return false;
  }
}
