import { db } from '../database/index.js';
import { config } from '../config/index.js';
import { context } from '@logtide/shared/context';
import { capabilities } from './facade.js';
import { quotaFlagCache } from './quota-cache.js';
import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  type CapabilityName,
} from './registry.js';
import { computeQuotaState } from './quota-state.js';
import { notifyQuotaThreshold } from './quota-notifier.js';
import type { MeteringService } from '../modules/metering/index.js';
import { startOfUtcMonth } from './month.js';

const QUOTA_CAPABILITIES = CAPABILITY_NAMES.filter(
  (n) => CAPABILITIES[n].kind === 'quota'
) as CapabilityName[];

/**
 * Periodic job: the single place that joins a configured quota limit (#214) to
 * measured usage (#212). For each org that has at least one non-null quota limit,
 * it reads usage via MeteringService.aggregate and writes per-capability over-quota
 * flags into the in-memory cache. Fail-open: a metering-read failure leaves the
 * flag unset (under quota).
 */
export class QuotaEvaluator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly metering: Pick<MeteringService, 'aggregate' | 'latestPointInTime'>) {}

  /**
   * Orgs to evaluate: those with at least one non-null quota entitlement row, or
   * every org when any quota default is finite (organizations has no soft delete).
   * Without quota defaults, cost scales with restricted orgs, not total orgs.
   */
  private async restrictedOrgIds(): Promise<string[]> {
    // A finite quota default (CAPABILITY_DEFAULTS_JSON) restricts every org that has
    // no explicit row, so all orgs must be evaluated. Rows with limit null still
    // resolve to unlimited inside evaluateOrg via the resolver.
    const hasFiniteQuotaDefault = QUOTA_CAPABILITIES.some(
      (n) => (CAPABILITIES[n] as { defaultLimit: number | null }).defaultLimit !== null
    );
    if (hasFiniteQuotaDefault) {
      const all = await db.selectFrom('organizations').select('id').execute();
      return all.map((r) => r.id);
    }
    const rows = await db
      .selectFrom('organization_entitlements')
      .select('organization_id')
      .distinct()
      .where('capability', 'in', QUOTA_CAPABILITIES)
      .where('limit_value', 'is not', null)
      .execute();
    return rows.map((r) => r.organization_id);
  }

  private async evaluateOrg(organizationId: string, now: Date): Promise<void> {
    const flags: Partial<Record<CapabilityName, boolean>> = {};
    // Per-org grace allowance applying to every quota (null = 0%).
    const gracePercent = (await capabilities.getLimit(organizationId, 'quota.grace_percent')) ?? 0;

    for (const cap of QUOTA_CAPABILITIES) {
      const def = CAPABILITIES[cap];
      if (def.kind !== 'quota') continue;

      const limit = await capabilities.getLimit(organizationId, cap);
      if (limit === null) {
        flags[cap] = false; // unlimited
        continue;
      }

      try {
        let usage = 0;
        if (def.window === 'point_in_time') {
          // Gauge semantics: read the LATEST snapshot per project (summed across
          // projects), never the historical sum of snapshot events.
          usage = await this.metering.latestPointInTime(organizationId, def.signal);
        } else {
          const rows = await this.metering.aggregate({
            organizationId,
            from: startOfUtcMonth(now),
            to: now,
            groupBy: 'type',
            type: def.signal,
          });
          usage = rows.reduce((sum, r) => sum + r.quantity, 0);
        }

        const state = computeQuotaState(usage, limit, gracePercent);
        flags[cap] = state === 'blocked';
        if (state === 'grace' || state === 'blocked') {
          await notifyQuotaThreshold({ organizationId, capability: cap, state, usage, limit, gracePercent, now });
        }
      } catch (err) {
        // Fail-open: leave this capability's flag unset (under quota).
        console.warn(
          `[QuotaEvaluator] metering read failed for org ${organizationId} cap ${cap}, leaving under-quota:`,
          err
        );
      }
    }

    quotaFlagCache.setOrgFlags(organizationId, flags);
  }

  /** One full pass over all restricted orgs. Exposed for tests and for the interval. */
  async runOnce(): Promise<void> {
    const now = new Date();
    const orgIds = await this.restrictedOrgIds();
    for (const orgId of orgIds) {
      await this.evaluateOrg(orgId, now);
    }
  }

  start(): void {
    if (this.timer || !config.QUOTA_EVALUATOR_ENABLED) return;
    const tick = () => {
      void context.runAsSystem('cron:quota-evaluator', async () => {
        if (this.running) return; // in-flight lock
        this.running = true;
        try {
          await this.runOnce();
        } catch (err) {
          console.error('[QuotaEvaluator] tick failed:', err);
        } finally {
          this.running = false;
        }
      });
    };
    this.timer = setInterval(tick, config.QUOTA_EVALUATOR_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    tick(); // run immediately on start
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
