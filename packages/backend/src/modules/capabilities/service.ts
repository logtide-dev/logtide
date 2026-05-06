/**
 * Capabilities Service
 *
 * Central service for checking and listing organizational capabilities.
 * The resolver is registered at boot time and is replaceable for downstream distributions.
 */

import type { CapabilityResolver } from './interface.js';
import { type CapabilityName, CAPABILITY_DESCRIPTIONS, CAPABILITY_NAMES } from './registry.js';
import { CapabilityError } from './error.js';
import { DefaultCapabilityResolver } from './default.js';

let resolver: CapabilityResolver = new DefaultCapabilityResolver();

/**
 * Register a custom capability resolver.
 * Call this at boot time to replace the default resolver with an external one
 * (e.g., reading from a database, license file, or subscription service).
 */
export function registerCapabilityResolver(newResolver: CapabilityResolver): void {
  resolver = newResolver;
}

/**
 * Get the current resolver (for testing or introspection)
 */
export function getCapabilityResolver(): CapabilityResolver {
  return resolver;
}

/**
 * Check if an organization has a specific capability.
 * Throws CapabilityError if the capability is not enabled.
 *
 * Usage:
 *   if (!(await capabilitiesService.has(ctx.organizationId, 'retention.extended'))) {
 *     throw new CapabilityError('retention.extended', ctx.organizationId);
 *   }
 */
export async function has(
  organizationId: string,
  capability: CapabilityName
): Promise<boolean> {
  return resolver.has(organizationId, capability);
}

/**
 * Assert that an organization has a capability, throwing if not.
 * Convenience wrapper for callsites that want to fail fast.
 */
export async function assertHas(
  organizationId: string,
  capability: CapabilityName
): Promise<void> {
  const result = await resolver.has(organizationId, capability);
  if (!result) {
    throw new CapabilityError(capability, organizationId);
  }
}

/**
 * List all capabilities for an organization with their resolved values and descriptions.
 */
export async function list(
  organizationId: string
): Promise<Array<{ name: CapabilityName; enabled: boolean; description: string }>> {
  const resolved = await resolver.list(organizationId);
  return CAPABILITY_NAMES.map((name) => ({
    name,
    enabled: resolved[name],
    description: CAPABILITY_DESCRIPTIONS[name],
  }));
}

/**
 * Check if a capability is globally enabled (no org context required).
 * Uses the default resolver's static config.
 */
export async function isGloballyEnabled(capability: CapabilityName): Promise<boolean> {
  return resolver.has('__global__', capability);
}

export { CapabilityError } from './error.js';
export { type CapabilityResolver } from './interface.js';
export { type CapabilityName, CAPABILITY_NAMES, CAPABILITY_DESCRIPTIONS, DEFAULT_CAPABILITIES } from './registry.js';
