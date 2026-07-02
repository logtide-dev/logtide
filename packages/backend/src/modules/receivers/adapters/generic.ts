import type { LogLevel } from '@logtide/shared';
import { LOG_LEVELS } from '@logtide/shared';
import type { ReceiverAdapter } from './types.js';

/** Resolve a dot-path ("a.b.c") into a nested object. */
export function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const LEVEL_SYNONYMS: Record<string, LogLevel> = {
  warning: 'warn',
  fatal: 'critical',
  err: 'error',
  crit: 'critical',
};

function coerceLevel(
  value: unknown,
  levelMap: Record<string, LogLevel> | undefined,
  fallback: LogLevel
): LogLevel {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const raw = String(value).toLowerCase();
  if (levelMap) {
    for (const [key, mapped] of Object.entries(levelMap)) {
      if (key.toLowerCase() === raw) return mapped;
    }
  }
  if ((LOG_LEVELS as readonly string[]).includes(raw)) return raw as LogLevel;
  if (raw in LEVEL_SYNONYMS) return LEVEL_SYNONYMS[raw];
  return fallback;
}

export const genericAdapter: ReceiverAdapter = (payload, receiver) => {
  const mapping = receiver.fieldMapping ?? {};
  const defaults = mapping.defaults ?? {};

  const messageRaw = mapping.message ? getPath(payload, mapping.message) : undefined;
  const message =
    typeof messageRaw === 'string' && messageRaw.length > 0 ? messageRaw : 'Received event';

  const serviceRaw = mapping.service ? getPath(payload, mapping.service) : undefined;
  const service = (
    typeof serviceRaw === 'string' && serviceRaw.length > 0
      ? serviceRaw
      : (defaults.service ?? receiver.name)
  ).slice(0, 100);

  const level = coerceLevel(
    mapping.level ? getPath(payload, mapping.level) : undefined,
    mapping.levelMap,
    defaults.level ?? 'info'
  );

  let time = new Date().toISOString();
  if (mapping.timestamp) {
    const ts = getPath(payload, mapping.timestamp);
    if (typeof ts === 'string' || typeof ts === 'number') {
      const parsed = new Date(ts);
      if (!Number.isNaN(parsed.getTime())) time = parsed.toISOString();
    }
  }

  return {
    kind: 'logs',
    logs: [
      {
        time,
        service,
        level,
        message,
        metadata: {
          receiver: { id: receiver.id, name: receiver.name, adapter: 'generic' },
          payload,
        },
      },
    ],
  };
};
