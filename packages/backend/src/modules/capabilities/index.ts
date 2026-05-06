/**
 * Capabilities Module
 *
 * Feature gating through a capability system.
 *
 * Usage:
 *   import { assertHas, CapabilityError } from './modules/capabilities/index.js';
 *
 *   // At a callsite:
 *   if (!(await assertHas(ctx.organizationId, 'retention.extended'))) {
 *     throw new CapabilityError('retention.extended', ctx.organizationId);
 *   }
 *
 * Environment variables (for the default resolver):
 *   CAPABILITY_RETENTION_EXTENDED=false
 *   CAPABILITY_AUDIT_IMMUTABLE=false
 *   CAPABILITY_AUTH_SSO=false
 *   CAPABILITY_ALERTS_UNLIMITED=false
 *   CAPABILITY_DASHBOARDS_UNLIMITED=false
 */

export { capabilitiesRoutes } from './routes.js';
export {
  has,
  assertHas,
  list,
  isGloballyEnabled,
  registerCapabilityResolver,
  getCapabilityResolver,
  CapabilityError,
  type CapabilityResolver,
  type CapabilityName,
  CAPABILITY_NAMES,
  CAPABILITY_DESCRIPTIONS,
  DEFAULT_CAPABILITIES,
} from './service.js';
