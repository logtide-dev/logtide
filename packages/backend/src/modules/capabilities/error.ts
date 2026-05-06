/**
 * Capability Error
 *
 * Thrown when a capability check fails.
 */

import type { CapabilityName } from './registry.js';

export class CapabilityError extends Error {
  public readonly capability: CapabilityName;
  public readonly organizationId: string;

  constructor(capability: CapabilityName, organizationId: string) {
    super(`Capability '${capability}' is not enabled for organization '${organizationId}'`);
    this.name = 'CapabilityError';
    this.capability = capability;
    this.organizationId = organizationId;
  }
}
