import type { CapabilityUsage } from '$lib/api/usage';

/** The combined quota of hosted plans. */
const TELEMETRY_QUOTA = 'telemetry.max_bytes_monthly';

/**
 * Rows of the Usage page capability card, in display order.
 *
 * Capabilities with a configured limit come first (the actionable ones),
 * unlimited ones after; stable within each group by registry order.
 *
 * Only when the combined telemetry.max_bytes_monthly quota has a limit (the
 * hosted plan case) are the quotas left at null hidden: listing every
 * per-signal meter as "Unlimited" next to the plan quota is noise. In every
 * other case (self-hosted default, or a self-hoster who capped one quota)
 * every row stays, exactly as before.
 */
export function visibleCapabilities(caps: CapabilityUsage[]): CapabilityUsage[] {
  const telemetryCapped = caps.some((c) => c.capability === TELEMETRY_QUOTA && c.limit !== null);
  const rows = telemetryCapped ? caps.filter((c) => !(c.kind === 'quota' && c.limit === null)) : caps;
  return [...rows].sort((a, b) => (a.limit === null ? 1 : 0) - (b.limit === null ? 1 : 0));
}
