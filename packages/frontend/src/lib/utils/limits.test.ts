import { describe, it, expect } from 'vitest';
import {
  isAtLimit,
  organizationLimitLines,
  organizationLimitMessage,
  projectLimitMessage,
  usageOfLimit,
  type UserOrganizationLimits,
} from './limits';

const limits = (over: Partial<UserOrganizationLimits> = {}): UserOrganizationLimits => ({
  owned: 1,
  maxOwned: 3,
  createdThisMonth: 1,
  maxCreationsPerMonth: 3,
  canCreate: true,
  blockedBy: null,
  ...over,
});

describe('limits copy', () => {
  it('isAtLimit treats a missing limit as unlimited', () => {
    expect(isAtLimit(5, null)).toBe(false);
    expect(isAtLimit(5, undefined)).toBe(false);
    expect(isAtLimit(1, 2)).toBe(false);
    expect(isAtLimit(2, 2)).toBe(true);
    expect(isAtLimit(3, 2)).toBe(true);
    expect(isAtLimit(0, 0)).toBe(true);
  });

  it('usageOfLimit formats counts and says nothing without a limit', () => {
    expect(usageOfLimit(2, 2, 'project')).toBe('2 of 2 projects');
    expect(usageOfLimit(1, 1, 'project')).toBe('1 of 1 project');
    expect(usageOfLimit(1200, 5000, 'project')).toBe('1,200 of 5,000 projects');
    expect(usageOfLimit(4, null, 'project')).toBeNull();
  });

  it('projectLimitMessage depends on who is reading', () => {
    expect(projectLimitMessage(2, true)).toBe(
      'This organization has reached its limit of 2 projects. Delete a project or raise the limit to create another one.',
    );
    expect(projectLimitMessage(1, false)).toBe(
      'This organization has reached its limit of 1 project. Ask an owner or admin of the organization to raise it.',
    );
  });

  it('organizationLimitLines lists only the limits that apply', () => {
    expect(organizationLimitLines(null)).toEqual([]);
    expect(organizationLimitLines(limits({ maxOwned: null, maxCreationsPerMonth: null }))).toEqual([]);
    expect(organizationLimitLines(limits())).toEqual([
      'You own 1 of 3 organizations.',
      'You created 1 of 3 organizations allowed this month.',
    ]);
    expect(organizationLimitLines(limits({ maxCreationsPerMonth: null }))).toEqual(['You own 1 of 3 organizations.']);
  });

  it('organizationLimitMessage explains the limit that blocks', () => {
    expect(organizationLimitMessage(null)).toBeNull();
    expect(organizationLimitMessage(limits())).toBeNull();
    expect(organizationLimitMessage(limits({ owned: 3, canCreate: false, blockedBy: 'owned' }))).toContain(
      'You already own 3 organizations, the most your account can own (3).',
    );
    expect(organizationLimitMessage(limits({ maxOwned: 0, owned: 0, canCreate: false, blockedBy: 'owned' }))).toContain(
      'Your account cannot own organizations.',
    );
    expect(
      organizationLimitMessage(limits({ createdThisMonth: 3, canCreate: false, blockedBy: 'monthly' })),
    ).toContain('You already created 3 organizations this month');
  });
});
