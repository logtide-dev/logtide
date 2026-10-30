/**
 * One place that turns a stored webhook channel config into the request
 * settings (method + headers incl. auth) so the Test button and the queued
 * notification jobs send identical requests.
 */
import type { WebhookChannelConfig } from '@logtide/shared';

export function buildWebhookRequestHeaders(config: WebhookChannelConfig): Record<string, string> {
  const headers: Record<string, string> = { ...(config.headers || {}) };
  const auth = config.auth;
  if (auth) {
    if (auth.type === 'bearer' && auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else if (auth.type === 'basic' && auth.username && auth.password) {
      const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }
  }
  return headers;
}

export interface WebhookRequestSettings {
  channelId: string;
  method?: string;
  headers: Record<string, string>;
}

export function buildWebhookRequestSettings(
  channelId: string,
  config: WebhookChannelConfig
): WebhookRequestSettings {
  return { channelId, method: config.method, headers: buildWebhookRequestHeaders(config) };
}
