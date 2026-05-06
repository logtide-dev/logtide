/**
 * Default Capability Resolver
 *
 * Resolves capabilities from environment variables or static config.
 * All capabilities are enabled by default for self-hosted users.
 * Environment variables take the form: CAPABILITY_<NAME> (e.g., CAPABILITY_RETENTION_EXTENDED=false)
 */

import type { CapabilityResolver } from './interface.js';
import {
  type CapabilityName,
  CAPABILITY_NAMES,
  DEFAULT_CAPABILITIES,
} from './registry.js';

/**
 * Default resolver: reads from env vars, falls back to defaults (all enabled).
 * Env vars take precedence and allow operators to selectively disable features.
 */
export class DefaultCapabilityResolver implements CapabilityResolver {
  private readonly capabilities: Record<CapabilityName, boolean>;
  private initialized = false;

  constructor() {
    this.capabilities = { ...DEFAULT_CAPABILITIES };
  }

  private initialize(): void {
    if (this.initialized) return;

    for (const name of CAPABILITY_NAMES) {
      // Map 'retention.extended' -> 'CAPABILITY_RETENTION_EXTENDED'
      const envKey = `CAPABILITY_${name.replace(/\./g, '_').toUpperCase()}`;
      const envValue = process.env[envKey];

      if (envValue !== undefined) {
        this.capabilities[name] = envValue === 'true' || envValue === '1';
      }
    }

    this.initialized = true;
  }

  async has(_organizationId: string, capability: CapabilityName): Promise<boolean> {
    this.initialize();
    return this.capabilities[capability];
  }

  async list(_organizationId: string): Promise<Record<CapabilityName, boolean>> {
    this.initialize();
    return { ...this.capabilities };
  }
}
