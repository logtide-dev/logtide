import type { CapabilityUsage } from '$lib/api/usage';

/**
 * Rows of the Usage page capability card, in display order.
 *
 * Capabilities with a configured limit come first (the actionable ones),
 * unlimited ones after; stable within each group by registry order.
 *
 * When the plan caps at least one consumption quota (e.g. the combined
 * telemetry.max_bytes_monthly of a hosted plan), the other quotas left at null
 * are hidden: listing every per-signal meter as "Unlimited" next to the real
 * plan quota is noise. With no quota limit at all (the self-hosted default)
 * every row stays, exactly as before.
 */
export function visibleCapabilities(caps: CapabilityUsage[]): CapabilityUsage[] {
  const anyQuotaLimit = caps.some((c) => c.kind === 'quota' && c.limit !== null);
  const rows = anyQuotaLimit ? caps.filter((c) => !(c.kind === 'quota' && c.limit === null)) : caps;
  return [...rows].sort((a, b) => (a.limit === null ? 1 : 0) - (b.limit === null ? 1 : 0));
}
