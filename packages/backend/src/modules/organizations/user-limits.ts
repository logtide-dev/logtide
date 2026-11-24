/**
 * Per-user organization limits: the instance settings
 * (MAX_ORGANIZATIONS_PER_USER, MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH)
 * with an optional override stored on the user row (migration 080).
 */

/** Stored override meaning "no limit for this user". */
export const USER_LIMIT_UNLIMITED = -1;

/** A stored override: null = instance setting, -1 = unlimited, n >= 0 = the limit. */
export type StoredUserLimit = number | null;

/** What an administrator sets: 'default' clears the override. */
export type UserLimitOverride = 'default' | 'unlimited' | number;

/** The limit in force for a user. null = unlimited. */
export function effectiveUserLimit(
  stored: StoredUserLimit | undefined,
  instanceSetting: number | undefined,
): number | null {
  if (stored === null || stored === undefined) return instanceSetting ?? null;
  if (stored === USER_LIMIT_UNLIMITED) return null;
  return stored;
}

export function toStoredUserLimit(override: UserLimitOverride): StoredUserLimit {
  if (override === 'default') return null;
  if (override === 'unlimited') return USER_LIMIT_UNLIMITED;
  return override;
}

export function fromStoredUserLimit(stored: StoredUserLimit | undefined): UserLimitOverride {
  if (stored === null || stored === undefined) return 'default';
  if (stored === USER_LIMIT_UNLIMITED) return 'unlimited';
  return stored;
}

export interface UserOrganizationLimits {
  /** Organizations the user owns now. */
  owned: number;
  /** Most organizations the user may own. null = unlimited. */
  maxOwned: number | null;
  /** Organizations the user created in the current UTC month. */
  createdThisMonth: number;
  /** Most organizations the user may create per UTC month. null = unlimited. */
  maxCreationsPerMonth: number | null;
  /** False when one of the two limits is reached. */
  canCreate: boolean;
  /** Which limit blocks a new organization, when one does. */
  blockedBy: 'owned' | 'monthly' | null;
}

export function summarizeUserOrganizationLimits(input: {
  owned: number;
  maxOwned: number | null;
  createdThisMonth: number;
  maxCreationsPerMonth: number | null;
}): UserOrganizationLimits {
  const blockedBy =
    input.maxOwned !== null && input.owned >= input.maxOwned
      ? 'owned'
      : input.maxCreationsPerMonth !== null && input.createdThisMonth >= input.maxCreationsPerMonth
        ? 'monthly'
        : null;
  return { ...input, canCreate: blockedBy === null, blockedBy };
}
