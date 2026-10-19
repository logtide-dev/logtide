import type { MeteringService } from '../modules/metering/service.js';
import { quotaSignals, type QuotaCapabilityDef } from './registry.js';
import { startOfUtcMonth } from './month.js';

/**
 * Metered usage of one quota: the SUM over every signal of the quota (one for
 * single-signal quotas, several for combined quotas like telemetry.max_bytes_monthly).
 * Point-in-time gauges read the latest snapshot per project; monthly quotas sum
 * the signal over the current UTC calendar month. Shared by the QuotaEvaluator
 * (enforcement) and the usage API so both always agree.
 */
export async function readQuotaUsage(
  metering: Pick<MeteringService, 'aggregate' | 'latestPointInTime'>,
  organizationId: string,
  def: QuotaCapabilityDef,
  now: Date
): Promise<number> {
  let usage = 0;
  for (const signal of quotaSignals(def)) {
    if (def.window === 'point_in_time') {
      usage += await metering.latestPointInTime(organizationId, signal);
    } else {
      const rows = await metering.aggregate({
        organizationId,
        from: startOfUtcMonth(now),
        to: now,
        groupBy: 'type',
        type: signal,
      });
      usage += rows.reduce((sum, r) => sum + r.quantity, 0);
    }
  }
  return usage;
}
