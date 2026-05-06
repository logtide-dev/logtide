/**
 * Capability Registry
 *
 * Central registry of all capability names as TypeScript string literals.
 * This enables autocomplete and compile-time checking at callsites.
 *
 * Adding a new capability:
 * 1. Add it to this union type
 * 2. Add a description in CAPABILITY_DESCRIPTIONS
 * 3. Add a default value in DEFAULT_CAPABILITIES
 */

// Capability names as string literals
export const CAPABILITY_NAMES = [
  // Retention
  'retention.extended',    // Retention windows beyond the default cap

  // Audit
  'audit.immutable',      // Append-only audit log storage

  // Authentication
  'auth.sso',             // SAML/OIDC authentication providers

  // Alerts
  'alerts.unlimited',     // No cap on the number of active alert rules

  // Dashboards
  'dashboards.unlimited', // No cap on saved dashboards
] as const;

export type CapabilityName = typeof CAPABILITY_NAMES[number];

/**
 * Descriptions for each capability, used for documentation and API responses
 */
export const CAPABILITY_DESCRIPTIONS: Record<CapabilityName, string> = {
  'retention.extended': 'Allows retention windows beyond the default cap',
  'audit.immutable': 'Enables append-only audit log storage',
  'auth.sso': 'Enables SAML/OIDC authentication providers',
  'alerts.unlimited': 'Removes the cap on active alert rules',
  'dashboards.unlimited': 'Removes the cap on saved dashboards',
};

/**
 * Default capabilities: all enabled for self-hosted users
 */
export const DEFAULT_CAPABILITIES: Record<CapabilityName, boolean> = {
  'retention.extended': true,
  'audit.immutable': true,
  'auth.sso': true,
  'alerts.unlimited': true,
  'dashboards.unlimited': true,
};
