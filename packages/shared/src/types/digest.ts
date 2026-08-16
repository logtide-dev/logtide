/**
 * Digest section catalog (#154 expansion)
 *
 * The digest email is assembled from a fixed set of sections. Each one can be
 * toggled per organization; the stored value is a PARTIAL map merged over the
 * defaults below, so a NULL column (or a missing key) always means "default".
 *
 * The five sections that shipped with the original digest stay enabled by
 * default; every section added by the expansion ships disabled so existing
 * subscribers keep receiving the exact same email.
 *
 * Backend Zod validation and the frontend toggle list are both generated from
 * DIGEST_SECTION_KEYS so they cannot drift from this catalog.
 */

export const DIGEST_SECTION_KEYS = [
  'logVolume',
  'topErrorServices',
  'newErrorGroups',
  'security',
  'uptime',
  'logBreakdown',
  'topErrorMessages',
  'traces',
  'metrics',
  'alerts',
  'securityActivity',
  'monitorPerformance',
  'usage',
  'webhooks',
  'teamActivity',
] as const;

export type DigestSectionKey = (typeof DIGEST_SECTION_KEYS)[number];

export type DigestSections = Record<DigestSectionKey, boolean>;

/** The five original sections on, the ten added by the expansion off. */
export const DIGEST_SECTION_DEFAULTS: DigestSections = {
  logVolume: true,
  topErrorServices: true,
  newErrorGroups: true,
  security: true,
  uptime: true,
  logBreakdown: false,
  topErrorMessages: false,
  traces: false,
  metrics: false,
  alerts: false,
  securityActivity: false,
  monitorPerformance: false,
  usage: false,
  webhooks: false,
  teamActivity: false,
};

/** Merge a stored partial over the defaults; ignores unknown keys defensively. */
export function mergeDigestSections(partial?: Partial<DigestSections> | null): DigestSections {
  const merged: DigestSections = { ...DIGEST_SECTION_DEFAULTS };
  if (!partial || typeof partial !== 'object') {
    return merged;
  }

  for (const key of DIGEST_SECTION_KEYS) {
    const value = partial[key];
    if (typeof value === 'boolean') {
      merged[key] = value;
    }
  }

  return merged;
}
