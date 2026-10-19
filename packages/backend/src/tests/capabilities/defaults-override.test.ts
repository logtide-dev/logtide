import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../database/index.js';
import {
  CAPABILITIES,
  applyDefaultOverrides,
  resetDefaultOverrides,
} from '../../capabilities/registry.js';
import { QuotaEvaluator } from '../../capabilities/quota-evaluator.js';
import { quotaFlagCache } from '../../capabilities/quota-cache.js';
import { capabilities } from '../../capabilities/facade.js';
import type { UsageRow } from '../../modules/metering/index.js';
import { createTestContext } from '../helpers/factories.js';

const MIB = 1024 * 1024;

function meteringStub(bytesByOrg: Record<string, number>) {
  return {
    async aggregate(params: { organizationId: string; type?: string }): Promise<UsageRow[]> {
      if (params.type !== 'logs.ingested.bytes') return [];
      const q = bytesByOrg[params.organizationId];
      return q === undefined ? [] : [{ type: params.type, project_id: null, quantity: q }];
    },
    async latestPointInTime(): Promise<number> {
      return 0;
    },
  };
}

describe('CAPABILITY_DEFAULTS_JSON overrides', () => {
  beforeEach(async () => {
    resetDefaultOverrides();
    await db.deleteFrom('organization_entitlements').execute();
    quotaFlagCache.clear();
  });
  afterEach(() => {
    resetDefaultOverrides();
  });

  it('(a) absent env leaves registry defaults untouched', () => {
    applyDefaultOverrides(undefined);
    applyDefaultOverrides('');
    expect(CAPABILITIES['ingestion.max_bytes_monthly'].defaultLimit).toBeNull();
    expect(CAPABILITIES['auth.sso'].defaultEnabled).toBe(true);
  });

  it('applies boolean, number and null overrides', () => {
    applyDefaultOverrides(
      JSON.stringify({
        'ingestion.max_bytes_monthly': MIB,
        'alerts.max_rules': 3,
        'auth.sso': false,
        'apikeys.max': null,
      })
    );
    expect(CAPABILITIES['ingestion.max_bytes_monthly'].defaultLimit).toBe(MIB);
    expect(CAPABILITIES['alerts.max_rules'].defaultLimit).toBe(3);
    expect(CAPABILITIES['auth.sso'].defaultEnabled).toBe(false);
    expect(CAPABILITIES['apikeys.max'].defaultLimit).toBeNull();
  });

  it('(d) unknown key fails with an explicit message', () => {
    expect(() => applyDefaultOverrides('{"nope.nothing": 1}')).toThrow(/CAPABILITY_DEFAULTS_JSON.*nope\.nothing/);
  });

  it('rejects malformed JSON, non-objects and wrong value types', () => {
    expect(() => applyDefaultOverrides('{bad')).toThrow(/CAPABILITY_DEFAULTS_JSON/);
    expect(() => applyDefaultOverrides('[1]')).toThrow(/CAPABILITY_DEFAULTS_JSON/);
    expect(() => applyDefaultOverrides('{"alerts.max_rules": true}')).toThrow(/alerts\.max_rules/);
    expect(() => applyDefaultOverrides('{"alerts.max_rules": -1}')).toThrow(/alerts\.max_rules/);
    expect(() => applyDefaultOverrides('{"alerts.max_rules": 1.5}')).toThrow(/alerts\.max_rules/);
    expect(() => applyDefaultOverrides('{"auth.sso": 5}')).toThrow(/auth\.sso/);
    expect(() => applyDefaultOverrides('{"auth.sso": null}')).toThrow(/auth\.sso/);
  });

  it('a rejected document applies nothing (atomic)', () => {
    expect(() => applyDefaultOverrides('{"alerts.max_rules": 3, "bogus": 1}')).toThrow();
    expect(CAPABILITIES['alerts.max_rules'].defaultLimit).toBeNull();
  });

  it('(b) org with no entitlement rows is evaluated and blocked by a default quota', async () => {
    const { organization } = await createTestContext();
    applyDefaultOverrides(JSON.stringify({ 'ingestion.max_bytes_monthly': MIB }));
    capabilities.invalidate(organization.id);

    const ev = new QuotaEvaluator(meteringStub({ [organization.id]: 2 * MIB }));
    await ev.runOnce();
    expect(quotaFlagCache.isOverQuota(organization.id, 'ingestion.max_bytes_monthly')).toBe(true);
  });

  it('(c) explicit null row means unlimited despite a finite default', async () => {
    const { organization } = await createTestContext();
    applyDefaultOverrides(JSON.stringify({ 'ingestion.max_bytes_monthly': MIB }));
    await db
      .insertInto('organization_entitlements')
      .values({
        organization_id: organization.id,
        capability: 'ingestion.max_bytes_monthly',
        enabled: null,
        limit_value: null,
      } as never)
      .execute();
    capabilities.invalidate(organization.id);

    expect(await capabilities.getLimit(organization.id, 'ingestion.max_bytes_monthly')).toBeNull();
    const ev = new QuotaEvaluator(meteringStub({ [organization.id]: 5 * MIB }));
    await ev.runOnce();
    expect(quotaFlagCache.isOverQuota(organization.id, 'ingestion.max_bytes_monthly')).toBe(false);
  });

  it('(e) without quota defaults only orgs with rows are queried', async () => {
    const { organization } = await createTestContext();
    capabilities.invalidate(organization.id);
    const calls: string[] = [];
    const stub = meteringStub({ [organization.id]: 5 * MIB });
    const spy = {
      aggregate: async (p: { organizationId: string; type?: string }) => {
        calls.push(p.organizationId);
        return stub.aggregate(p);
      },
      latestPointInTime: stub.latestPointInTime,
    };
    await new QuotaEvaluator(spy).runOnce();
    expect(calls).not.toContain(organization.id);
  });
});
