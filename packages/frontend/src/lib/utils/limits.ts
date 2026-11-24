/**
 * Copy for the limits that block creating things (projects in an
 * organization, organizations for a user), so the UI can say where the user
 * stands before they hit the error.
 */

/** Limits and counts of the signed-in user, from GET /organizations/limits. null = unlimited. */
export interface UserOrganizationLimits {
  owned: number;
  maxOwned: number | null;
  createdThisMonth: number;
  maxCreationsPerMonth: number | null;
  canCreate: boolean;
  blockedBy: 'owned' | 'monthly' | null;
}

const n = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, noun: string) => (count === 1 ? noun : `${noun}s`);

export function isAtLimit(current: number, limit: number | null | undefined): boolean {
  return limit !== null && limit !== undefined && current >= limit;
}

/** "2 of 3 projects". Null when there is no limit, so callers show nothing. */
export function usageOfLimit(current: number, limit: number | null | undefined, noun: string): string | null {
  if (limit === null || limit === undefined) return null;
  return `${n(current)} of ${n(limit)} ${plural(limit, noun)}`;
}

/** Why a new project cannot be created, and what to do about it. */
export function projectLimitMessage(limit: number, canManage: boolean): string {
  const reached = `This organization has reached its limit of ${n(limit)} ${plural(limit, 'project')}.`;
  return canManage
    ? `${reached} Delete a project or raise the limit to create another one.`
    : `${reached} Ask an owner or admin of the organization to raise it.`;
}

/** Where the user stands against their organization limits. Empty when none applies. */
export function organizationLimitLines(limits: UserOrganizationLimits | null): string[] {
  if (!limits) return [];
  const lines: string[] = [];
  const owned = usageOfLimit(limits.owned, limits.maxOwned, 'organization');
  if (owned) lines.push(`You own ${owned}.`);
  if (limits.maxCreationsPerMonth !== null) {
    lines.push(
      `You created ${n(limits.createdThisMonth)} of ${n(limits.maxCreationsPerMonth)} ${plural(limits.maxCreationsPerMonth, 'organization')} allowed this month.`,
    );
  }
  return lines;
}

/** Why the user cannot create an organization right now. Null when they can. */
export function organizationLimitMessage(limits: UserOrganizationLimits | null): string | null {
  if (!limits || limits.canCreate) return null;
  if (limits.blockedBy === 'owned') {
    const max = limits.maxOwned ?? 0;
    return max === 0
      ? 'Your account cannot own organizations. Ask the administrator of this LogTide instance to change the limit.'
      : `You already own ${n(limits.owned)} ${plural(limits.owned, 'organization')}, the most your account can own (${n(max)}). Delete one, or ask the administrator of this LogTide instance to raise the limit.`;
  }
  const max = limits.maxCreationsPerMonth ?? 0;
  return `You already created ${n(limits.createdThisMonth)} ${plural(limits.createdThisMonth, 'organization')} this month, the most your account can create (${n(max)} per month). You can create another one next month.`;
}
