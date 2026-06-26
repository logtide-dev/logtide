export {
  CAPABILITIES,
  CAPABILITY_NAMES,
  isBooleanCapability,
  isLimitOrQuotaCapability,
  isQuotaCapability,
  isKnownCapability,
  type CapabilityName,
  type CapabilityDef,
  type QuotaWindow,
} from './registry.js';

export {
  DbCapabilityResolver,
  type CapabilityResolver,
  type EntitlementValue,
} from './resolver.js';

export {
  capabilities,
  setCapabilityResolver,
  getCapabilityResolver,
} from './facade.js';

export { CapabilityError, QuotaExceededError } from './errors.js';

export {
  assertCapability,
  assertWithinLimit,
  assertWithinUsageQuota,
} from './enforce.js';

export { quotaFlagCache } from './quota-cache.js';
export { QuotaEvaluator } from './quota-evaluator.js';
export { withLimitLock } from './limit-lock.js';
