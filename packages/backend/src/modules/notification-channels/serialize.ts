/**
 * Channel serialization for API responses.
 *
 * Secrets (bearer tokens, basic passwords, PagerDuty routing keys, secret-like
 * header values) never leave the server in clear text. Non-admin members also
 * only see the host of a webhook URL because Slack and Discord URLs carry the
 * token in the path. Jobs read raw configs straight from the service and never
 * go through this module.
 */

import type {
  ChannelConfig,
  NotificationChannel,
  PagerDutyChannelConfig,
  WebhookChannelConfig,
} from '@logtide/shared';

export const SECRET_MASK = '********';

const SECRET_HEADER_PATTERN = /authorization|token|key|secret|password/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingSecret(value: unknown): boolean {
  return typeof value !== 'string' || value === '' || value === SECRET_MASK;
}

export function reduceUrlToHost(url: unknown): string {
  if (typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return '';
  }
}

function sameOrigin(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function serializeConfig(
  type: NotificationChannel['type'],
  config: ChannelConfig,
  isAdmin: boolean
): ChannelConfig {
  if (!isRecord(config)) return config;

  if (type === 'pagerduty') {
    return { ...(config as unknown as PagerDutyChannelConfig), routingKey: SECRET_MASK };
  }

  if (type === 'webhook') {
    const source = config as unknown as WebhookChannelConfig;
    const out: Record<string, unknown> = { ...source };

    if (!isAdmin) {
      out.url = reduceUrlToHost(source.url);
    }

    if (isRecord(source.auth)) {
      const { token, password, ...rest } = source.auth as Record<string, unknown>;
      out.auth = {
        ...rest,
        ...(token || password ? { hasSecret: true } : {}),
      };
    }

    if (isRecord(source.headers)) {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(source.headers)) {
        headers[name] = !isAdmin || SECRET_HEADER_PATTERN.test(name) ? SECRET_MASK : value;
      }
      out.headers = headers;
    }

    return out as unknown as ChannelConfig;
  }

  return config;
}

export function serializeChannel(
  channel: NotificationChannel,
  opts: { isAdmin: boolean }
): NotificationChannel {
  return { ...channel, config: serializeConfig(channel.type, channel.config, opts.isAdmin) };
}

export function serializeChannels(
  channels: NotificationChannel[],
  opts: { isAdmin: boolean }
): NotificationChannel[] {
  return channels.map((c) => serializeChannel(c, opts));
}

/**
 * Fill masked or missing secrets of an incoming config from the stored one, so
 * editing a destination without retyping its secrets keeps them.
 */
export function mergeConfigSecrets(
  existing: ChannelConfig,
  incoming: ChannelConfig
): ChannelConfig {
  if (!isRecord(existing) || !isRecord(incoming)) return incoming;

  // PagerDuty
  if ('routingKey' in existing || 'routingKey' in incoming) {
    const stored = (existing as Partial<PagerDutyChannelConfig>).routingKey;
    const sent = (incoming as Partial<PagerDutyChannelConfig>).routingKey;
    if (isMissingSecret(sent) && typeof stored === 'string') {
      return { ...incoming, routingKey: stored } as ChannelConfig;
    }
    return incoming;
  }

  // Webhook
  if ('url' in incoming) {
    const stored = existing as Partial<WebhookChannelConfig>;
    const sent = incoming as unknown as WebhookChannelConfig;
    const out: Record<string, unknown> = { ...sent };
    // Stored secrets only follow the destination they were saved for: restoring
    // them for a new origin would let an admin who cannot read them send them
    // to a host of their choosing (test or edit with a retargeted URL).
    const restorable = sameOrigin(stored.url, sent.url);
    const retype = () => {
      throw new Error(
        'Invalid configuration: retype the secrets when the destination URL changes host'
      );
    };

    if (isRecord(sent.auth) && isRecord(stored.auth) && sent.auth.type === stored.auth.type) {
      const auth: Record<string, unknown> = { ...sent.auth };
      delete auth.hasSecret;
      if (isMissingSecret(auth.token) && typeof stored.auth.token === 'string') {
        if (!restorable) retype();
        auth.token = stored.auth.token;
      }
      if (isMissingSecret(auth.password) && typeof stored.auth.password === 'string') {
        if (!restorable) retype();
        auth.password = stored.auth.password;
      }
      out.auth = auth;
    } else if (isRecord(sent.auth)) {
      const auth: Record<string, unknown> = { ...sent.auth };
      delete auth.hasSecret;
      out.auth = auth;
    }

    if (isRecord(sent.headers)) {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(sent.headers)) {
        if (value === SECRET_MASK) {
          const previous = isRecord(stored.headers) ? stored.headers[name] : undefined;
          if (typeof previous === 'string') {
            if (!restorable) retype();
            headers[name] = previous;
          }
          // else: drop it, never send the literal mask as a header value
        } else {
          headers[name] = value;
        }
      }
      out.headers = headers;
    }

    return out as unknown as ChannelConfig;
  }

  return incoming;
}
