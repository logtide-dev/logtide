import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../database/index.js';
import { QuotaEvaluator } from '../../capabilities/quota-evaluator.js';
import { quotaFlagCache } from '../../capabilities/quota-cache.js';
import { capabilities } from '../../capabilities/facade.js';
import { computeQuotaState } from '../../capabilities/quota-state.js';
import { formatQuotaValue, notifyQuotaThreshold } from '../../capabilities/quota-notifier.js';
import { createTestContext } from '../helpers/factories.js';

const CAP = 'ingestion.max_events_monthly';

function stubFor(orgId: string, getUsage: () => number) {
  return {
    async aggregate() {
      return [{ type: 'logs.ingested.events', project_id: null, quantity: getUsage() }];
    },
    async latestPointInTime() {
      return 0;
    },
  } as any;
}

async function setLimit(orgId: string, capability: string, limit: number) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: orgId, capability, enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(orgId);
}

async function quotaNotifications(orgId: string, state?: string) {
  const rows = await db
    .selectFrom('notifications')
    .selectAll()
    .where('organization_id', '=', orgId)
    .execute();
  return rows.filter(
    (r) => (r.metadata as any)?.kind === 'quota_threshold' && (!state || (r.metadata as any).state === state)
  );
}

describe('computeQuotaState', () => {
  it('collapses to blocked at the limit without grace', () => {
    expect(computeQuotaState(100, 100, null)).toBe('blocked');
    expect(computeQuotaState(99, 100, null)).toBe('ok');
    expect(computeQuotaState(5, null, 10)).toBe('unlimited');
  });
  it('has a grace band with grace percent', () => {
    expect(computeQuotaState(100, 100, 10)).toBe('grace');
    expect(computeQuotaState(105, 100, 10)).toBe('grace');
    expect(computeQuotaState(110, 100, 10)).toBe('blocked');
  });
});

describe('formatQuotaValue', () => {
  it('formats counts and bytes in en-US', () => {
    expect(formatQuotaValue('ingestion.max_events_monthly', 1234567)).toBe('1,234,567');
    expect(formatQuotaValue('ingestion.max_bytes_monthly', 1536 * 1024)).toBe('1.5 MB');
  });

  it('formats metric datapoints as a plain count, not bytes', () => {
    expect(formatQuotaValue('metrics.max_datapoints_monthly', 2048)).toBe('2,048');
    expect(formatQuotaValue('metrics.max_datapoints_monthly', 5_000_000)).toBe('5,000,000');
  });
});

describe('QuotaEvaluator grace and notifications', () => {
  let orgId: string;

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});
    quotaFlagCache.clear();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    capabilities.invalidate(orgId);
  });

  it('105/100 with 10% grace is not blocked, 110 is blocked', async () => {
    await setLimit(orgId, CAP, 100);
    await setLimit(orgId, 'quota.grace_percent', 10);
    let usage = 105;
    const ev = new QuotaEvaluator(stubFor(orgId, () => usage));
    await ev.runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(false);
    usage = 110;
    await ev.runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(true);
  });

  it('without grace the behaviour is unchanged (blocked at the limit)', async () => {
    await setLimit(orgId, CAP, 100);
    const ev = new QuotaEvaluator(stubFor(orgId, () => 100));
    await ev.runOnce();
    expect(quotaFlagCache.isOverQuota(orgId, CAP)).toBe(true);
  });

  it('notifies once per state per month across ticks (in-app and email)', async () => {
    await setLimit(orgId, CAP, 100);
    await setLimit(orgId, 'quota.grace_percent', 10);
    let usage = 105;
    const ev = new QuotaEvaluator(stubFor(orgId, () => usage));

    await ev.runOnce();
    await ev.runOnce();
    expect(await quotaNotifications(orgId, 'grace')).toHaveLength(1);
    expect(await quotaNotifications(orgId, 'blocked')).toHaveLength(0);

    usage = 120;
    await ev.runOnce();
    await ev.runOnce();
    expect(await quotaNotifications(orgId, 'grace')).toHaveLength(1);
    expect(await quotaNotifications(orgId, 'blocked')).toHaveLength(1);

    const res = await fetch('http://localhost:8025/api/v2/messages');
    const body: any = await res.json();
    const mine = body.items.filter((m: any) =>
      String(m.Content.Headers.Subject?.[0] ?? '').includes(CAP)
    );
    // one email per state, no matter how many ticks
    expect(mine).toHaveLength(2);
  });

  it('a notification from last month does not suppress this month', async () => {
    await setLimit(orgId, CAP, 100);
    const ev = new QuotaEvaluator(stubFor(orgId, () => 150));
    await ev.runOnce();
    await db
      .updateTable('notifications')
      .set({ created_at: new Date(Date.UTC(2020, 0, 15)) })
      .where('organization_id', '=', orgId)
      .execute();
    await ev.runOnce();
    expect(await quotaNotifications(orgId, 'blocked')).toHaveLength(2);
  });
  it('a raised limit in the same month notifies again at the new ceiling', async () => {
    await setLimit(orgId, CAP, 100);
    let usage = 150;
    const ev = new QuotaEvaluator(stubFor(orgId, () => usage));
    await ev.runOnce();
    expect(await quotaNotifications(orgId, 'blocked')).toHaveLength(1);

    // Upgrade mid-month: limit 100 -> 200 (upsert like the admin route does).
    await db
      .updateTable('organization_entitlements')
      .set({ limit_value: 200 })
      .where('organization_id', '=', orgId)
      .where('capability', '=', CAP)
      .execute();
    capabilities.invalidate(orgId);

    usage = 180; // under the new ceiling: no new notification
    await ev.runOnce();
    expect(await quotaNotifications(orgId, 'blocked')).toHaveLength(1);

    usage = 250; // crosses the new ceiling: notified again, once
    await ev.runOnce();
    await ev.runOnce();
    const blocked = await quotaNotifications(orgId, 'blocked');
    expect(blocked).toHaveLength(2);
    expect(blocked.map((r) => (r.metadata as any).limit).sort()).toEqual([100, 200]);
  });

  it('concurrent evaluations (several replicas) send one notification and one email', async () => {
    const params = {
      organizationId: orgId,
      capability: CAP as typeof CAP,
      state: 'blocked' as const,
      usage: 150,
      limit: 100,
      gracePercent: 0,
      now: new Date(),
    };
    await Promise.all(Array.from({ length: 8 }, () => notifyQuotaThreshold(params)));

    expect(await quotaNotifications(orgId, 'blocked')).toHaveLength(1);
    const res = await fetch('http://localhost:8025/api/v2/messages');
    const body: any = await res.json();
    const mine = body.items.filter((m: any) => String(m.Content.Headers.Subject?.[0] ?? '').includes(CAP));
    expect(mine).toHaveLength(1);
  });
});
