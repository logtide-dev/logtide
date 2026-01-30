/**
 * Sigma detection-related constants and derived types
 */

// Sigma severity levels
export const SIGMA_LEVELS = ['informational', 'low', 'medium', 'high', 'critical'] as const;
export type SigmaLevel = (typeof SIGMA_LEVELS)[number];

// Sigma rule statuses
export const SIGMA_STATUSES = [
  'experimental',
  'test',
  'stable',
  'deprecated',
  'unsupported',
] as const;
export type SigmaStatus = (typeof SIGMA_STATUSES)[number];

// Detection pack categories
export const PACK_CATEGORIES = ['reliability', 'security', 'database', 'business'] as const;
export type PackCategory = (typeof PACK_CATEGORIES)[number];
