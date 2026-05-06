import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  has,
  assertHas,
  list,
  registerCapabilityResolver,
  CapabilityError,
  type CapabilityResolver,
  CAPABILITY_NAMES,
} from '../../../modules/capabilities/service.js';
import type { CapabilityName } from '../../../modules/capabilities/registry.js';

/**
 * Mock capability resolver for testing
 */
class MockCapabilityResolver implements CapabilityResolver {
  constructor(private readonly caps: Record<CapabilityName, boolean>) {}

  async has(organizationId: string, capability: CapabilityName): Promise<boolean> {
    return this.caps[capability] ?? false;
  }

  async list(organizationId: string): Promise<Record<CapabilityName, boolean>> {
    return { ...this.caps };
  }
}

describe('CapabilitiesService', () => {
  beforeEach(() => {
    // Reset to default resolver before each test
    vi.restoreAllMocks();
  });

  describe('has', () => {
    it('should return true for enabled capability', async () => {
      registerCapabilityResolver(new MockCapabilityResolver({
        'retention.extended': true,
        'audit.immutable': false,
        'auth.sso': true,
        'alerts.unlimited': true,
        'dashboards.unlimited': true,
      }));

      const result = await has('org-123', 'retention.extended');
      expect(result).toBe(true);
    });

    it('should return false for disabled capability', async () => {
      registerCapabilityResolver(new MockCapabilityResolver({
        'retention.extended': false,
        'audit.immutable': true,
        'auth.sso': true,
        'alerts.unlimited': true,
        'dashboards.unlimited': true,
      }));

      const result = await has('org-123', 'retention.extended');
      expect(result).toBe(false);
    });
  });

  describe('assertHas', () => {
    it('should not throw for enabled capability', async () => {
      registerCapabilityResolver(new MockCapabilityResolver({
        'retention.extended': true,
        'audit.immutable': true,
        'auth.sso': true,
        'alerts.unlimited': true,
        'dashboards.unlimited': true,
      }));

      await expect(assertHas('org-123', 'retention.extended')).resolves.toBeUndefined();
    });

    it('should throw CapabilityError for disabled capability', async () => {
      registerCapabilityResolver(new MockCapabilityResolver({
        'retention.extended': false,
        'audit.immutable': true,
        'auth.sso': true,
        'alerts.unlimited': true,
        'dashboards.unlimited': true,
      }));

      await expect(assertHas('org-123', 'retention.extended')).rejects.toThrow(CapabilityError);
    });

    it('should include capability name and org id in error', async () => {
      registerCapabilityResolver(new MockCapabilityResolver({
        'retention.extended': false,
        'audit.immutable': true,
        'auth.sso': true,
        'alerts.unlimited': true,
        'dashboards.unlimited': true,
      }));

      await expect(assertHas('my-org', 'alerts.unlimited')).rejects.toMatchObject({
        capability: 'alerts.unlimited',
        organizationId: 'my-org',
      });
    });
  });

  describe('list', () => {
    it('should return all capabilities with their enabled status', async () => {
      registerCapabilityResolver(new MockCapabilityResolver({
        'retention.extended': true,
        'audit.immutable': false,
        'auth.sso': true,
        'alerts.unlimited': false,
        'dashboards.unlimited': true,
      }));

      const result = await list('org-123');

      expect(result).toHaveLength(CAPABILITY_NAMES.length);
      expect(result.find((c) => c.name === 'retention.extended')?.enabled).toBe(true);
      expect(result.find((c) => c.name === 'audit.immutable')?.enabled).toBe(false);
      expect(result.find((c) => c.name === 'alerts.unlimited')?.enabled).toBe(false);
    });

    it('should include descriptions for each capability', async () => {
      registerCapabilityResolver(new MockCapabilityResolver({
        'retention.extended': true,
        'audit.immutable': true,
        'auth.sso': true,
        'alerts.unlimited': true,
        'dashboards.unlimited': true,
      }));

      const result = await list('org-123');

      for (const cap of result) {
        expect(typeof cap.description).toBe('string');
        expect(cap.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('CapabilityError', () => {
    it('should have correct name and message', () => {
      const error = new CapabilityError('auth.sso', 'org-456');
      expect(error.name).toBe('CapabilityError');
      expect(error.message).toContain('auth.sso');
      expect(error.message).toContain('org-456');
      expect(error.capability).toBe('auth.sso');
      expect(error.organizationId).toBe('org-456');
    });
  });
});

describe('DefaultCapabilityResolver', () => {
  it('should be registered by default and enable all capabilities', async () => {
    const { getCapabilityResolver } = await import('../../../modules/capabilities/service.js');
    const resolver = getCapabilityResolver();

    for (const name of CAPABILITY_NAMES) {
      const result = await resolver.has('any-org', name);
      expect(result).toBe(true);
    }
  });
});
