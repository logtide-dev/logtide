import type { OrgRole } from '@logtide/shared';

/**
 * The Upgrade / Manage billing buttons are shown only when the backend
 * advertises the handoff (auth config `upgradeEnabled`) AND the viewer is an
 * owner or admin of the current organization.
 */
export function canShowUpgradeCta(
  upgradeEnabled: boolean | undefined,
  role: OrgRole | undefined | null
): boolean {
  return upgradeEnabled === true && (role === 'owner' || role === 'admin');
}

/** True when any capability with a configured limit is at or over it. */
export function anyCapabilityAtLimit(
  caps: Array<{ current: number; limit: number | null }>
): boolean {
  return caps.some((c) => c.limit !== null && c.current >= c.limit);
}
