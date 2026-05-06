/**
 * Capability Resolver Interface
 *
 * Defines the contract for resolving organizational capabilities.
 * Implementations can read from static config, databases, external services, etc.
 */

import type { CapabilityName } from './registry.js';

export interface CapabilityResolver {
  /**
   * Check if an organization has a specific capability
   */
  has(organizationId: string, capability: CapabilityName): Promise<boolean>;

  /**
   * List all capabilities for an organization
   */
  list(organizationId: string): Promise<Record<CapabilityName, boolean>>;
}
