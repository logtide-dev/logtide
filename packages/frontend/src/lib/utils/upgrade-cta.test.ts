import { describe, it, expect } from 'vitest';
import { canShowUpgradeCta, anyCapabilityAtLimit } from './upgrade-cta';

describe('canShowUpgradeCta', () => {
  it('requires the feature flag and an owner or admin role', () => {
    expect(canShowUpgradeCta(true, 'owner')).toBe(true);
    expect(canShowUpgradeCta(true, 'admin')).toBe(true);
    expect(canShowUpgradeCta(true, 'member')).toBe(false);
    expect(canShowUpgradeCta(true, undefined)).toBe(false);
    expect(canShowUpgradeCta(true, null)).toBe(false);
  });

  it('is hidden when the feature is off or absent', () => {
    expect(canShowUpgradeCta(undefined, 'owner')).toBe(false);
    expect(canShowUpgradeCta(false, 'admin')).toBe(false);
  });
});

describe('anyCapabilityAtLimit', () => {
  it('flags capabilities at or over their limit', () => {
    expect(anyCapabilityAtLimit([{ current: 5, limit: 5 }])).toBe(true);
    expect(anyCapabilityAtLimit([{ current: 6, limit: 5 }])).toBe(true);
    expect(anyCapabilityAtLimit([{ current: 0, limit: 0 }])).toBe(true);
  });

  it('ignores unlimited and under-limit capabilities', () => {
    expect(anyCapabilityAtLimit([{ current: 99, limit: null }, { current: 1, limit: 5 }])).toBe(false);
    expect(anyCapabilityAtLimit([])).toBe(false);
  });
});
