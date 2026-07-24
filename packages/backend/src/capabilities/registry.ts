import type { MeteringEventType } from '../modules/metering/types.js';

/**
 * Capability registry: the single source of truth for feature gates (#214).
 * Adding a capability = add one entry here. No migration required because
 * storage (organization_entitlements) is key-value.
 *
 * Kinds:
 *  - boolean: on/off gate, compared as a flag.
 *  - limit:   static numeric cap compared to a caller-supplied COUNT(*). null = unlimited.
 *  - quota:   consumption cap compared to metered usage (#212). null = unlimited.
 *             `signal` is the #212 metering event type to aggregate; `window` is how to read it.
 *             `signal`/`window` live ONLY in the registry, never in the DB.
 */

export type QuotaWindow = 'calendar_month' | 'point_in_time';

export interface BooleanCapabilityDef {
  kind: 'boolean';
  defaultEnabled: boolean;
  description: string;
}

export interface LimitCapabilityDef {
  kind: 'limit';
  defaultLimit: number | null;
  description: string;
}

export interface QuotaCapabilityDef {
  kind: 'quota';
  defaultLimit: number | null;
  signal: MeteringEventType;
  window: QuotaWindow;
  description: string;
}

export type CapabilityDef =
  | BooleanCapabilityDef
  | LimitCapabilityDef
  | QuotaCapabilityDef;

export const CAPABILITIES = {
  // Boolean gates (OSS-permissive: enabled).
  'auth.sso': {
    kind: 'boolean',
    defaultEnabled: true,
    description: 'Single sign-on / external auth provider selection',
  },
  'detection.advanced': {
    kind: 'boolean',
    defaultEnabled: true,
    description: 'Advanced Sigma / detection packs availability',
  },
  'audit.enabled': {
    kind: 'boolean',
    defaultEnabled: true,
    description: 'Whether audit-log recording is active for the org',
  },
  'isolation.dedicated': {
    kind: 'boolean',
    defaultEnabled: true,
    description: 'Dedicated storage/reservoir routing eligibility',
  },

  // Static numeric caps (OSS-permissive: null = unlimited).
  'alerts.max_rules': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Maximum number of alert rules',
  },
  'notifications.max_channels': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Maximum number of notification channels',
  },
  'apikeys.max': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Maximum number of API keys',
  },
  'audit.retention_days': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Audit-log retention cap in days',
  },
  'sigma.max_active_rules': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Maximum enabled Sigma rules per organization',
  },
  'dashboards.max_custom': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Maximum custom dashboards per organization',
  },
  'receivers.max': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Maximum inbound webhook receivers per organization',
  },
  'digests.max_recipients': {
    kind: 'limit',
    defaultLimit: null,
    description: 'Maximum digest email recipients per organization',
  },

  // Consumption quotas (OSS-permissive: null = unlimited). signal maps to #212 metering types.
  'ingestion.max_bytes_monthly': {
    kind: 'quota',
    defaultLimit: null,
    signal: 'logs.ingested.bytes',
    window: 'calendar_month',
    description: 'Month-to-date ingested bytes cap (hard-block ingestion)',
  },
  'ingestion.max_events_monthly': {
    kind: 'quota',
    defaultLimit: null,
    signal: 'logs.ingested.events',
    window: 'calendar_month',
    description: 'Month-to-date ingested events cap (hard-block ingestion)',
  },
  'storage.max_bytes': {
    kind: 'quota',
    defaultLimit: null,
    signal: 'storage.snapshot',
    window: 'point_in_time',
    description: 'Current stored bytes cap (hard-block ingestion). Read from the latest storage.snapshot (daily estimate: logical bytes within retention).',
  },
  'tracing.max_spans_monthly': {
    kind: 'quota',
    defaultLimit: null,
    signal: 'spans.ingested',
    window: 'calendar_month',
    description: 'Month-to-date ingested spans cap (hard-block span ingestion)',
  },
} as const satisfies Record<string, CapabilityDef>;

export type CapabilityName = keyof typeof CAPABILITIES;

export const CAPABILITY_NAMES = Object.keys(CAPABILITIES) as CapabilityName[];

/** Narrowing helpers used by the resolver and admin validation. */
export function isBooleanCapability(name: CapabilityName): boolean {
  return CAPABILITIES[name].kind === 'boolean';
}

export function isLimitOrQuotaCapability(name: CapabilityName): boolean {
  const kind = CAPABILITIES[name].kind;
  return kind === 'limit' || kind === 'quota';
}

export function isQuotaCapability(name: CapabilityName): boolean {
  return CAPABILITIES[name].kind === 'quota';
}

export function isKnownCapability(name: string): name is CapabilityName {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, name);
}
